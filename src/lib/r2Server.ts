import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  type PutObjectCommandInput,
  type GetObjectCommandInput,
  type DeleteObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  publicUrl?: string;
}

let s3ClientInstance: S3Client | null = null;
let lastS3Endpoint: string = "";

/**
 * Resolves Cloudflare R2 configuration from environment variables.
 */
export function getR2ServerConfig(): R2Config {
  const accountId = (process.env.R2_ACCOUNT_ID || process.env.VITE_R2_ACCOUNT_ID || "").trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || process.env.VITE_R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || process.env.VITE_R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = (process.env.R2_BUCKET || process.env.VITE_R2_BUCKET || "academy-connect-files").trim();
  const explicitEndpoint = (process.env.R2_ENDPOINT || process.env.VITE_R2_ENDPOINT || "").trim();
  const publicUrl = (process.env.R2_PUBLIC_URL || process.env.VITE_R2_PUBLIC_URL || "").trim().replace(/\/+$/, "");

  const endpoint = explicitEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    publicUrl,
  };
}

/**
 * Checks if real Cloudflare R2 credentials and endpoint are fully provided.
 */
export function isR2Configured(): boolean {
  const config = getR2ServerConfig();
  return Boolean(
    config.accessKeyId &&
    config.secretAccessKey &&
    config.endpoint &&
    config.endpoint.startsWith("http")
  );
}

/**
 * Initializes and returns the singleton AWS S3 client configured for Cloudflare R2.
 */
export function getR2S3Client(): S3Client {
  const config = getR2ServerConfig();
  if (!config.accessKeyId || !config.secretAccessKey || !config.endpoint) {
    throw new Error(
      `Cloudflare R2 is not fully configured. Missing credentials or endpoint: ${JSON.stringify({
        hasAccessKey: Boolean(config.accessKeyId),
        hasSecretKey: Boolean(config.secretAccessKey),
        hasEndpoint: Boolean(config.endpoint),
        bucket: config.bucket,
      })}`
    );
  }

  if (!s3ClientInstance || lastS3Endpoint !== config.endpoint) {
    s3ClientInstance = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true, // Cloudflare R2 requires path-style routing
    });
    lastS3Endpoint = config.endpoint;
  }
  return s3ClientInstance;
}

/**
 * Uploads an object directly to Cloudflare R2 bucket.
 */
export async function uploadObjectToR2(params: {
  bucket?: string;
  key: string;
  body: Buffer | Uint8Array | string | Readable;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}): Promise<{ bucket: string; key: string; etag?: string }> {
  const config = getR2ServerConfig();
  const bucketName = params.bucket || config.bucket;
  const cleanKey = params.key.replace(/^\/+/, "");
  const client = getR2S3Client();

  try {
    const input: PutObjectCommandInput = {
      Bucket: bucketName,
      Key: cleanKey,
      Body: params.body,
      ContentType: params.contentType || "application/octet-stream",
      CacheControl: params.cacheControl || "public, max-age=31536000, immutable",
      Metadata: params.metadata,
    };

    const command = new PutObjectCommand(input);
    const response = await client.send(command);

    console.log(`[R2Server] PutObject successful: bucket="${bucketName}", key="${cleanKey}", ETag=${response.ETag}`);

    return {
      bucket: bucketName,
      key: cleanKey,
      etag: response.ETag,
    };
  } catch (err: any) {
    console.error(`[R2Server] PutObject failed: bucket="${bucketName}", key="${cleanKey}":`, {
      message: err.message,
      code: err.name || err.code,
      statusCode: err.$metadata?.httpStatusCode,
      stack: err.stack,
    });
    throw new Error(`Cloudflare R2 PutObject failed (${cleanKey}): ${err.message || err}`);
  }
}

/**
 * Retrieves an object stream from Cloudflare R2 bucket.
 */
export async function getObjectFromR2(params: {
  bucket?: string;
  key: string;
  range?: string;
}): Promise<{
  body: Readable | null;
  contentType?: string;
  contentLength?: number;
  contentRange?: string;
  lastModified?: Date;
  etag?: string;
  metadata?: Record<string, string>;
}> {
  const config = getR2ServerConfig();
  const bucketName = params.bucket || config.bucket;
  const cleanKey = params.key.replace(/^\/+/, "");
  const client = getR2S3Client();

  try {
    const input: GetObjectCommandInput = {
      Bucket: bucketName,
      Key: cleanKey,
      Range: params.range,
    };

    const command = new GetObjectCommand(input);
    const response = await client.send(command);

    return {
      body: (response.Body as unknown as Readable) || null,
      contentType: response.ContentType || "application/octet-stream",
      contentLength: response.ContentLength,
      contentRange: response.ContentRange,
      lastModified: response.LastModified,
      etag: response.ETag,
      metadata: response.Metadata,
    };
  } catch (err: any) {
    if (
      err.name === "NoSuchKey" ||
      err.name === "NotFound" ||
      err.$metadata?.httpStatusCode === 404
    ) {
      console.warn(`[R2Server] Object not found in Cloudflare R2: bucket="${bucketName}", key="${cleanKey}"`);
      return { body: null };
    }
    console.error(`[R2Server] GetObject failed: bucket="${bucketName}", key="${cleanKey}":`, {
      message: err.message,
      code: err.name || err.code,
      statusCode: err.$metadata?.httpStatusCode,
      stack: err.stack,
    });
    throw err;
  }
}

/**
 * Generates a presigned URL for downloading or uploading to Cloudflare R2.
 */
export async function generateR2SignedUrl(params: {
  bucket?: string;
  key: string;
  expiresIn?: number;
  operation?: "getObject" | "putObject";
  contentType?: string;
}): Promise<string> {
  const config = getR2ServerConfig();
  const bucketName = params.bucket || config.bucket;
  const cleanKey = params.key.replace(/^\/+/, "");
  const expiresIn = params.expiresIn || 3600;
  const operation = params.operation || "getObject";
  const client = getR2S3Client();

  try {
    if (operation === "putObject") {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: cleanKey,
        ContentType: params.contentType,
      });
      return await getSignedUrl(client, command, { expiresIn });
    }

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: cleanKey,
    });
    return await getSignedUrl(client, command, { expiresIn });
  } catch (err: any) {
    console.error(`[R2Server] generateR2SignedUrl failed for ${cleanKey}:`, err);
    throw new Error(`Cloudflare R2 Signed URL generation failed: ${err.message || err}`);
  }
}

/**
 * Deletes an object from Cloudflare R2 bucket.
 */
export async function deleteObjectFromR2(params: {
  bucket?: string;
  key: string;
}): Promise<{ success: boolean; bucket: string; key: string }> {
  const config = getR2ServerConfig();
  const bucketName = params.bucket || config.bucket;
  const cleanKey = params.key.replace(/^\/+/, "");
  const client = getR2S3Client();

  try {
    const input: DeleteObjectCommandInput = {
      Bucket: bucketName,
      Key: cleanKey,
    };
    const command = new DeleteObjectCommand(input);
    await client.send(command);

    console.log(`[R2Server] Successfully deleted object: bucket="${bucketName}", key="${cleanKey}"`);
    return {
      success: true,
      bucket: bucketName,
      key: cleanKey,
    };
  } catch (err: any) {
    console.error(`[R2Server] DeleteObject failed: bucket="${bucketName}", key="${cleanKey}":`, err);
    throw new Error(`Cloudflare R2 DeleteObject failed (${cleanKey}): ${err.message || err}`);
  }
}

/**
 * Deletes multiple objects from Cloudflare R2 bucket.
 */
export async function deleteObjectsFromR2(params: {
  bucket?: string;
  keys: string[];
}): Promise<{ success: boolean; deleted: string[]; errors?: any[] }> {
  const cleanKeys = params.keys.map((k) => k.replace(/^\/+/, "")).filter(Boolean);
  if (cleanKeys.length === 0) {
    return { success: true, deleted: [] };
  }

  const config = getR2ServerConfig();
  const bucketName = params.bucket || config.bucket;
  const client = getR2S3Client();

  try {
    const command = new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: {
        Objects: cleanKeys.map((k) => ({ Key: k })),
        Quiet: false,
      },
    });
    const response = await client.send(command);
    const deletedKeys = (response.Deleted || []).map((d) => d.Key || "").filter(Boolean);

    console.log(`[R2Server] Successfully deleted ${deletedKeys.length} objects from Cloudflare R2`);
    return {
      success: true,
      deleted: deletedKeys,
      errors: response.Errors,
    };
  } catch (err: any) {
    console.error(`[R2Server] DeleteObjects failed:`, err);
    throw new Error(`Cloudflare R2 DeleteObjects failed: ${err.message || err}`);
  }
}

/**
 * Lists objects in Cloudflare R2 bucket matching a prefix.
 */
export async function listObjectsFromR2(params: {
  bucket?: string;
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}): Promise<{
  objects: Array<{ key: string; size: number; lastModified?: Date; etag?: string }>;
  nextContinuationToken?: string;
  isTruncated: boolean;
}> {
  const config = getR2ServerConfig();
  const bucketName = params.bucket || config.bucket;
  const cleanPrefix = (params.prefix || "").replace(/^\/+/, "");
  const client = getR2S3Client();

  try {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: cleanPrefix,
      MaxKeys: params.maxKeys || 1000,
      ContinuationToken: params.continuationToken,
    });

    const response = await client.send(command);
    const objects = (response.Contents || []).map((item) => ({
      key: item.Key || "",
      size: item.Size || 0,
      lastModified: item.LastModified,
      etag: item.ETag,
    }));

    return {
      objects,
      nextContinuationToken: response.NextContinuationToken,
      isTruncated: response.IsTruncated || false,
    };
  } catch (err: any) {
    console.error(`[R2Server] ListObjects failed: prefix="${cleanPrefix}":`, err);
    throw new Error(`Cloudflare R2 ListObjects failed: ${err.message || err}`);
  }
}

/**
 * Checks metadata/existence of an object in Cloudflare R2 bucket.
 */
export async function headObjectFromR2(params: {
  bucket?: string;
  key: string;
}): Promise<{
  exists: boolean;
  contentLength?: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
  metadata?: Record<string, string>;
}> {
  const config = getR2ServerConfig();
  const bucketName = params.bucket || config.bucket;
  const cleanKey = params.key.replace(/^\/+/, "");
  const client = getR2S3Client();

  try {
    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: cleanKey,
    });
    const response = await client.send(command);
    return {
      exists: true,
      contentLength: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified,
      etag: response.ETag,
      metadata: response.Metadata,
    };
  } catch (err: any) {
    if (
      err.name === "NotFound" ||
      err.$metadata?.httpStatusCode === 404 ||
      err.code === "NoSuchKey"
    ) {
      return { exists: false };
    }
    console.warn(`[R2Server] HeadObject warning for ${cleanKey}:`, err?.message || err);
    return { exists: false };
  }
}

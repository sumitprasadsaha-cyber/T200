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
import fs from "fs";
import path from "path";

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

const LOCAL_STORAGE_DIR = path.join(process.cwd(), "storage_data");

// Helper to ensure directory exists
function ensureDirExists(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getLocalFilePath(bucket: string, key: string): string {
  const safeBucket = bucket.replace(/[^a-zA-Z0-9._-]/g, "_");
  const cleanKey = key.replace(/^\/+/, "").replace(/\.\./g, "_");
  return path.join(LOCAL_STORAGE_DIR, safeBucket, cleanKey);
}

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
 * Initializes and returns a singleton AWS S3 client configured for Cloudflare R2.
 */
export function getR2S3Client(): S3Client | null {
  if (!isR2Configured()) {
    return null;
  }

  const config = getR2ServerConfig();
  if (!s3ClientInstance || lastS3Endpoint !== config.endpoint) {
    s3ClientInstance = new S3Client({
      region: "auto",
      endpoint: config.endpoint!,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true, // Cloudflare R2 requires path-style routing
    });
    lastS3Endpoint = config.endpoint!;
  }
  return s3ClientInstance;
}

/**
 * Uploads an object to Cloudflare R2 bucket (or local storage fallback).
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
  const client = getR2S3Client();

  if (client) {
    try {
      const input: PutObjectCommandInput = {
        Bucket: bucketName,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType || "application/octet-stream",
        CacheControl: params.cacheControl || "public, max-age=31536000, immutable",
        Metadata: params.metadata,
      };

      const command = new PutObjectCommand(input);
      const response = await client.send(command);

      return {
        bucket: bucketName,
        key: params.key,
        etag: response.ETag,
      };
    } catch (err: any) {
      console.warn("[R2Server] Remote R2 upload failed, falling back to persistent local storage:", err?.message || err);
    }
  }

  // Local fallback storage
  const filePath = getLocalFilePath(bucketName, params.key);
  ensureDirExists(path.dirname(filePath));

  if (Buffer.isBuffer(params.body)) {
    fs.writeFileSync(filePath, params.body);
  } else if (params.body instanceof Uint8Array) {
    fs.writeFileSync(filePath, Buffer.from(params.body));
  } else if (typeof params.body === "string") {
    fs.writeFileSync(filePath, params.body, "utf-8");
  } else if (typeof (params.body as any).pipe === "function") {
    const writeStream = fs.createWriteStream(filePath);
    await new Promise<void>((resolve, reject) => {
      (params.body as Readable).pipe(writeStream);
      writeStream.on("finish", () => resolve());
      writeStream.on("error", reject);
    });
  }

  // Store metadata companion file
  try {
    const metaPath = `${filePath}.meta.json`;
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        contentType: params.contentType || "application/octet-stream",
        cacheControl: params.cacheControl,
        metadata: params.metadata,
        uploadedAt: new Date().toISOString(),
      })
    );
  } catch (e) {
    // Ignore metadata write issues
  }

  return {
    bucket: bucketName,
    key: params.key,
    etag: `local-${Date.now()}`,
  };
}

/**
 * Retrieves an object from Cloudflare R2 bucket (or local storage fallback).
 */
export async function getObjectFromR2(params: {
  bucket?: string;
  key: string;
}): Promise<{
  body: Readable | Buffer | Uint8Array | null;
  contentType?: string;
  contentLength?: number;
  lastModified?: Date;
  metadata?: Record<string, string>;
}> {
  const config = getR2ServerConfig();
  const bucketName = params.bucket || config.bucket;
  const client = getR2S3Client();

  if (client) {
    try {
      const input: GetObjectCommandInput = {
        Bucket: bucketName,
        Key: params.key,
      };

      const command = new GetObjectCommand(input);
      const response = await client.send(command);

      return {
        body: (response.Body as unknown as Readable) || null,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
        metadata: response.Metadata,
      };
    } catch (err: any) {
      if (err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        // Proceed to check local storage
      } else {
        console.warn("[R2Server] Remote R2 getObject warning:", err?.message || err);
      }
    }
  }

  // Local fallback storage
  const filePath = getLocalFilePath(bucketName, params.key);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    let contentType = "application/octet-stream";
    let metadata: Record<string, string> | undefined;

    const metaPath = `${filePath}.meta.json`;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        if (meta.contentType) contentType = meta.contentType;
        if (meta.metadata) metadata = meta.metadata;
      } catch {
        // ignore
      }
    } else {
      if (params.key.toLowerCase().endsWith(".pdf")) contentType = "application/pdf";
      else if (params.key.toLowerCase().endsWith(".json")) contentType = "application/json";
      else if (params.key.toLowerCase().endsWith(".png")) contentType = "image/png";
      else if (params.key.toLowerCase().endsWith(".jpg") || params.key.toLowerCase().endsWith(".jpeg")) contentType = "image/jpeg";
    }

    const readStream = fs.createReadStream(filePath);
    return {
      body: readStream,
      contentType,
      contentLength: stats.size,
      lastModified: stats.mtime,
      metadata,
    };
  }

  return {
    body: null,
  };
}

/**
 * Generates a presigned URL for downloading or uploading to Cloudflare R2 (or fallback proxy URL).
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
  const expiresIn = params.expiresIn || 3600; // Default 1 hour
  const operation = params.operation || "getObject";
  const client = getR2S3Client();

  if (client) {
    try {
      if (operation === "putObject") {
        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: params.key,
          ContentType: params.contentType,
        });
        return await getSignedUrl(client, command, { expiresIn });
      }

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: params.key,
      });
      return await getSignedUrl(client, command, { expiresIn });
    } catch (err: any) {
      console.warn("[R2Server] Presigned URL generation warning, using proxy endpoint:", err?.message || err);
    }
  }

  // Fallback to local server proxy endpoint
  if (operation === "putObject") {
    return `/api/r2/upload?bucket=${encodeURIComponent(bucketName)}&key=${encodeURIComponent(params.key)}`;
  }

  return `/api/r2/download?bucket=${encodeURIComponent(bucketName)}&key=${encodeURIComponent(params.key)}`;
}

/**
 * Deletes an object from Cloudflare R2 bucket (and local storage fallback).
 */
export async function deleteObjectFromR2(params: {
  bucket?: string;
  key: string;
}): Promise<{ success: boolean; bucket: string; key: string }> {
  const config = getR2ServerConfig();
  const bucketName = params.bucket || config.bucket;
  const client = getR2S3Client();

  if (client) {
    try {
      const input: DeleteObjectCommandInput = {
        Bucket: bucketName,
        Key: params.key,
      };
      const command = new DeleteObjectCommand(input);
      await client.send(command);
    } catch (err: any) {
      console.warn("[R2Server] Remote R2 deleteObject warning:", err?.message || err);
    }
  }

  // Also remove from local fallback storage
  const filePath = getLocalFilePath(bucketName, params.key);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
  const metaPath = `${filePath}.meta.json`;
  if (fs.existsSync(metaPath)) {
    try {
      fs.unlinkSync(metaPath);
    } catch {
      // ignore
    }
  }

  return {
    success: true,
    bucket: bucketName,
    key: params.key,
  };
}

/**
 * Deletes multiple objects from Cloudflare R2 bucket (and local storage fallback).
 */
export async function deleteObjectsFromR2(params: {
  bucket?: string;
  keys: string[];
}): Promise<{ success: boolean; deleted: string[]; errors?: any[] }> {
  if (!params.keys || params.keys.length === 0) {
    return { success: true, deleted: [] };
  }

  const config = getR2ServerConfig();
  const bucketName = params.bucket || config.bucket;
  const client = getR2S3Client();
  let deletedKeys = [...params.keys];

  if (client) {
    try {
      const command = new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: params.keys.map((k) => ({ Key: k })),
          Quiet: false,
        },
      });
      const response = await client.send(command);
      if (response.Deleted) {
        deletedKeys = response.Deleted.map((d) => d.Key || "").filter(Boolean);
      }
    } catch (err: any) {
      console.warn("[R2Server] Remote R2 deleteObjects warning:", err?.message || err);
    }
  }

  // Remove local fallback storage files
  for (const key of params.keys) {
    const filePath = getLocalFilePath(bucketName, key);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }
    const metaPath = `${filePath}.meta.json`;
    if (fs.existsSync(metaPath)) {
      try {
        fs.unlinkSync(metaPath);
      } catch {
        // ignore
      }
    }
  }

  return {
    success: true,
    deleted: deletedKeys,
  };
}

function scanDirRecursive(dir: string, baseDir: string): Array<{ key: string; size: number; lastModified?: Date }> {
  let results: Array<{ key: string; size: number; lastModified?: Date }> = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(scanDirRecursive(fullPath, baseDir));
    } else if (entry.isFile() && !entry.name.endsWith(".meta.json")) {
      const stats = fs.statSync(fullPath);
      const relativeKey = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      results.push({
        key: relativeKey,
        size: stats.size,
        lastModified: stats.mtime,
      });
    }
  }
  return results;
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
  const client = getR2S3Client();

  if (client) {
    try {
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: params.prefix || "",
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
      console.warn("[R2Server] Remote R2 listObjects warning:", err?.message || err);
    }
  }

  // Local fallback listing
  const safeBucket = bucketName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const bucketDir = path.join(LOCAL_STORAGE_DIR, safeBucket);
  const allFiles = scanDirRecursive(bucketDir, bucketDir);
  const prefix = (params.prefix || "").replace(/^\/+/, "");

  const filtered = allFiles.filter((f) => f.key.startsWith(prefix));
  const max = params.maxKeys || 1000;
  const sliced = filtered.slice(0, max);

  return {
    objects: sliced,
    isTruncated: filtered.length > max,
  };
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
  metadata?: Record<string, string>;
}> {
  const config = getR2ServerConfig();
  const bucketName = params.bucket || config.bucket;
  const client = getR2S3Client();

  if (client) {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucketName,
        Key: params.key,
      });
      const response = await client.send(command);
      return {
        exists: true,
        contentLength: response.ContentLength,
        contentType: response.ContentType,
        lastModified: response.LastModified,
        metadata: response.Metadata,
      };
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        // check local
      } else {
        console.warn("[R2Server] Remote R2 headObject warning:", err?.message || err);
      }
    }
  }

  // Local fallback check
  const filePath = getLocalFilePath(bucketName, params.key);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    return {
      exists: true,
      contentLength: stats.size,
      lastModified: stats.mtime,
    };
  }

  return { exists: false };
}

/**
 * Unified Cloudflare R2 Storage Service
 * 
 * Production-ready storage service replacing Supabase Storage with Cloudflare R2.
 * Preserves all existing method signatures, path conventions, UPSC hierarchy structures,
 * progress callbacks, and viewer resolution logic.
 */

import {
  getR2BucketName,
  getR2PublicUrl,
  getR2SignedUrl,
  uploadToR2,
  downloadFromR2,
  deleteFromR2,
  deleteMultipleFromR2,
  listFromR2,
  type R2UploadResult,
  type R2ObjectInfo,
} from "./r2Client";
import { safeLocalStorageSetItem } from "./safeStorage";

const PDF_MIME_TYPE = "application/pdf";

function getRuntimeEnvValue(key: string, fallback = ""): string {
  try {
    const env = typeof import.meta !== "undefined" ? (import.meta as any).env : undefined;
    if (env && typeof env[key] === "string") {
      return env[key];
    }
  } catch {
    // Ignore env lookup issues in non-Vite runtimes.
  }
  return fallback;
}

function isInvalidStorageReference(input: string): boolean {
  const clean = String(input || "").trim().toLowerCase();
  if (clean.includes("/api/r2/")) {
    return false; // Valid proxy endpoint
  }
  return (
    clean.startsWith("blob:") ||
    clean.startsWith("data:") ||
    clean.startsWith("file://") ||
    clean.includes("temporary") ||
    clean.includes("temp/") ||
    clean.includes("tmp/")
  );
}

function normalizeUploadedStoragePath(bucket: string, rawPath: string): string {
  const sanitized = sanitizeStoragePath(rawPath, bucket);
  if (!sanitized) {
    throw new Error("Invalid storage path specified.");
  }
  return sanitized;
}

function validatePdfBlob(blob: Blob | null): Blob {
  if (!blob) {
    throw new Error("File not found.");
  }

  if (!(blob instanceof Blob)) {
    throw new Error("Invalid PDF response.");
  }

  if (blob.size <= 0) {
    throw new Error("Empty file.");
  }

  const mimeType = (blob.type || "").toLowerCase();
  if (mimeType && mimeType !== PDF_MIME_TYPE && !mimeType.includes("octet-stream")) {
    throw new Error(`Invalid PDF MIME type: ${mimeType}`);
  }

  return blob;
}

export interface R2UploadMetadata {
  storageProvider: "r2" | "supabase";
  bucket: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: string;
  downloadUrl: string;
}

// Backward compatibility alias
export type SupabaseUploadMetadata = R2UploadMetadata;

/**
 * Returns the configured Cloudflare R2 bucket name.
 */
export function getBucketName(customBucket?: string): string {
  return getR2BucketName(customBucket);
}

/**
 * Sanitizes and normalizes raw storage paths or URLs into a clean, relative Cloudflare R2 storage key.
 * Ensures:
 * - No leading slashes
 * - No double slashes
 * - Bucket name is not duplicated inside path
 * - No undefined, null, or empty path segments
 * - Only valid URL-safe characters in path segments
 */
export function sanitizeStoragePath(rawPath: string | null | undefined, bucketName?: string): string {
  if (!rawPath) return "";

  let cleaned = String(rawPath).trim();
  if (!cleaned) return "";

  if (isInvalidStorageReference(cleaned)) {
    console.error(`[StorageService] Rejected invalid storage reference:`, cleaned);
    return "";
  }

  // 0. Handle JSON metadata strings
  if (cleaned.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.storagePath) {
        cleaned = String(parsed.storagePath).trim();
      } else if (parsed.downloadUrl) {
        cleaned = String(parsed.downloadUrl).trim();
      } else if (parsed.url) {
        cleaned = String(parsed.url).trim();
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }

  // 1. Check for /api/r2/download or /api/r2/view endpoint (either absolute or relative URL)
  if (cleaned.includes("/api/r2/download") || cleaned.includes("/api/r2/view") || cleaned.includes("/api/r2/signed-url")) {
    try {
      const fakeBase = "http://localhost";
      const urlObj = new URL(cleaned.startsWith("http") ? cleaned : `${fakeBase}${cleaned.startsWith("/") ? "" : "/"}${cleaned}`);
      const keyParam = urlObj.searchParams.get("key");
      if (keyParam) {
        cleaned = decodeURIComponent(keyParam);
      }
    } catch {
      const match = cleaned.match(/[?&]key=([^&]+)/);
      if (match && match[1]) {
        cleaned = decodeURIComponent(match[1]);
      }
    }
  }

  // 2. Normalize slashes & remove quotes
  cleaned = cleaned.replace(/\\/g, "/");
  cleaned = cleaned.replace(/^["']|["']$/g, "");

  // 3. Handle gs:// or s3:// protocol URLs
  if (cleaned.startsWith("gs://") || cleaned.startsWith("s3://")) {
    const withoutPrefix = cleaned.substring(5);
    const slashIdx = withoutPrefix.indexOf("/");
    if (slashIdx !== -1) {
      cleaned = withoutPrefix.substring(slashIdx + 1);
    } else {
      cleaned = "";
    }
  }

  // 4. Extract path from full HTTPS URLs (e.g. public R2 domain or Supabase legacy URL)
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    try {
      const urlObj = new URL(cleaned);
      const pathname = urlObj.pathname;

      if (pathname.includes("/api/r2/download") && urlObj.searchParams.get("key")) {
        return sanitizeStoragePath(urlObj.searchParams.get("key")!, bucketName);
      }

      const supabaseMatch = pathname.match(
        /\/storage\/v1\/object\/(?:public|sign|authenticated)\/[^\/]+\/(.+)/
      );
      if (supabaseMatch && supabaseMatch[1]) {
        try {
          cleaned = decodeURIComponent(supabaseMatch[1]);
        } catch {
          cleaned = supabaseMatch[1];
        }
      } else {
        const pathSegments = pathname.replace(/^\/+/, "").split("/");
        const activeBucket = getBucketName(bucketName);
        if (pathSegments[0] === activeBucket) {
          pathSegments.shift();
        }
        if (pathSegments.length > 0) {
          cleaned = pathSegments.join("/");
        } else {
          return "";
        }
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
  }

  // 5. Safely decode URI encoded characters if present
  if (cleaned.includes("%")) {
    try {
      let decoded = decodeURIComponent(cleaned);
      if (decoded.includes("%")) {
        decoded = decodeURIComponent(decoded);
      }
      cleaned = decoded;
    } catch {
      // Keep cleaned as is if decode fails
    }
  }

  // 6. Strip query parameters and hash fragments (if any remain)
  if (cleaned.includes("?")) {
    cleaned = cleaned.split("?")[0];
  }
  if (cleaned.includes("#")) {
    cleaned = cleaned.split("#")[0];
  }

  // 7. Remove leading and duplicate slashes
  cleaned = cleaned.replace(/^\/+/, "").replace(/\/+/g, "/");

  // 8. Strip duplicate bucket prefix if present
  const activeBucket = getBucketName(bucketName);
  const prefixes = [
    activeBucket + "/",
    "academy-connect-files/",
    "notes/notes/",
    "profile-photos/profile-photos/",
    "reports/reports/",
  ];

  for (const prefix of prefixes) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.substring(prefix.length);
    }
  }

  // Strip leading slashes again after prefix removal
  cleaned = cleaned.replace(/^\/+/, "");

  // 9. Remove trailing slashes
  cleaned = cleaned.replace(/\/+$/, "");

  // 10. Clean individual path segments
  const segments = cleaned
    .split("/")
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0 && seg !== "." && seg !== "..");

  const finalPath = segments.join("/");
  return finalPath;
}

/**
 * Path builder helpers ensuring sanitized input segments
 */
export function buildNoteStoragePath(studentId: string, fileName: string): string {
  const safeStudentId = (studentId || "general").replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  const cleanFileName = (fileName || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
  const raw = `notes/${safeStudentId}/${timestamp}-${cleanFileName}`;
  return sanitizeStoragePath(raw);
}

export function buildProfilePhotoStoragePath(userId: string, originalFileName: string = "profile.png"): string {
  const safeUserId = (userId || "user").replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  const cleanFileName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const raw = `profile-photos/${safeUserId}/${timestamp}-${random}-${cleanFileName}`;
  return sanitizeStoragePath(raw);
}

export function buildReportStoragePath(studentId: string, fileName: string): string {
  const safeStudentId = (studentId || "student").replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const raw = `reports/${safeStudentId}/${timestamp}-${random}-${cleanFileName}`;
  return sanitizeStoragePath(raw);
}

export function buildQuestionImageStoragePath(topicOrTestId: string, originalFileName: string = "image.png"): string {
  const safeTopic = (topicOrTestId || "practice-tests").replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  const cleanFileName = (originalFileName || "image.png").replace(/[^a-zA-Z0-9._-]/g, "_");
  const raw = `question-images/${safeTopic}/${timestamp}-${random}-${cleanFileName}`;
  return sanitizeStoragePath(raw);
}

/**
 * Uploads a file or blob to Cloudflare R2 Storage.
 * Logs bucket name, upload key, and storage responses.
 * Throws exact error message if upload fails.
 */
export async function uploadFileToR2(
  bucketInput: string,
  rawPath: string,
  file: File | Blob,
  fileName: string,
  uploadedBy: string = "System",
  onProgress?: (percent: number) => void
): Promise<R2UploadMetadata> {
  const bucket = getBucketName(bucketInput);
  const sanitizedPath = normalizeUploadedStoragePath(bucket, rawPath);
  const isPdf = fileName.toLowerCase().endsWith(".pdf");
  const isImage = fileName.toLowerCase().match(/\.(png|jpg|jpeg|webp|gif|svg)$/i) || (!isPdf && (file.type || "").startsWith("image"));
  const mimeType = file.type || (isPdf ? PDF_MIME_TYPE : isImage ? "image/jpeg" : "application/octet-stream");

  console.log(`[StorageService] Uploading file to Cloudflare R2:`);
  console.log(`  - Bucket Name: "${bucket}"`);
  console.log(`  - Storage Path: "${sanitizedPath}"`);
  console.log(`  - File Name: "${fileName}"`);
  console.log(`  - Size: ${file.size} bytes`);
  console.log(`  - MIME Type: "${mimeType}"`);

  if (!sanitizedPath) {
    const pathError = "Invalid storage path constructed (path is empty).";
    console.error(`[StorageService] Upload Aborted: ${pathError}`);
    throw new Error(`Cloudflare R2 Storage Error: ${pathError}`);
  }

  const uploadResult = await uploadToR2({
    bucket,
    key: sanitizedPath,
    file,
    mimeType,
    onProgress,
  });

  const successPath = sanitizedPath;
  let downloadUrl = uploadResult.url;

  try {
    const resolved = await getResolvedViewUrl(bucket, successPath);
    if (resolved) downloadUrl = resolved;
  } catch (urlError) {
    console.warn("[StorageService] Failed to generate resolved URL post-upload, using public URL:", urlError);
  }

  const metadata: R2UploadMetadata = {
    storageProvider: "r2",
    bucket,
    storagePath: successPath,
    fileName,
    fileSize: file.size,
    mimeType,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    downloadUrl,
  };

  console.log(`[StorageService] Cloudflare R2 upload complete. Metadata:`, metadata);
  return metadata;
}

// Backward compatible alias
export const uploadFileToSupabase = uploadFileToR2;

/**
 * Uploads a PDF note to Cloudflare R2.
 */
export async function uploadPdfToStorage(
  studentId: string,
  subject: string,
  fileName: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  const fileHash = `${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}_${file.size}`;
  const localCacheKey = `uploaded_pdf_${studentId}_${fileHash}`;

  let cachedResult = "";
  try {
    const storageApi = typeof globalThis !== "undefined" ? (globalThis as any).localStorage : undefined;
    cachedResult = storageApi ? storageApi.getItem(localCacheKey) || "" : "";
  } catch {
    cachedResult = "";
  }

  if (cachedResult) {
    try {
      const parsed = JSON.parse(cachedResult);
      if (parsed && parsed.storagePath) {
        console.log(`[StorageService] Reusing cached upload metadata:`, parsed);
        if (onProgress) onProgress(100);
        return cachedResult;
      }
    } catch (e) {
      // Ignore stale cache
    }
  }

  const bucket = getBucketName();
  const storagePath = buildNoteStoragePath(studentId, fileName);

  console.log(`[StorageService] Initiating PDF note upload to R2. Bucket: "${bucket}", Path: "${storagePath}"`);

  const metadata = await uploadFileToR2(
    bucket,
    storagePath,
    file,
    fileName,
    "Admin",
    onProgress
  );

  const resultString = JSON.stringify(metadata);
  safeLocalStorageSetItem(localCacheKey, resultString);

  return resultString;
}

/**
 * Uploads a profile photo to Cloudflare R2.
 */
export async function uploadProfilePhoto(
  userId: string,
  dataUrl: string,
  originalFileName: string = "profile.png"
): Promise<R2UploadMetadata> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  const bucket = getBucketName();
  const storagePath = buildProfilePhotoStoragePath(userId, originalFileName);

  console.log(`[StorageService] Uploading profile photo to R2. Bucket: "${bucket}", Path: "${storagePath}"`);

  const metadata = await uploadFileToR2(
    bucket,
    storagePath,
    blob,
    originalFileName,
    "User"
  );

  return metadata;
}

/**
 * Uploads a progress or performance report to Cloudflare R2.
 */
export async function uploadReportToStorage(
  studentId: string,
  reportBlob: Blob,
  fileName: string
): Promise<R2UploadMetadata> {
  const bucket = getBucketName();
  const storagePath = buildReportStoragePath(studentId, fileName);

  console.log(`[StorageService] Uploading report to R2. Bucket: "${bucket}", Path: "${storagePath}"`);

  const metadata = await uploadFileToR2(
    bucket,
    storagePath,
    reportBlob,
    fileName,
    "Admin"
  );

  return metadata;
}

/**
 * Helper to compress image blobs before storage upload or data URL fallback
 */
async function compressImageForStorage(blob: Blob, maxDim = 1000, quality = 0.85): Promise<{ blob: Blob; dataUrl: string }> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.createImageBitmap) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = (reader.result as string) || "";
        resolve({ blob, dataUrl: res });
      };
      reader.readAsDataURL(blob);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.width;
      let height = img.height;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        canvas.toBlob(
          (compressedBlob) => {
            resolve({ blob: compressedBlob || blob, dataUrl });
          },
          "image/jpeg",
          quality
        );
      } else {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({ blob, dataUrl: (reader.result as string) || "" });
        };
        reader.readAsDataURL(blob);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({ blob, dataUrl: (reader.result as string) || "" });
      };
      reader.readAsDataURL(blob);
    };
    img.src = url;
  });
}

/**
 * Uploads a question image to Cloudflare R2.
 */
export async function uploadQuestionImageToStorage(
  topicOrTestId: string,
  fileInput: File | Blob | string,
  fileName: string = "question-image.png"
): Promise<R2UploadMetadata> {
  let blob: Blob;
  let cleanName = fileName;

  if (typeof fileInput === "string") {
    if (fileInput.startsWith("data:") || fileInput.startsWith("blob:")) {
      const res = await fetch(fileInput);
      blob = await res.blob();
    } else {
      return {
        storageProvider: "r2",
        bucket: getBucketName(),
        storagePath: fileInput,
        fileName: cleanName,
        fileSize: 0,
        mimeType: "image/png",
        uploadedAt: new Date().toISOString(),
        uploadedBy: "Admin",
        downloadUrl: fileInput,
      };
    }
  } else {
    blob = fileInput;
    if (fileInput instanceof File && fileInput.name) {
      cleanName = fileInput.name;
    }
  }

  const bucket = getBucketName();
  const storagePath = buildQuestionImageStoragePath(topicOrTestId, cleanName);

  console.log(`[StorageService] Uploading question image to R2. Bucket: "${bucket}", Path: "${storagePath}"`);

  // Compress image before upload to keep payload small and crisp
  const compressed = await compressImageForStorage(blob, 1000, 0.85);

  try {
    const metadata = await uploadFileToR2(
      bucket,
      storagePath,
      compressed.blob,
      cleanName,
      "Admin"
    );
    return metadata;
  } catch (err: any) {
    console.warn("[StorageService] Cloudflare R2 upload error, using compressed Data URL fallback:", err);
    return {
      storageProvider: "r2",
      bucket,
      storagePath: storagePath,
      fileName: cleanName,
      fileSize: compressed.blob.size,
      mimeType: "image/jpeg",
      uploadedAt: new Date().toISOString(),
      uploadedBy: "Admin",
      downloadUrl: compressed.dataUrl,
    };
  }
}

/**
 * Resolves a fresh signed URL (or public URL) for viewing or downloading files from Cloudflare R2.
 */
export async function getResolvedViewUrl(
  bucketInput?: string,
  rawPathOrUrl?: string
): Promise<string> {
  const bucket = getBucketName(bucketInput);

  if (!rawPathOrUrl) {
    console.error("[StorageService] Missing storage path or URL");
    throw new Error("File path is missing.");
  }

  let cleanInput = String(rawPathOrUrl).trim();

  // Parse JSON metadata string if provided
  if (cleanInput.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleanInput);
      if (parsed.storagePath) {
        cleanInput = String(parsed.storagePath).trim();
      } else if (parsed.downloadUrl) {
        cleanInput = String(parsed.downloadUrl).trim();
      } else if (parsed.url) {
        cleanInput = String(parsed.url).trim();
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }

  if (cleanInput.startsWith("data:") || cleanInput.startsWith("blob:")) {
    console.log("[StorageService] Path is Base64 Data or Blob URL.");
    return cleanInput;
  }

  if (isInvalidStorageReference(cleanInput)) {
    console.error(`[StorageService] Rejected invalid storage path reference for bucket "${bucket}":`, cleanInput);
    throw new Error("Invalid storage path specified.");
  }

  // If cleanInput is already a full external HTTP/HTTPS URL not pointing to internal storage, return directly
  if (cleanInput.startsWith("http://") || cleanInput.startsWith("https://")) {
    const isInternal = cleanInput.includes("/api/r2/") || cleanInput.includes("r2.cloudflarestorage.com") || cleanInput.includes("/storage/v1/object/");
    if (!isInternal) {
      console.log(`[StorageService] Using external direct URL: ${cleanInput}`);
      return cleanInput;
    }
  }

  const sanitizedPath = sanitizeStoragePath(cleanInput, bucket);

  console.log(`[StorageService] Resolving View URL:`);
  console.log(`  - Bucket: "${bucket}"`);
  console.log(`  - Raw Input: "${rawPathOrUrl}"`);
  console.log(`  - Sanitized Relative Path: "${sanitizedPath}"`);

  if (!sanitizedPath) {
    if (cleanInput.startsWith("http://") || cleanInput.startsWith("https://")) {
      return cleanInput;
    }
    throw new Error("Invalid storage path specified.");
  }

  // Same-origin proxy URL gives reliable streaming, handles HTTP range, and bypasses CORS restrictions
  const proxyUrl = `/api/r2/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(sanitizedPath)}`;
  console.log(`[StorageService] Final URL used by viewer (R2 Proxy): ${proxyUrl}`);
  return proxyUrl;
}

/**
 * Downloads a file directly from Cloudflare R2.
 */
export async function downloadFileFromStorage(
  bucketInput: string,
  rawStoragePath: string,
  fileName: string
): Promise<void> {
  const bucket = getBucketName(bucketInput);
  const storagePath = sanitizeStoragePath(rawStoragePath, bucket);

  console.log("=== [CLOUDFLARE R2 DOWNLOAD AUDIT] ===");
  console.log("bucket:", bucket);
  console.log("storagePath:", storagePath);

  if (!storagePath) {
    throw new Error("Invalid storage path specified.");
  }

  const { blob } = await downloadFromR2({ bucket, key: storagePath });
  const validatedBlob = validatePdfBlob(blob);

  console.log(`[StorageService] Download validation succeeded. bucket=${bucket} path=${storagePath} blobSize=${validatedBlob.size} mimeType=${validatedBlob.type || "unknown"}`);

  const blobUrl = URL.createObjectURL(validatedBlob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

  console.log(`[StorageService] Successfully downloaded: ${fileName}`);
}

/**
 * Deletes a file from Cloudflare R2.
 */
export async function deleteFileFromStorage(
  rawStoragePath: string,
  bucketInput?: string
): Promise<{ success: boolean; data?: any; storagePath: string; bucket: string }> {
  const bucket = getBucketName(bucketInput);
  if (!rawStoragePath) {
    console.warn("[StorageService] No storage path provided for deletion.");
    return { success: true, storagePath: "", bucket };
  }

  let cleanPath = String(rawStoragePath).trim();

  // If rawStoragePath is a JSON metadata string, parse it to extract storage path or URL
  if (cleanPath.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleanPath);
      cleanPath = parsed.storagePath || parsed.downloadUrl || parsed.url || cleanPath;
    } catch (e) {
      // ignore
    }
  }

  if (
    cleanPath.startsWith("data:") ||
    cleanPath.startsWith("blob:") ||
    (cleanPath.startsWith("http") && !cleanPath.includes("r2") && !cleanPath.includes("/api/r2/"))
  ) {
    console.log(`[StorageService] Path is base64 data, blob URL, or external URL. Skipping Cloudflare R2 deletion.`);
    return { success: true, storagePath: cleanPath, bucket };
  }

  const storagePath = sanitizeStoragePath(cleanPath, bucket);

  if (!storagePath) {
    console.warn(`[StorageService] Unable to sanitize storage path from cleanPath="${cleanPath}".`);
    return { success: true, storagePath: "", bucket };
  }

  console.log(`[StorageService] Invoking Cloudflare R2 delete: bucket="${bucket}", storagePath="${storagePath}"`);

  try {
    const result = await deleteFromR2({ bucket, key: storagePath });
    console.log(`[StorageService] Successfully removed file from Cloudflare R2: "${storagePath}"`);

    // Clear entry from browser Cache Storage if present
    try {
      if (typeof window !== "undefined" && "caches" in window) {
        const cache = await caches.open("student-pdf-cache");
        const keys = await cache.keys();
        for (const req of keys) {
          if (req.url.includes(storagePath) || req.url.includes(encodeURIComponent(storagePath))) {
            await cache.delete(req);
            console.log(`[StorageService Cache] Removed cached entry for path: ${storagePath}`);
          }
        }
      }
    } catch (cacheErr) {
      console.warn(`[StorageService Cache] Warning while clearing Cache Storage:`, cacheErr);
    }

    return { success: true, data: result, storagePath, bucket };
  } catch (error: any) {
    const errorMsg = error.message || JSON.stringify(error);
    const isNotFound =
      errorMsg.toLowerCase().includes("not found") ||
      errorMsg.toLowerCase().includes("does not exist") ||
      errorMsg.toLowerCase().includes("not_found") ||
      error.status === 404;

    if (isNotFound) {
      console.warn(`[StorageService Warning] File no longer exists in Cloudflare R2: "${storagePath}". Proceeding.`);
      return { success: true, storagePath, bucket };
    }

    console.error(`[StorageService Error] Cloudflare R2 removal failed for path "${storagePath}":`, error);
    throw new Error(`Cloudflare R2 deletion failed: ${errorMsg}`);
  }
}

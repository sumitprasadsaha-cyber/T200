import { supabase } from "./supabaseClient";
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
  return (
    clean.startsWith("blob:") ||
    clean.startsWith("data:") ||
    clean.startsWith("file://") ||
    clean.includes("localhost") ||
    clean.includes("127.0.0.1") ||
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
  if (mimeType && mimeType !== PDF_MIME_TYPE) {
    throw new Error(`Invalid PDF MIME type: ${mimeType}`);
  }

  return blob;
}

export interface SupabaseUploadMetadata {
  storageProvider: "supabase";
  bucket: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: string;
  downloadUrl: string;
}

/**
 * Returns the configured Supabase Storage bucket name.
 */
export function getBucketName(customBucket?: string): string {
  if (customBucket && typeof customBucket === "string" && customBucket.trim().length > 0) {
    const cleanCustom = customBucket.trim().replace(/^\/+|\/+$/g, "");
    if (
      cleanCustom.length > 0 &&
      cleanCustom !== "academy-connect-500d1.firebasestorage.app" &&
      !cleanCustom.includes("firebasestorage.app")
    ) {
      return cleanCustom;
    }
  }
  const envBucket = getRuntimeEnvValue("VITE_SUPABASE_BUCKET", "academy-connect-files");
  return envBucket.trim().replace(/^\/+|\/+$/g, "");
}

/**
 * Sanitizes and normalizes raw storage paths or URLs into a clean, relative Supabase storage path.
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

  // 1. Remove quotes
  cleaned = cleaned.replace(/^["']|["']$/g, "");

  // 2. Strip query parameters and hash fragments if not a full HTTPS URL
  if (cleaned.includes("?") && !cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    cleaned = cleaned.split("?")[0];
  }
  if (cleaned.includes("#") && !cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
    cleaned = cleaned.split("#")[0];
  }

  // 3. Handle gs:// protocol URLs
  if (cleaned.startsWith("gs://")) {
    const gsWithoutPrefix = cleaned.substring(5);
    const slashIdx = gsWithoutPrefix.indexOf("/");
    if (slashIdx !== -1) {
      cleaned = gsWithoutPrefix.substring(slashIdx + 1);
    } else {
      cleaned = "";
    }
  }

  // 4. Extract path from full HTTPS URLs if provided
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    try {
      const urlObj = new URL(cleaned);
      const pathname = urlObj.pathname;
      const storageMatch = pathname.match(
        /\/storage\/v1\/object\/(?:public|sign|authenticated)\/[^\/]+\/(.+)/
      );
      if (storageMatch && storageMatch[1]) {
        try {
          cleaned = decodeURIComponent(storageMatch[1]);
        } catch {
          cleaned = storageMatch[1];
        }
      } else {
        // External non-Supabase HTTP/HTTPS URL
        return "";
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
  }

  // 5. Remove leading slashes
  cleaned = cleaned.replace(/^\/+/, "");

  // 6. Strip duplicate bucket prefix if present
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

  // 7. Remove trailing slashes
  cleaned = cleaned.replace(/\/+$/, "");

  // 8. Clean individual path segments
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
 * Uploads a file or blob to Supabase Storage.
 * Logs final bucket name, upload path, and storage responses.
 * Throws exact error message if upload fails.
 */
export async function uploadFileToSupabase(
  bucketInput: string,
  rawPath: string,
  file: File | Blob,
  fileName: string,
  uploadedBy: string = "System",
  onProgress?: (percent: number) => void
): Promise<SupabaseUploadMetadata> {
  const bucket = getBucketName(bucketInput);
  const sanitizedPath = normalizeUploadedStoragePath(bucket, rawPath);
  const isPdf = fileName.toLowerCase().endsWith(".pdf");
  const isImage = fileName.toLowerCase().match(/\.(png|jpg|jpeg|webp|gif|svg)$/i) || (!isPdf && (file.type || "").startsWith("image"));
  const mimeType = file.type || (isPdf ? PDF_MIME_TYPE : isImage ? "image/jpeg" : "application/octet-stream");

  console.log(`[StorageService] Uploading file to Supabase Storage:`);
  console.log(`  - Bucket Name: "${bucket}"`);
  console.log(`  - Upload Path: "${sanitizedPath}"`);
  console.log(`  - File Name: "${fileName}"`);
  console.log(`  - Size: ${file.size} bytes`);
  console.log(`  - MIME Type: "${mimeType}"`);

  if (!sanitizedPath) {
    const pathError = "Invalid storage path constructed (path is empty).";
    console.error(`[StorageService] Upload Aborted: ${pathError}`);
    throw new Error(`Supabase Storage Error: ${pathError}`);
  }

  if (onProgress) onProgress(10);

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(sanitizedPath, file, {
      contentType: mimeType,
      upsert: true
    });

  console.log("[StorageService] Supabase upload response object:", { data, error });

  if (error) {
    const rawErrorMsg = error.message || JSON.stringify(error);
    console.error("[StorageService] SUPABASE UPLOAD FAILURE DETAILS:", {
      bucket,
      storagePath: sanitizedPath,
      fileName,
      error
    });
    throw new Error(`Supabase Storage Error: ${rawErrorMsg}`);
  }

  if (onProgress) onProgress(100);

  const successPath = data?.path ? sanitizeStoragePath(data.path, bucket) : sanitizedPath;

  let downloadUrl = "";
  try {
    downloadUrl = await getResolvedViewUrl(bucket, successPath);
  } catch (urlError) {
    console.warn("[StorageService] Failed to generate resolved URL post-upload, using fallback:", urlError);
    const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(successPath);
    downloadUrl = publicData?.publicUrl || successPath;
  }

  const metadata: SupabaseUploadMetadata = {
    storageProvider: "supabase",
    bucket,
    storagePath: successPath,
    fileName,
    fileSize: file.size,
    mimeType,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    downloadUrl,
  };

  console.log(`[StorageService] Upload complete. Metadata:`, metadata);
  return metadata;
}

/**
 * Uploads a PDF note to Supabase Storage.
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

  console.log(`[StorageService] Initiating PDF note upload. Bucket: "${bucket}", Path: "${storagePath}"`);

  const metadata = await uploadFileToSupabase(
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
 * Uploads a profile photo to Supabase Storage.
 */
export async function uploadProfilePhoto(
  userId: string,
  dataUrl: string,
  originalFileName: string = "profile.png"
): Promise<SupabaseUploadMetadata> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  const bucket = getBucketName();
  const storagePath = buildProfilePhotoStoragePath(userId, originalFileName);

  console.log(`[StorageService] Uploading profile photo. Bucket: "${bucket}", Path: "${storagePath}"`);

  const metadata = await uploadFileToSupabase(
    bucket,
    storagePath,
    blob,
    originalFileName,
    "User"
  );

  return metadata;
}

/**
 * Uploads a progress or performance report to Supabase Storage.
 */
export async function uploadReportToStorage(
  studentId: string,
  reportBlob: Blob,
  fileName: string
): Promise<SupabaseUploadMetadata> {
  const bucket = getBucketName();
  const storagePath = buildReportStoragePath(studentId, fileName);

  console.log(`[StorageService] Uploading report. Bucket: "${bucket}", Path: "${storagePath}"`);

  const metadata = await uploadFileToSupabase(
    bucket,
    storagePath,
    reportBlob,
    fileName,
    "Admin"
  );

  return metadata;
}

/**
 * Uploads a question image to Supabase Storage.
 */
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

export async function uploadQuestionImageToStorage(
  topicOrTestId: string,
  fileInput: File | Blob | string,
  fileName: string = "question-image.png"
): Promise<SupabaseUploadMetadata> {
  let blob: Blob;
  let cleanName = fileName;

  if (typeof fileInput === "string") {
    if (fileInput.startsWith("data:") || fileInput.startsWith("blob:")) {
      const res = await fetch(fileInput);
      blob = await res.blob();
    } else {
      return {
        storageProvider: "supabase",
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

  console.log(`[StorageService] Uploading question image. Bucket: "${bucket}", Path: "${storagePath}"`);

  // Compress image before upload to keep payload small and crisp
  const compressed = await compressImageForStorage(blob, 1000, 0.85);

  try {
    const metadata = await uploadFileToSupabase(
      bucket,
      storagePath,
      compressed.blob,
      cleanName,
      "Admin"
    );
    return metadata;
  } catch (err: any) {
    console.warn("[StorageService] Supabase Storage upload error, using compressed Data URL fallback:", err);
    return {
      storageProvider: "supabase",
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
 * Resolves a fresh signed URL (or public URL) for viewing or downloading files.
 * Always generates a fresh signed URL to prevent HTTP 401 Unauthorized errors from expired tokens.
 */
export async function getResolvedViewUrl(
  bucketInput?: string,
  rawPathOrUrl?: string
): Promise<string> {
  const bucket = getBucketName(bucketInput);
  const bucketIsPublic = String(getRuntimeEnvValue("VITE_SUPABASE_BUCKET_PUBLIC", "true")).trim().toLowerCase() === "true";

  if (!rawPathOrUrl) {
    console.error("[StorageService] Missing storage path or URL");
    throw new Error("PDF path is missing.");
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

  // If cleanInput is an external HTTP/HTTPS URL that is NOT a Supabase storage URL, return it directly
  if (cleanInput.startsWith("http://") || cleanInput.startsWith("https://")) {
    const isSupabaseStorage = cleanInput.includes("/storage/v1/object/");
    if (!isSupabaseStorage) {
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
      console.log(`[StorageService] Using direct HTTP URL fallback: ${cleanInput}`);
      return cleanInput;
    }
    throw new Error("Invalid storage path specified.");
  }

  // Try generating a signed URL first (expires in 10 years = 315360000s)
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(sanitizedPath, 315360000);

    if (!error && data?.signedUrl) {
      console.log(`[StorageService] Final URL used by viewer (Fresh Signed URL): ${data.signedUrl}`);
      return data.signedUrl;
    }

    if (error) {
      console.warn(`[StorageService] createSignedUrl warning (${error.message}). Falling back to public URL.`);
    }
  } catch (err: any) {
    console.warn(`[StorageService] createSignedUrl exception (${err.message}). Falling back to public URL.`);
  }

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(sanitizedPath);
  const finalPublicUrl = publicData?.publicUrl || (cleanInput.startsWith("http") ? cleanInput : "");
  console.log(`[StorageService] Final URL used by viewer (Public URL Fallback): ${finalPublicUrl}`);

  return finalPublicUrl || cleanInput;
}

/**
 * Downloads a file directly from Supabase Storage.
 */
export async function downloadFileFromStorage(
  bucketInput: string,
  rawStoragePath: string,
  fileName: string
): Promise<void> {
  const bucket = getBucketName(bucketInput);
  const storagePath = sanitizeStoragePath(rawStoragePath, bucket);

  console.log("=== [STORAGE DOWNLOAD AUDIT] ===");
  console.log("bucket:", bucket);
  console.log("storagePath:", storagePath);

  if (!storagePath) {
    throw new Error("Invalid storage path specified.");
  }

  let pdfBlob: Blob | null = null;
  let lastError: any = null;

  // 1. Try direct Supabase download()
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);

  console.log("error:", error);
  console.log("data:", data);

  if (!error && data && data.size > 0) {
    pdfBlob = data;
  } else {
    lastError = error;
    console.warn(`[StorageService] download() failed or returned empty blob. Trying createSignedUrl fallback...`);

    // 2. Fallback: try createSignedUrl(storagePath, 3600)
    const { data: signedData, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 3600);

    console.log("signedUrl error:", signedError);
    console.log("signedUrl data:", signedData);

    if (!signedError && signedData?.signedUrl) {
      try {
        const fetchRes = await fetch(signedData.signedUrl);
        if (fetchRes.ok) {
          const blobFromSigned = await fetchRes.blob();
          if (blobFromSigned && blobFromSigned.size > 0) {
            pdfBlob = blobFromSigned;
            lastError = null;
            console.log(`[StorageService] Download via signed URL succeeded (${blobFromSigned.size} bytes).`);
          }
        } else {
          console.warn(`[StorageService] Signed URL fetch returned HTTP ${fetchRes.status}`);
        }
      } catch (fetchErr) {
        console.warn(`[StorageService] Signed URL fetch exception:`, fetchErr);
      }
    }
  }

  if (!pdfBlob) {
    const errMsg = lastError?.message || lastError?.error_description || "Object not found or permission denied in Supabase Storage.";
    throw new Error(`Supabase Storage Error: ${errMsg} (Bucket: "${bucket}", Path: "${storagePath}")`);
  }

  const validatedBlob = validatePdfBlob(pdfBlob);

  // Verify magic bytes
  try {
    const magicSlice = validatedBlob.slice(0, 5);
    const magicText = await magicSlice.text();
    if (!magicText.startsWith("%PDF") && !magicText.startsWith("JVBER")) {
      const errorSlice = validatedBlob.slice(0, 500);
      const errorText = await errorSlice.text();
      if (errorText.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(errorText);
          throw new Error(`Supabase Storage Error: ${parsed.message || parsed.error || errorText} (Bucket: "${bucket}", Path: "${storagePath}")`);
        } catch (e: any) {
          if (e.message?.includes("Supabase Storage Error")) throw e;
        }
      }
      throw new Error(`Invalid PDF document format: header does not match %PDF (received "${magicText.substring(0, 10)}"). Path: "${storagePath}"`);
    }
  } catch (magicErr: any) {
    if (magicErr.message?.includes("Invalid PDF") || magicErr.message?.includes("Supabase Storage Error")) throw magicErr;
  }

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
 * Deletes a file from Supabase Storage.
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
    (cleanPath.startsWith("http") && !cleanPath.includes("supabase"))
  ) {
    console.log(`[StorageService] Path is base64 data, blob URL, or non-Supabase external URL. Skipping Supabase Storage deletion.`);
    return { success: true, storagePath: cleanPath, bucket };
  }

  const storagePath = sanitizeStoragePath(cleanPath, bucket);

  if (!storagePath) {
    console.warn(`[StorageService] Unable to sanitize storage path from cleanPath="${cleanPath}".`);
    return { success: true, storagePath: "", bucket };
  }

  console.log(`[StorageService] Invoking Supabase remove(): bucket="${bucket}", storagePath="${storagePath}"`);

  const { data, error } = await supabase.storage.from(bucket).remove([storagePath]);

  console.log(`[StorageService] Storage removal response:`, { bucket, storagePath, data, error });

  if (error) {
    const errorMsg = error.message || JSON.stringify(error);
    const isNotFound =
      errorMsg.toLowerCase().includes("not found") ||
      (error as any).status === 404 ||
      (error as any).status === "404";

    if (isNotFound) {
      console.warn(`[StorageService Warning] Storage file no longer exists in Supabase Storage: "${storagePath}". Proceeding.`);
      return { success: true, data, storagePath, bucket };
    }

    console.error(`[StorageService Error] Supabase removal failed for path "${storagePath}":`, error);
    throw new Error(`Supabase Storage deletion failed: ${errorMsg}`);
  }

  console.log(`[StorageService] Successfully removed file from Supabase Storage: "${storagePath}"`);

  // Clear entry from browser Cache Storage if present
  try {
    if ("caches" in window) {
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

  return { success: true, data, storagePath, bucket };
}

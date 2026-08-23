import { Filesystem, Directory } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";
import { Capacitor } from "@capacitor/core";
import { getBucketName, sanitizeStoragePath } from "./storageService";
import { supabase, getSupabaseConfig } from "./supabaseClient";
import { dataUrlToBlob } from "../utils/pdfUtils";

export type NoteViewerState = "idle" | "downloading" | "opening" | "opened" | "error";

export const USER_FRIENDLY_NOTE_ERROR =
  "Unable to download note. Please check your internet connection and try again.";
export const USER_FRIENDLY_NOTE_UNAVAILABLE =
  "This note is unavailable. Please contact the administrator.";

export interface OpenPdfOptions {
  url: string;
  title?: string;
  storagePath?: string;
  bucket?: string;
  noteId?: string;
  fileName?: string;
  mimeType?: string;
  fileType?: "pdf" | "image" | string;
  onProgress?: (percent: number | null, statusText: string) => void;
}

export interface OpenPdfResult {
  success: boolean;
  message?: string;
  cachedPath?: string;
  isNative?: boolean;
  objectUrl?: string;
  blob?: Blob;
}

// In-flight download/open operations tracker to prevent duplicate parallel downloads
const inFlightOperations = new Map<string, Promise<OpenPdfResult>>();

// Web in-memory object URL cache
const webBlobCache = new Map<string, { blob: Blob; objectUrl: string }>();

// Debounce mutex to ensure native activity or file viewer is opened cleanly
let lastViewerLaunchTimestamp = 0;
let isLaunchingViewerMutex = false;

/**
 * Utility wrapper that enforces a strict timeout on any Promise.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(errorMsg));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Determines whether a given note or file is an image based on fileType, mimeType, or filename extension.
 */
export function isImageFile(fileName?: string, url?: string, mimeType?: string, fileType?: string): boolean {
  if (fileType === "image") return true;
  if (mimeType && mimeType.toLowerCase().startsWith("image/")) return true;
  const str = (fileName || url || "").toLowerCase();
  return /\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?.*)?$/i.test(str);
}

export function getFileExtension(rawPathOrUrl: string, isImg: boolean): string {
  const clean = rawPathOrUrl.split("?")[0].split("#")[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  if (match) {
    const ext = match[1].toLowerCase();
    if (["pdf", "png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(ext)) {
      return ext;
    }
  }
  return isImg ? "jpg" : "pdf";
}

export function getMimeType(fileNameOrUrl: string, mimeType?: string, isImg?: boolean): string {
  if (mimeType && mimeType.trim()) return mimeType;
  const ext = getFileExtension(fileNameOrUrl, !!isImg);
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return isImg ? "image/jpeg" : "application/pdf";
}

/**
 * Generates a deterministic, filesystem-safe filename for caching a PDF or Image in Directory.Cache.
 */
export function getPdfCacheFileName(rawPathOrUrl: string, noteId?: string, isImg?: boolean, ext?: string): string {
  const identifier = `${noteId || "doc"}_${rawPathOrUrl || ""}`;
  const cleanSlug = identifier
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 40);

  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = (hash << 5) - hash + identifier.charCodeAt(i);
    hash |= 0;
  }
  const safeHash = Math.abs(hash).toString(36);

  const extension = ext ? ext.replace(/^\./, "") : isImg ? "jpg" : "pdf";
  if (isImg) {
    return `img_cache_${cleanSlug}_${safeHash}.${extension}`;
  }
  return `pdf_cache_${cleanSlug}_${safeHash}.${extension}`;
}

/**
 * Converts a Blob into a Base64 string required by Filesystem.writeFile.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read downloaded file bytes."));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Validates PDF header magic bytes (%PDF or Base64 equivalent JVBERi)
 */
async function validatePdfHeader(blob: Blob): Promise<boolean> {
  if (!blob || blob.size <= 0) return false;
  try {
    const headerSlice = blob.slice(0, 5);
    const headerText = await headerSlice.text();
    return headerText.startsWith("%PDF") || headerText.startsWith("JVBER");
  } catch {
    return false;
  }
}

/**
 * Checks if running in a native Capacitor mobile environment (Android or iOS).
 */
export function isNativePlatform(): boolean {
  if (typeof Capacitor !== "undefined") {
    if (typeof Capacitor.isNativePlatform === "function" && Capacitor.isNativePlatform()) {
      return true;
    }
    const platform = typeof Capacitor.getPlatform === "function" ? Capacitor.getPlatform() : "";
    if (platform === "android" || platform === "ios") {
      return true;
    }
  }
  if (typeof window !== "undefined") {
    if (Boolean((window as any).Capacitor?.isNativePlatform?.())) return true;
    if (Boolean((window as any).AndroidBridge)) return true;
  }
  return false;
}

/**
 * Encodes each segment of a storage path safely for HTTP URLs.
 */
function encodeStoragePath(rawPath: string): string {
  return rawPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/**
 * Fetches file directly from Supabase Storage with strict 10s first-byte timeout,
 * real byte streaming progress, and 404 detection.
 */
async function streamFetchFromSupabaseStorage(
  bucket: string,
  storagePath: string,
  noteId?: string,
  fileName?: string,
  onProgress?: (percent: number | null, label: string) => void
): Promise<{ blob: Blob | null; notFound: boolean }> {
  const { url: supabaseUrl, anonKey } = getSupabaseConfig();
  const encodedPath = encodeStoragePath(storagePath);

  // Target URLs: Authenticated REST endpoint first, then public endpoint
  const targetUrls = [
    `${supabaseUrl}/storage/v1/object/authenticated/${bucket}/${encodedPath}`,
    `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodedPath}`
  ];

  console.log(`[NotePipeline] 5. Requesting Supabase Storage: bucket="${bucket}", path="${storagePath}"`);

  for (const url of targetUrls) {
    let controller: AbortController | null = null;
    let firstByteTimer: any = null;
    let totalTimeoutTimer: any = null;
    let receivedFirstByte = false;
    let receivedBytes = 0;
    let totalBytes = 0;

    try {
      controller = new AbortController();
      console.log(`[NotePipeline] 6. Download request started: URL="${url}"`);

      // Strict 10-second first byte timeout
      firstByteTimer = setTimeout(() => {
        if (!receivedFirstByte && controller) {
          console.error(`[NotePipeline] Timeout: First byte not received within 10 seconds.`, {
            noteId,
            fileName,
            bucket,
            storage_path: storagePath,
            timeoutReason: "First byte timeout (10s threshold exceeded)",
            bytesReceived: 0
          });
          controller.abort();
        }
      }, 10000);

      // Max total download timeout (30 seconds)
      totalTimeoutTimer = setTimeout(() => {
        if (controller) {
          console.error(`[NotePipeline] Timeout: Total download exceeded 30s limit.`, {
            noteId,
            fileName,
            bucket,
            storage_path: storagePath,
            bytesReceived: receivedBytes
          });
          controller.abort();
        }
      }, 30000);

      const headers: Record<string, string> = {};
      if (anonKey) {
        headers["apikey"] = anonKey;
        headers["Authorization"] = `Bearer ${anonKey}`;
      }

      const response = await fetch(url, { signal: controller.signal, headers });

      // Handle 404 / 400 Object Not Found
      if (response.status === 404 || response.status === 400) {
        clearTimeout(firstByteTimer);
        clearTimeout(totalTimeoutTimer);
        console.error(`[NotePipeline] HTTP ${response.status} Object Not Found from Supabase Storage:`, {
          noteId,
          fileName,
          bucket,
          storage_path: storagePath,
          status: response.status
        });
        return { blob: null, notFound: true };
      }

      if (!response.ok) {
        clearTimeout(firstByteTimer);
        clearTimeout(totalTimeoutTimer);
        console.warn(`[NotePipeline] Supabase Storage HTTP error ${response.status}:`, {
          noteId,
          fileName,
          bucket,
          storage_path: storagePath,
          status: response.status
        });
        continue;
      }

      const contentLength = response.headers.get("content-length");
      totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value && value.length > 0) {
            if (!receivedFirstByte) {
              receivedFirstByte = true;
              clearTimeout(firstByteTimer);
              console.log(`[NotePipeline] 7. First byte received (Content-Length: ${totalBytes > 0 ? totalBytes : "unknown"})`);
            }

            chunks.push(value);
            receivedBytes += value.length;

            if (totalBytes > 0) {
              const percent = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
              console.log(`[NotePipeline] 8. Streaming bytes: ${receivedBytes}/${totalBytes} (${percent}%)`);
              if (onProgress) onProgress(percent, "Downloading…");
            } else {
              console.log(`[NotePipeline] 8. Streaming bytes: ${receivedBytes} (indeterminate)`);
              if (onProgress) onProgress(null, "Downloading…");
            }
          }
        }

        clearTimeout(totalTimeoutTimer);

        if (receivedBytes > 0) {
          const all = new Uint8Array(receivedBytes);
          let offset = 0;
          for (const c of chunks) {
            all.set(c, offset);
            offset += c.length;
          }
          const mimeType = response.headers.get("content-type") || "application/octet-stream";
          const resultBlob = new Blob([all], { type: mimeType });
          console.log(`[NotePipeline] 9. Download complete: ${resultBlob.size} bytes received`);
          return { blob: resultBlob, notFound: false };
        }
      } else {
        // Body fallback
        const fetchedBlob = await response.blob();
        clearTimeout(firstByteTimer);
        clearTimeout(totalTimeoutTimer);
        if (fetchedBlob && fetchedBlob.size > 0) {
          console.log(`[NotePipeline] 9. Download complete: ${fetchedBlob.size} bytes received`);
          return { blob: fetchedBlob, notFound: false };
        }
      }
    } catch (err: any) {
      if (firstByteTimer) clearTimeout(firstByteTimer);
      if (totalTimeoutTimer) clearTimeout(totalTimeoutTimer);
      console.warn(`[NotePipeline] Fetch attempt failed for ${url}:`, err?.message || err);
    }
  }

  // Final fallback: Use Supabase JS Storage SDK download() with 10s timeout
  try {
    console.log(`[NotePipeline] Trying Supabase JS SDK download for bucket="${bucket}", path="${storagePath}"`);
    const sdkPromise = supabase.storage.from(bucket).download(storagePath);
    const sdkRes = await withTimeout<{ data: Blob | null; error: any }>(
      sdkPromise,
      10000,
      "Supabase SDK download timeout (10s limit exceeded)"
    );

    if (sdkRes.error) {
      const errMsg = (sdkRes.error.message || "").toLowerCase();
      if (errMsg.includes("not found") || sdkRes.error.statusCode === "404" || sdkRes.error.status === 404) {
        console.error(`[NotePipeline] Supabase SDK: Object Not Found:`, {
          noteId,
          fileName,
          bucket,
          storage_path: storagePath,
          error: sdkRes.error
        });
        return { blob: null, notFound: true };
      }
      console.warn("[NotePipeline] Supabase SDK download error:", sdkRes.error);
    } else if (sdkRes.data && sdkRes.data.size > 0) {
      console.log(`[NotePipeline] 9. Download complete (via SDK): ${sdkRes.data.size} bytes received`);
      if (onProgress) onProgress(100, "Downloading…");
      return { blob: sdkRes.data, notFound: false };
    }
  } catch (sdkErr: any) {
    console.warn("[NotePipeline] Supabase SDK download exception:", sdkErr?.message || sdkErr);
  }

  return { blob: null, notFound: false };
}

/**
 * Launch native file viewer intent exactly once with debounce protection.
 */
async function launchNativeViewerOnce(uri: string, contentType: string): Promise<void> {
  const now = Date.now();
  if (isLaunchingViewerMutex || now - lastViewerLaunchTimestamp < 2500) {
    return;
  }
  isLaunchingViewerMutex = true;
  lastViewerLaunchTimestamp = now;

  try {
    await FileOpener.open({
      filePath: uri,
      contentType: contentType,
    });
  } catch (openerErr: any) {
    console.warn("[NativePdfService] Native FileOpener error:", openerErr);
    throw openerErr;
  } finally {
    setTimeout(() => {
      isLaunchingViewerMutex = false;
    }, 1500);
  }
}

/**
 * Checks if the file already exists in local cache with size and extension validation.
 * If file is corrupted (size <= 0), it is automatically deleted.
 */
async function checkAndValidateLocalCache(
  cacheFileName: string,
  expectedExt: string
): Promise<{ exists: boolean; uri?: string; size?: number }> {
  const isNative = isNativePlatform();
  if (!isNative) {
    const cached = webBlobCache.get(cacheFileName);
    if (cached && cached.objectUrl && cached.blob.size > 0) {
      return { exists: true, uri: cached.objectUrl, size: cached.blob.size };
    }
    return { exists: false };
  }

  try {
    const statResult = await withTimeout(
      Filesystem.stat({ path: cacheFileName, directory: Directory.Cache }),
      1500,
      "Cache check timed out"
    );

    const fileSize = (statResult as any)?.size ?? 0;
    const fileType = (statResult as any)?.type ?? "";
    const hasValidExt = cacheFileName.toLowerCase().endsWith(`.${expectedExt.toLowerCase()}`);

    if (statResult && fileSize > 0 && fileType === "file" && hasValidExt) {
      const uriResult = await withTimeout(
        Filesystem.getUri({ path: cacheFileName, directory: Directory.Cache }),
        1500,
        "Get URI timed out"
      );
      return { exists: true, uri: uriResult.uri, size: fileSize };
    }

    // Corrupted cache file detected -> delete it immediately
    console.warn(`[NativePdfService] Corrupted cache detected for ${cacheFileName} (size: ${fileSize}), removing.`);
    await Filesystem.deleteFile({ path: cacheFileName, directory: Directory.Cache }).catch(() => {});
  } catch {
    // Cache miss or stat error
  }
  return { exists: false };
}

/**
 * Main function: Opens a Note PDF or Image directly from Supabase Storage with local cache and native viewer.
 */
export async function openPdfWithNativeViewer(options: OpenPdfOptions): Promise<OpenPdfResult> {
  const { url, storagePath, bucket, noteId, fileName, mimeType, fileType, onProgress } = options;

  console.log(`[NotePipeline] 1. Student tapped note: noteId="${noteId || "unknown"}", title="${options.title || "unknown"}"`);
  console.log(`[NotePipeline] 2. Fetched note metadata:`, {
    noteId,
    title: options.title,
    fileName,
    bucket,
    storagePath,
    url,
    mimeType,
    fileType
  });

  const updateProgress = (percent: number | null, text: string) => {
    if (onProgress) onProgress(percent, text);
  };

  const isImg = isImageFile(fileName, url || storagePath, mimeType, fileType);
  const ext = getFileExtension(fileName || storagePath || url || "", isImg);
  const contentType = getMimeType(fileName || url || "", mimeType, isImg);

  const activeBucket = getBucketName(bucket);
  const activePath = sanitizeStoragePath(storagePath || url, activeBucket);

  console.log(`[NotePipeline] 3. storage_path = "${activePath}"`);
  console.log(`[NotePipeline] 4. bucket = "${activeBucket}"`);

  // Validate metadata before attempting any download
  if (!activePath || activePath.trim().length === 0) {
    console.error(`[NotePipeline] Validation failed: storage_path is empty or missing`, { noteId, storagePath, url });
    throw new Error(USER_FRIENDLY_NOTE_UNAVAILABLE);
  }

  if (!activeBucket || activeBucket.trim().length === 0) {
    console.error(`[NotePipeline] Validation failed: bucket is empty or missing`, { noteId, bucket });
    throw new Error(USER_FRIENDLY_NOTE_UNAVAILABLE);
  }

  if (!ext || ext.trim().length === 0) {
    console.error(`[NotePipeline] Validation failed: file extension is missing`, { fileName, storagePath, url });
    throw new Error(USER_FRIENDLY_NOTE_UNAVAILABLE);
  }

  const cacheFileName = getPdfCacheFileName(activePath || url, noteId, isImg, ext);

  // In-flight deduplication: If download/open is already running for this note, return existing promise
  if (inFlightOperations.has(cacheFileName)) {
    console.log(`[NotePipeline] Reusing existing in-flight download/open for ${cacheFileName}`);
    return inFlightOperations.get(cacheFileName)!;
  }

  const executeOperation = async (isRetry = false): Promise<OpenPdfResult> => {
    const isNative = isNativePlatform();

    // Step 1: Look for cached file
    updateProgress(null, "Preparing Note…");

    const cacheCheck = await checkAndValidateLocalCache(cacheFileName, ext);
    if (cacheCheck.exists && cacheCheck.uri) {
      console.log("[NotePipeline] CACHE_HIT - opening directly from local cache:", {
        noteId,
        bucket: activeBucket,
        storagePath: activePath,
        cacheFileName,
        size: cacheCheck.size
      });

      updateProgress(100, "Opening…");

      if (isNative) {
        try {
          console.log(`[NotePipeline] 11. Opening native viewer: uri="${cacheCheck.uri}", mimeType="${contentType}"`);
          await launchNativeViewerOnce(cacheCheck.uri, contentType);
          return { success: true, cachedPath: cacheCheck.uri, isNative: true };
        } catch (openerErr: any) {
          console.warn("[NotePipeline] Opener failed on cached file, removing cache and retrying:", openerErr);
          await Filesystem.deleteFile({ path: cacheFileName, directory: Directory.Cache }).catch(() => {});
          if (!isRetry) {
            return executeOperation(true);
          }
          throw new Error(USER_FRIENDLY_NOTE_ERROR);
        }
      } else {
        const cached = webBlobCache.get(cacheFileName);
        const objUrl = cacheCheck.uri || (cached?.blob ? URL.createObjectURL(cached.blob) : "");
        if (objUrl && typeof window !== "undefined") {
          window.open(objUrl, "_blank", "noopener,noreferrer");
        }
        return {
          success: true,
          isNative: false,
          cachedPath: cacheCheck.uri,
          objectUrl: objUrl,
          blob: cached?.blob
        };
      }
    }

    console.log("[NotePipeline] CACHE_MISS - fetching directly from Supabase Storage:", {
      noteId,
      bucket: activeBucket,
      storagePath: activePath,
      cacheFileName
    });

    // Step 2: Fetch directly from Supabase Storage with real byte progress
    updateProgress(null, "Connecting…");

    let pdfBlob: Blob | null = null;
    let isNotFound = false;

    if (activePath && !url.startsWith("data:") && !url.startsWith("blob:")) {
      const streamRes = await streamFetchFromSupabaseStorage(
        activeBucket,
        activePath,
        noteId,
        fileName,
        updateProgress
      );
      pdfBlob = streamRes.blob;
      isNotFound = streamRes.notFound;
    }

    // Stop immediately if object not found (404)
    if (isNotFound) {
      console.error(`[NotePipeline] Aborting: Note object not found in Supabase Storage.`, {
        noteId,
        fileName,
        bucket: activeBucket,
        storage_path: activePath
      });
      throw new Error(USER_FRIENDLY_NOTE_UNAVAILABLE);
    }

    // Fallback for inline Base64 data URLs
    if (!pdfBlob && url && (url.startsWith("data:") || url.startsWith("JVBERi"))) {
      pdfBlob = await dataUrlToBlob(url);
    }

    // Validation: Downloaded blob must exist and not be empty
    if (!pdfBlob || pdfBlob.size <= 0) {
      console.error("[NotePipeline] Supabase Storage download returned empty or failed:", {
        noteId,
        fileName,
        bucket: activeBucket,
        storage_path: activePath,
        bytesReceived: 0,
        isRetry
      });

      if (!isRetry) {
        console.log("[NotePipeline] Automatically retrying Supabase Storage download once…");
        return executeOperation(true);
      }
      throw new Error(USER_FRIENDLY_NOTE_ERROR);
    }

    // Validate PDF magic bytes
    if (!isImg) {
      const isValidHeader = await validatePdfHeader(pdfBlob);
      if (!isValidHeader) {
        console.error("[NotePipeline] Corrupted PDF file header:", {
          noteId,
          bucket: activeBucket,
          storagePath: activePath,
          size: pdfBlob.size
        });
        if (!isRetry) {
          return executeOperation(true);
        }
        throw new Error(USER_FRIENDLY_NOTE_ERROR);
      }
    }

    // Step 3: Save to local cache and verify integrity
    updateProgress(100, "Opening…");

    if (isNative) {
      try {
        const base64Data = await blobToBase64(pdfBlob);

        await withTimeout(
          Filesystem.writeFile({
            path: cacheFileName,
            data: base64Data,
            directory: Directory.Cache,
            recursive: true,
          }),
          15000,
          "Failed to write note to cache"
        );

        // Verify written file exists and size > 0
        const statCheck = await Filesystem.stat({
          path: cacheFileName,
          directory: Directory.Cache,
        });

        if (!statCheck || (statCheck as any).size <= 0) {
          await Filesystem.deleteFile({ path: cacheFileName, directory: Directory.Cache }).catch(() => {});
          throw new Error("Local cache verification failed: size is 0");
        }

        const uriResult = await Filesystem.getUri({
          path: cacheFileName,
          directory: Directory.Cache,
        });

        console.log(`[NotePipeline] 10. Saved locally: "${cacheFileName}" (${(statCheck as any).size} bytes)`);

        // Step 4: Open native PDF / Image viewer
        console.log(`[NotePipeline] 11. Opening native viewer: uri="${uriResult.uri}", mimeType="${contentType}"`);
        await launchNativeViewerOnce(uriResult.uri, contentType);

        return { success: true, cachedPath: uriResult.uri, isNative: true };
      } catch (nativeErr: any) {
        console.error("[NotePipeline] Error in native save/open pipeline:", nativeErr);
        if (!isRetry) {
          return executeOperation(true);
        }
        throw new Error(USER_FRIENDLY_NOTE_ERROR);
      }
    } else {
      // Web preview: cache in memory and open in safe tab
      const objectUrl = URL.createObjectURL(pdfBlob);
      webBlobCache.set(cacheFileName, { blob: pdfBlob, objectUrl });
      if (typeof window !== "undefined") {
        window.open(objectUrl, "_blank", "noopener,noreferrer");
      }
      return { success: true, isNative: false, objectUrl, blob: pdfBlob, cachedPath: objectUrl };
    }
  };

  const operationPromise = executeOperation().finally(() => {
    inFlightOperations.delete(cacheFileName);
  });

  inFlightOperations.set(cacheFileName, operationPromise);
  return operationPromise;
}

/**
 * Saves and opens a client-side generated PDF blob on native Android or web.
 */
export async function saveAndOpenGeneratedPdf(pdfBlob: Blob, fileName: string): Promise<void> {
  const isNative = isNativePlatform();
  if (isNative) {
    const base64Data = await blobToBase64(pdfBlob);
    await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });
    const uriResult = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Cache,
    });
    await launchNativeViewerOnce(uriResult.uri, "application/pdf");
  } else {
    // Web direct export for generated receipts
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

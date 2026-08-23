import { Filesystem, Directory } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";
import { Capacitor } from "@capacitor/core";
import { getBucketName, sanitizeStoragePath } from "./storageService";
import { supabase, getSupabaseConfig } from "./supabaseClient";
import { dataUrlToBlob } from "../utils/pdfUtils";

export type NoteViewerState = "idle" | "downloading" | "opening" | "opened" | "error";

export const USER_FRIENDLY_NOTE_ERROR =
  "Unable to download note. Please check your internet connection and try again.";

export interface OpenPdfOptions {
  url: string;
  title?: string;
  storagePath?: string;
  bucket?: string;
  noteId?: string;
  fileName?: string;
  mimeType?: string;
  fileType?: "pdf" | "image" | string;
  onProgress?: (percent: number, statusText: string) => void;
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

// Debounce mutex to ensure native activity or file viewer is opened exactly once
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
 * Checks if running in a native Capacitor / Cordova mobile environment.
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
    if (Capacitor.isPluginAvailable?.("FileOpener") || Capacitor.isPluginAvailable?.("Filesystem")) {
      return true;
    }
  }
  if (typeof window !== "undefined") {
    if (Boolean((window as any).Capacitor?.isNativePlatform?.())) return true;
    if (Boolean((window as any).AndroidBridge)) return true;
    if (Boolean((window as any).cordova)) return true;
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
 * Fetches file directly from Supabase Storage with exact byte streaming progress.
 */
async function streamFetchFromSupabaseStorage(
  bucket: string,
  storagePath: string,
  onProgress?: (percent: number, label: string) => void,
  timeoutMs = 20000
): Promise<{ blob: Blob | null; status: number }> {
  const { url: supabaseUrl, anonKey } = getSupabaseConfig();
  const encodedPath = encodeStoragePath(storagePath);

  // Try authenticated REST endpoint first, then public endpoint
  const targetUrls = [
    `${supabaseUrl}/storage/v1/object/authenticated/${bucket}/${encodedPath}`,
    `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodedPath}`
  ];

  for (const url of targetUrls) {
    if (typeof XMLHttpRequest !== "undefined") {
      const xhrResult = await new Promise<{ blob: Blob | null; status: number }>((resolve) => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", url, true);
          if (anonKey) {
            xhr.setRequestHeader("apikey", anonKey);
            xhr.setRequestHeader("Authorization", `Bearer ${anonKey}`);
          }
          xhr.responseType = "blob";
          xhr.timeout = timeoutMs;

          xhr.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0 && onProgress) {
              const percent = Math.min(99, Math.max(0, Math.round((event.loaded / event.total) * 100)));
              onProgress(percent, "Downloading…");
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300 && xhr.response instanceof Blob && xhr.response.size > 0) {
              resolve({ blob: xhr.response, status: xhr.status });
            } else {
              resolve({ blob: null, status: xhr.status });
            }
          };

          xhr.onerror = () => resolve({ blob: null, status: 0 });
          xhr.ontimeout = () => resolve({ blob: null, status: 408 });
          xhr.send();
        } catch {
          resolve({ blob: null, status: 0 });
        }
      });

      if (xhrResult.blob && xhrResult.blob.size > 0) {
        return xhrResult;
      }
    }

    // Fetch stream fallback if XMLHttpRequest is unavailable or failed with status 0
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const headers: Record<string, string> = {};
      if (anonKey) {
        headers["apikey"] = anonKey;
        headers["Authorization"] = `Bearer ${anonKey}`;
      }

      const response = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timer);

      if (response.ok) {
        const contentLength = response.headers.get("content-length");
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

        if (response.body && totalBytes > 0) {
          const reader = response.body.getReader();
          let receivedBytes = 0;
          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              receivedBytes += value.length;
              const percent = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
              if (onProgress) onProgress(percent, "Downloading…");
            }
          }
          const all = new Uint8Array(receivedBytes);
          let offset = 0;
          for (const c of chunks) {
            all.set(c, offset);
            offset += c.length;
          }
          const mimeType = response.headers.get("content-type") || "application/octet-stream";
          return {
            blob: new Blob([all], { type: mimeType }),
            status: response.status
          };
        }

        const fetchedBlob = await response.blob();
        if (fetchedBlob && fetchedBlob.size > 0) {
          return { blob: fetchedBlob, status: response.status };
        }
      }
    } catch {
      // Continue to fallback
    }
  }

  // Final fallback: Use Supabase JS Storage SDK download()
  try {
    console.log(`[NativePdfService] Using Supabase SDK fallback download for bucket="${bucket}", path="${storagePath}"`);
    const sdkRes = await withTimeout<{ data: Blob | null; error: any }>(
      supabase.storage.from(bucket).download(storagePath),
      timeoutMs,
      "Supabase SDK download timeout"
    );
    if (!sdkRes.error && sdkRes.data && sdkRes.data.size > 0) {
      if (onProgress) onProgress(100, "Downloading…");
      return { blob: sdkRes.data, status: 200 };
    }
  } catch (sdkErr) {
    console.warn("[NativePdfService] Supabase SDK download exception:", sdkErr);
  }

  return { blob: null, status: 0 };
}

/**
 * Launch native file viewer intent exactly once with debounce protection.
 */
async function launchNativeViewerOnce(uri: string, contentType: string, _isImg: boolean): Promise<void> {
  const now = Date.now();
  if (isLaunchingViewerMutex || now - lastViewerLaunchTimestamp < 2500) {
    // Avoid duplicate intent launches if tapped repeatedly
    return;
  }
  isLaunchingViewerMutex = true;
  lastViewerLaunchTimestamp = now;

  try {
    await FileOpener.open({
      filePath: uri,
      contentType: contentType,
      openWithDefault: false,
    });
  } catch (openerErr: any) {
    console.warn("[NativePdfService] Native FileOpener error:", openerErr);
    throw new Error(USER_FRIENDLY_NOTE_ERROR);
  } finally {
    // Keep mutex locked for 1.5s to prevent immediate re-entry
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
 * Main function: Opens a Note PDF or Image.
 * Flow:
 * 1. Check local cache (verify size > 0 and extension). If valid -> open immediately via native viewer.
 * 2. If corrupted or missing: Delete corrupted file and download directly from Supabase Storage.
 * 3. Stream download with real byte progress (0% -> 100%).
 * 4. Save to local cache and verify integrity (size > 0).
 * 5. Open using native PDF / Image viewer.
 * 6. Never open browser download URLs or show popup-based note viewers.
 */
export async function openPdfWithNativeViewer(options: OpenPdfOptions): Promise<OpenPdfResult> {
  const { url, storagePath, bucket, noteId, fileName, mimeType, fileType, onProgress } = options;

  const updateProgress = (percent: number, text: string) => {
    if (onProgress) onProgress(percent, text);
  };

  if (!url && !storagePath) {
    console.error("[NativePdfService] Missing note file location or URL:", { noteId, storagePath, url });
    throw new Error(USER_FRIENDLY_NOTE_ERROR);
  }

  const isImg = isImageFile(fileName, url || storagePath, mimeType, fileType);
  const ext = getFileExtension(fileName || storagePath || url || "", isImg);
  const contentType = getMimeType(fileName || url || "", mimeType, isImg);

  const activeBucket = getBucketName(bucket);
  const activePath = sanitizeStoragePath(storagePath || url, activeBucket);
  const cacheFileName = getPdfCacheFileName(activePath || url, noteId, isImg, ext);

  // In-flight deduplication: If download/open is already running for this note, return existing promise
  if (inFlightOperations.has(cacheFileName)) {
    console.log(`[NativePdfService] Reusing existing in-flight download/open for ${cacheFileName}`);
    return inFlightOperations.get(cacheFileName)!;
  }

  const executeOperation = async (isRetry = false): Promise<OpenPdfResult> => {
    const isNative = isNativePlatform();

    // Step 1: Look for cached file
    updateProgress(0, "Preparing Note…");

    const cacheCheck = await checkAndValidateLocalCache(cacheFileName, ext);
    if (cacheCheck.exists && cacheCheck.uri) {
      console.log("[NativePdfService] CACHE_HIT - opening directly:", {
        noteId,
        bucket: activeBucket,
        storagePath: activePath,
        cacheFileName,
        size: cacheCheck.size
      });

      updateProgress(100, "Opening…");

      if (isNative) {
        try {
          await launchNativeViewerOnce(cacheCheck.uri, contentType, isImg);
          return { success: true, cachedPath: cacheCheck.uri, isNative: true };
        } catch (openerErr: any) {
          console.warn("[NativePdfService] Opener failed on cached file, removing corrupted cache:", openerErr);
          await Filesystem.deleteFile({ path: cacheFileName, directory: Directory.Cache }).catch(() => {});
          if (!isRetry) {
            return executeOperation(true);
          }
          throw new Error(USER_FRIENDLY_NOTE_ERROR);
        }
      } else {
        const cached = webBlobCache.get(cacheFileName);
        return {
          success: true,
          isNative: false,
          cachedPath: cacheCheck.uri,
          objectUrl: cacheCheck.uri,
          blob: cached?.blob
        };
      }
    }

    console.log("[NativePdfService] CACHE_MISS - fetching from Supabase Storage:", {
      noteId,
      bucket: activeBucket,
      storagePath: activePath,
      cacheFileName
    });

    // Step 2: Fetch directly from Supabase Storage with real byte progress
    updateProgress(0, "Downloading…");

    let pdfBlob: Blob | null = null;

    if (activePath && !url.startsWith("data:") && !url.startsWith("blob:")) {
      const streamRes = await streamFetchFromSupabaseStorage(
        activeBucket,
        activePath,
        updateProgress,
        20000
      );
      if (streamRes.blob && streamRes.blob.size > 0) {
        pdfBlob = streamRes.blob;
      }
    }

    // Fallback for inline Base64 data URLs
    if (!pdfBlob && url && (url.startsWith("data:") || url.startsWith("JVBERi"))) {
      pdfBlob = await dataUrlToBlob(url);
    }

    // Validation: Downloaded blob must exist and not be empty
    if (!pdfBlob || pdfBlob.size <= 0) {
      console.error("[NativePdfService] Supabase Storage download failed:", {
        noteId,
        bucket: activeBucket,
        storagePath: activePath,
        cacheHit: false
      });

      if (!isRetry) {
        console.log("[NativePdfService] Retrying Supabase Storage download once…");
        return executeOperation(true);
      }
      throw new Error(USER_FRIENDLY_NOTE_ERROR);
    }

    // Validate PDF magic bytes
    if (!isImg) {
      const isValidHeader = await validatePdfHeader(pdfBlob);
      if (!isValidHeader) {
        console.error("[NativePdfService] Corrupted PDF file header:", {
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
          10000,
          "Failed to write note to cache"
        );

        // Verify written file exists and size > 0
        const statCheck = await Filesystem.stat({
          path: cacheFileName,
          directory: Directory.Cache,
        });

        if (!statCheck || (statCheck as any).size <= 0) {
          await Filesystem.deleteFile({ path: cacheFileName, directory: Directory.Cache }).catch(() => {});
          throw new Error("Local cache verification failed.");
        }

        const uriResult = await Filesystem.getUri({
          path: cacheFileName,
          directory: Directory.Cache,
        });

        // Step 4: Open native PDF / Image viewer
        await launchNativeViewerOnce(uriResult.uri, contentType, isImg);

        return { success: true, cachedPath: uriResult.uri, isNative: true };
      } catch (saveErr) {
        console.error("[NativePdfService] Error saving or opening cached file:", saveErr);
        await Filesystem.deleteFile({ path: cacheFileName, directory: Directory.Cache }).catch(() => {});
        if (!isRetry) {
          return executeOperation(true);
        }
        throw new Error(USER_FRIENDLY_NOTE_ERROR);
      }
    } else {
      // Web / in-app preview: keep in web memory cache
      const objectUrl = URL.createObjectURL(pdfBlob);
      webBlobCache.set(cacheFileName, { blob: pdfBlob, objectUrl });
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
    await launchNativeViewerOnce(uriResult.uri, "application/pdf", false);
  } else {
    // Web direct export for generated financial / audit receipts
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

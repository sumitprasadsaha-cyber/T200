import { Filesystem, Directory } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";
import { Capacitor } from "@capacitor/core";
import { getBucketName, sanitizeStoragePath } from "./storageService";
import { supabase } from "./supabaseClient";
import { dataUrlToBlob } from "../utils/pdfUtils";

export type NoteViewerState = "idle" | "downloading" | "opening" | "opened" | "error";

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

// Debounce mutex to ensure native activity or browser tab is opened exactly once
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
 * Includes noteId and full rawPathOrUrl so if the remote URL or file version changes, the cache is automatically refreshed.
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

  if (isImg) {
    const extension = ext ? ext.replace(/^\./, "") : "jpg";
    return `img_cache_${cleanSlug}_${safeHash}.${extension}`;
  }
  return `pdf_cache_${cleanSlug}_${safeHash}.pdf`;
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
 * Fetches a URL with real byte progress tracking via XMLHttpRequest or fetch ReadableStream.
 */
async function fetchBlobWithByteProgress(
  url: string,
  onProgress?: (percent: number, label: string) => void,
  timeoutMs = 15000
): Promise<{ blob: Blob | null; status: number }> {
  if (typeof XMLHttpRequest !== "undefined") {
    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
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
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return { blob: null, status: response.status };

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
      return {
        blob: new Blob([all], { type: response.headers.get("content-type") || "application/pdf" }),
        status: response.status
      };
    }

    const fetchedBlob = await response.blob();
    return { blob: fetchedBlob, status: response.status };
  } catch {
    return { blob: null, status: 0 };
  }
}

/**
 * Launch native file viewer intent exactly once with debounce protection.
 */
async function launchNativeViewerOnce(uri: string, contentType: string, _isImg: boolean): Promise<void> {
  const now = Date.now();
  if (isLaunchingViewerMutex || now - lastViewerLaunchTimestamp < 2500) {
    // Avoid double intent launches if tapped repeatedly
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
    throw new Error("Unable to open note. Please try again.");
  } finally {
    // Keep mutex locked for 1.5s to prevent immediate re-entry
    setTimeout(() => {
      isLaunchingViewerMutex = false;
    }, 1500);
  }
}

/**
 * Checks if the file already exists in cache with a strict timeout so the UI never hangs.
 */
async function checkLocalCache(cacheFileName: string): Promise<{ exists: boolean; uri?: string; size?: number }> {
  const isNative = isNativePlatform();
  if (!isNative) {
    const cached = webBlobCache.get(cacheFileName);
    if (cached && cached.objectUrl) {
      return { exists: true, uri: cached.objectUrl, size: cached.blob.size };
    }
    return { exists: false };
  }

  try {
    // Timeout of 1500ms prevents any bridge/stat freeze
    const statResult = await withTimeout(
      Filesystem.stat({ path: cacheFileName, directory: Directory.Cache }),
      1500,
      "Cache check timed out"
    );

    if (statResult && ((statResult as any).size > 0 || (statResult as any).type === "file")) {
      const uriResult = await withTimeout(
        Filesystem.getUri({ path: cacheFileName, directory: Directory.Cache }),
        1500,
        "Get URI timed out"
      );
      return { exists: true, uri: uriResult.uri, size: (statResult as any).size || 1 };
    }
  } catch {
    // Cache miss or timeout -> proceed to download
  }
  return { exists: false };
}

/**
 * Main function: Opens a Note PDF or Image.
 * Flow:
 * 1. Look for cached file. If cache exists -> open immediately via native viewer.
 * 2. If cache does not exist: Fetch from Supabase Storage -> save locally -> open viewer directly.
 * 3. Never performs duplicate downloads or multiple viewer launches.
 * 4. Never uses window.open, target="_blank", or browser popups.
 * 5. User-facing status messages strictly: "Preparing Note…", "Downloading…", "Opening…".
 */
export async function openPdfWithNativeViewer(options: OpenPdfOptions): Promise<OpenPdfResult> {
  const { url, storagePath, bucket, noteId, fileName, mimeType, fileType, onProgress } = options;

  const updateProgress = (percent: number, text: string) => {
    if (onProgress) onProgress(percent, text);
  };

  if (!url && !storagePath) {
    console.error("[NativePdfService] Missing note file location or URL:", { noteId, storagePath, url });
    throw new Error("Unable to open note. Please try again.");
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

    const cacheCheck = await checkLocalCache(cacheFileName);
    if (cacheCheck.exists && cacheCheck.uri) {
      console.log("[NativePdfService] CACHE_HIT", {
        topicId: noteId,
        noteId: noteId,
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
          try {
            await Filesystem.deleteFile({ path: cacheFileName, directory: Directory.Cache });
          } catch {}
          if (!isRetry) {
            return executeOperation(true);
          }
          throw new Error("Unable to open note. Please try again.");
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

    console.log("[NativePdfService] CACHE_MISS", {
      topicId: noteId,
      noteId: noteId,
      bucket: activeBucket,
      storagePath: activePath,
      cacheFileName
    });

    // Step 2: Fetch from Supabase Storage
    updateProgress(0, "Downloading…");

    let pdfBlob: Blob | null = null;
    let generatedUrl = "";
    let httpStatus = 0;
    let lastError: any = null;

    // 2a. Primary: Direct Supabase Storage SDK download using exact stored storage path
    if (activePath && !url.startsWith("data:") && !url.startsWith("blob:")) {
      try {
        console.log(`[NativePdfService] Tier 1: Supabase SDK download bucket="${activeBucket}", path="${activePath}"`);
        const sdkRes = await withTimeout<{ data: Blob | null; error: any }>(
          supabase.storage.from(activeBucket).download(activePath),
          15000,
          "Supabase download timed out"
        );

        if (!sdkRes.error && sdkRes.data && sdkRes.data.size > 0) {
          pdfBlob = sdkRes.data;
          httpStatus = 200;
          updateProgress(100, "Opening…");
          console.log(`[NativePdfService] Tier 1 SDK download succeeded: ${pdfBlob.size} bytes`);
        } else if (sdkRes.error) {
          lastError = sdkRes.error;
          console.warn("[NativePdfService] Tier 1 SDK download error:", sdkRes.error);
        }
      } catch (sdkEx: any) {
        lastError = sdkEx;
        console.warn("[NativePdfService] Tier 1 SDK download exception:", sdkEx);
      }
    }

    // 2b. Secondary: Fresh Signed URL download if direct SDK download did not return blob
    if (!pdfBlob && activePath && !url.startsWith("data:") && !url.startsWith("blob:")) {
      try {
        console.log(`[NativePdfService] Tier 2: Attempting signed URL retrieval for "${activePath}"`);
        const { data: signedData, error: signedError } = await supabase.storage
          .from(activeBucket)
          .createSignedUrl(activePath, 3600);

        if (!signedError && signedData?.signedUrl) {
          generatedUrl = signedData.signedUrl;
          console.log(`[NativePdfService] Tier 2 signed URL generated: ${generatedUrl}`);
          const res = await fetchBlobWithByteProgress(generatedUrl, updateProgress, 15000);
          httpStatus = res.status;
          if (res.blob && res.blob.size > 0) {
            pdfBlob = res.blob;
            lastError = null;
            console.log(`[NativePdfService] Tier 2 signed URL fetch succeeded: ${pdfBlob.size} bytes`);
          }
        } else if (signedError) {
          lastError = signedError;
          console.warn("[NativePdfService] Tier 2 createSignedUrl error:", signedError);
        }
      } catch (signedEx: any) {
        lastError = signedEx;
        console.warn("[NativePdfService] Tier 2 signed URL fetch exception:", signedEx);
      }
    }

    // 2c. Tertiary: Public URL download
    if (!pdfBlob && activePath && !url.startsWith("data:") && !url.startsWith("blob:")) {
      try {
        console.log(`[NativePdfService] Tier 3: Attempting public URL fetch for "${activePath}"`);
        const { data: publicData } = supabase.storage.from(activeBucket).getPublicUrl(activePath);
        if (publicData?.publicUrl) {
          generatedUrl = publicData.publicUrl;
          const res = await fetchBlobWithByteProgress(generatedUrl, updateProgress, 15000);
          httpStatus = res.status;
          if (res.blob && res.blob.size > 0) {
            pdfBlob = res.blob;
            lastError = null;
            console.log(`[NativePdfService] Tier 3 public URL fetch succeeded: ${pdfBlob.size} bytes`);
          }
        }
      } catch (pubEx: any) {
        console.warn("[NativePdfService] Tier 3 public URL fetch exception:", pubEx);
      }
    }

    // 2d. Fallback for external HTTPS URL or data URL
    if (!pdfBlob) {
      if (url && (url.startsWith("data:") || url.startsWith("JVBERi"))) {
        pdfBlob = await dataUrlToBlob(url);
        httpStatus = 200;
        updateProgress(100, "Opening…");
      } else if (url && (url.startsWith("http://") || url.startsWith("https://")) && !url.includes("mock-supabase.local")) {
        try {
          generatedUrl = url;
          const res = await fetchBlobWithByteProgress(url, updateProgress, 15000);
          httpStatus = res.status;
          if (res.blob && res.blob.size > 0) {
            pdfBlob = res.blob;
            lastError = null;
          }
        } catch (extEx) {
          console.warn("[NativePdfService] External URL fetch exception:", extEx);
        }
      }
    }

    // Validation: Storage object must exist and not be empty
    if (!pdfBlob || pdfBlob.size <= 0) {
      console.error("[NativePdfService] STORAGE_DOWNLOAD_FAILED", {
        topicId: noteId,
        noteId: noteId,
        bucket: activeBucket,
        storagePath: activePath,
        generatedUrl,
        httpStatus,
        downloadSize: 0,
        cacheHit: false,
        exception: lastError || "Storage object not found or empty"
      });
      throw new Error("Unable to open note. Please try again.");
    }

    // Validate document magic bytes
    if (!isImg) {
      const isValidHeader = await validatePdfHeader(pdfBlob);
      if (!isValidHeader) {
        console.error("[NativePdfService] INVALID_PDF_HEADER", {
          topicId: noteId,
          noteId: noteId,
          bucket: activeBucket,
          storagePath: activePath,
          downloadSize: pdfBlob.size,
          mimeType: pdfBlob.type
        });
        throw new Error("Unable to open note. Please try again.");
      }
    }

    console.log("[NativePdfService] DOWNLOAD_SUCCESS", {
      topicId: noteId,
      noteId: noteId,
      bucket: activeBucket,
      storagePath: activePath,
      generatedUrl,
      httpStatus: httpStatus || 200,
      downloadSize: pdfBlob.size,
      cacheHit: false
    });

    // Step 3: Save to local cache
    updateProgress(85, "Opening…");

    if (isNative) {
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

      const uriResult = await Filesystem.getUri({
        path: cacheFileName,
        directory: Directory.Cache,
      });

      // Step 4: Open native viewer exactly once
      updateProgress(95, "Opening…");
      await launchNativeViewerOnce(uriResult.uri, contentType, isImg);

      updateProgress(100, "Opening…");
      return { success: true, cachedPath: uriResult.uri, isNative: true };
    } else {
      // Web / in-app preview: keep in web memory cache
      const objectUrl = URL.createObjectURL(pdfBlob);
      webBlobCache.set(cacheFileName, { blob: pdfBlob, objectUrl });

      updateProgress(100, "Opening…");
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

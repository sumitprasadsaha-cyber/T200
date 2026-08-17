import { Filesystem, Directory } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";
import { Capacitor } from "@capacitor/core";
import { getPdfDownloadUrl } from "./pdfService";
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
 * Launch native file viewer intent exactly once with debounce protection.
 */
async function launchNativeViewerOnce(uri: string, contentType: string, isImg: boolean): Promise<void> {
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
    const errStr = String(openerErr?.message || openerErr).toLowerCase();
    console.warn("[NativePdfService] Native FileOpener error:", openerErr);

    if (
      errStr.includes("no app") ||
      errStr.includes("activitynotfound") ||
      errStr.includes("not found") ||
      errStr.includes("no handler") ||
      errStr.includes("cannot open")
    ) {
      throw new Error(isImg ? "No photo viewer app installed on this device." : "No PDF reader installed on this device.");
    }
    throw new Error("Failed to open file viewer.");
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
  if (!Capacitor.isNativePlatform()) {
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

    if (statResult && statResult.size > 0) {
      const uriResult = await withTimeout(
        Filesystem.getUri({ path: cacheFileName, directory: Directory.Cache }),
        1500,
        "Get URI timed out"
      );
      return { exists: true, uri: uriResult.uri, size: statResult.size };
    }
  } catch {
    // Cache miss or timeout -> proceed to Supabase download
  }
  return { exists: false };
}

/**
 * Main function: Downloads a PDF or Image, caches it in Directory.Cache,
 * verifies size & MIME type, and opens it natively or in browser.
 * Follows the exact required lifecycle:
 * Checking cache... -> Cache not found -> Fetching note... -> Downloading... -> Saving to cache... -> Opening note...
 */
export async function openPdfWithNativeViewer(options: OpenPdfOptions): Promise<OpenPdfResult> {
  const { url, storagePath, bucket, noteId, fileName, mimeType, fileType, onProgress } = options;

  const updateProgress = (percent: number, text: string) => {
    if (onProgress) onProgress(percent, text);
  };

  if (!url && !storagePath) {
    throw new Error(fileType === "image" ? "Missing photo file location or URL." : "Missing PDF file location or URL.");
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
    const isNative = Capacitor.isNativePlatform();

    // Step 1: Checking cache...
    updateProgress(15, "Checking cache...");

    const cacheCheck = await checkLocalCache(cacheFileName);
    if (cacheCheck.exists && cacheCheck.uri) {
      // Step 2: Open cached file immediately without calling Supabase or downloading again
      console.log(`[NativePdfService] Instant cache hit: "${cacheFileName}" (${cacheCheck.size} bytes). Opening directly.`);
      updateProgress(90, "Opening note...");

      if (isNative) {
        try {
          await launchNativeViewerOnce(cacheCheck.uri, contentType, isImg);
          updateProgress(100, isImg ? "Photo opened successfully" : "PDF opened successfully");
          return { success: true, cachedPath: cacheCheck.uri, isNative: true };
        } catch (openerErr: any) {
          console.warn("[NativePdfService] Opener failed on cached file, removing corrupted cache:", openerErr);
          try {
            await Filesystem.deleteFile({ path: cacheFileName, directory: Directory.Cache });
          } catch {}
          if (!isRetry) {
            return executeOperation(true);
          }
          throw openerErr;
        }
      } else {
        window.open(cacheCheck.uri, "_blank");
        updateProgress(100, isImg ? "Photo opened successfully" : "PDF opened successfully");
        return { success: true, isNative: false };
      }
    }

    // Step 3: Cache not found -> Fetching note...
    updateProgress(25, "Cache not found");
    await new Promise((resolve) => setTimeout(resolve, 80));

    updateProgress(40, "Fetching note...");

    // Fetch download URL from Supabase with timeout protection
    let downloadUrl = "";
    try {
      downloadUrl = await withTimeout(
        getPdfDownloadUrl(url, activeBucket),
        8000,
        "Timed out resolving download link"
      );
    } catch (resErr: any) {
      console.warn("[NativePdfService] getPdfDownloadUrl failed, trying direct SDK download:", resErr);
    }

    // Downloading...
    updateProgress(60, "Downloading...");

    let pdfBlob: Blob | null = null;

    // 3a. Direct Supabase SDK download for active path
    if (activePath && !url.startsWith("data:") && !url.startsWith("blob:")) {
      try {
        const sdkRes = await withTimeout<{ data: Blob | null; error: any }>(
          supabase.storage.from(activeBucket).download(activePath),
          15000,
          "Supabase download timed out"
        );

        if (!sdkRes.error && sdkRes.data && sdkRes.data.size > 0) {
          pdfBlob = sdkRes.data;
        }
      } catch (sdkEx) {
        console.warn("[NativePdfService] Direct SDK download fallback to HTTPS url:", sdkEx);
      }
    }

    // 3b. Fetch via HTTPS downloadUrl if blob not retrieved yet
    if (!pdfBlob) {
      if (!downloadUrl) {
        throw new Error(isImg ? "Unable to resolve photo storage URL." : "Unable to resolve notes storage URL.");
      }

      if (downloadUrl.startsWith("data:") || downloadUrl.startsWith("JVBERi")) {
        pdfBlob = await dataUrlToBlob(downloadUrl);
      } else {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(downloadUrl, { signal: controller.signal });
          if (!response.ok) {
            if (response.status === 404) {
              throw new Error("Note file not found in storage.");
            } else if (response.status === 401 || response.status === 403) {
              throw new Error("Access denied.");
            }
            throw new Error(`Unable to download note (status ${response.status}).`);
          }
          pdfBlob = await response.blob();
        } catch (fetchErr: any) {
          if (fetchErr.name === "AbortError") {
            throw new Error("Download request timed out. Please check your connection.");
          }
          throw fetchErr;
        } finally {
          clearTimeout(fetchTimeout);
        }
      }
    }

    // Cache Validation: ensure size > 0
    if (!pdfBlob || pdfBlob.size <= 0) {
      throw new Error("Downloaded note file is empty.");
    }

    if (!isImg) {
      const isValidHeader = await validatePdfHeader(pdfBlob);
      if (!isValidHeader) {
        throw new Error("Invalid document format.");
      }
    }

    // Step 4: Saving to cache...
    updateProgress(80, "Saving to cache...");

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

      // Verify newly cached file exists and is valid
      let statCheck: any = null;
      try {
        statCheck = await withTimeout(
          Filesystem.stat({ path: cacheFileName, directory: Directory.Cache }),
          3000,
          "Cache verification timed out"
        );
      } catch (statErr) {
        console.warn("[NativePdfService] Cache verification warning:", statErr);
      }

      if (!statCheck || statCheck.size <= 0) {
        // Validation failed: delete corrupted file and retry once
        try {
          await Filesystem.deleteFile({ path: cacheFileName, directory: Directory.Cache });
        } catch {}
        if (!isRetry) {
          console.warn("[NativePdfService] Cache validation failed after download. Retrying once...");
          return executeOperation(true);
        }
        throw new Error("Failed to verify cached document.");
      }

      const uriResult = await Filesystem.getUri({
        path: cacheFileName,
        directory: Directory.Cache,
      });

      // Step 5: Opening note...
      updateProgress(95, "Opening note...");
      await launchNativeViewerOnce(uriResult.uri, contentType, isImg);

      updateProgress(100, isImg ? "Photo opened successfully" : "PDF opened successfully");
      return { success: true, cachedPath: uriResult.uri, isNative: true };
    } else {
      // Web / Browser Preview
      const objectUrl = URL.createObjectURL(pdfBlob);
      webBlobCache.set(cacheFileName, { blob: pdfBlob, objectUrl });

      updateProgress(95, "Opening note...");
      window.open(objectUrl, "_blank");
      updateProgress(100, isImg ? "Photo opened successfully" : "PDF opened successfully");
      return { success: true, isNative: false };
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
  const isNative = typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();
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
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

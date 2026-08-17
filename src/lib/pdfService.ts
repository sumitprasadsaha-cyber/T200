import { getResolvedViewUrl, getBucketName } from "./storageService";

/**
 * Resolves a Supabase storage path or generic URL to a fresh secure HTTPS signed/public URL.
 * Never reuses expired signed URLs from localStorage to prevent HTTP 401 Unauthorized errors.
 */
export async function getPdfDownloadUrl(pdfUrl: string, bucketName?: string): Promise<string> {
  console.log(`[PDF Service Debug] Resolving PDF URL for path/URL:`, pdfUrl);
  if (!pdfUrl) {
    throw new Error("PDF path is missing.");
  }

  const bucket = getBucketName(bucketName);

  try {
    const resolvedUrl = await getResolvedViewUrl(bucket, pdfUrl);
    console.log(`[PDF Service Debug] Final resolved URL for viewer:`, resolvedUrl);
    return resolvedUrl;
  } catch (error: any) {
    console.error("[PDF Service] Failed to resolve PDF download URL:", error);
    if (error.message?.includes("Permission") || error.status === 401 || error.status === 403) {
      throw new Error("HTTP 401 Unauthorized: Access denied.");
    } else if (error.message?.includes("not found") || error.status === 404) {
      throw new Error("HTTP 404 Not Found: PDF file not found in storage.");
    }
    throw error;
  }
}

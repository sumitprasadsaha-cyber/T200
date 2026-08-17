import { downloadFileFromStorage, getResolvedViewUrl, getBucketName } from "./storageService";

/**
 * Downloads a file from Supabase Storage directly to the user's device.
 */
export async function downloadFileFromSupabase(
  bucket: string,
  storagePath: string,
  fileName: string
): Promise<void> {
  return downloadFileFromStorage(bucket, storagePath, fileName);
}

/**
 * Obtains a fresh signed URL for a given storage path.
 */
export async function getFreshSignedUrl(
  bucket: string,
  storagePath: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  return getResolvedViewUrl(bucket, storagePath);
}

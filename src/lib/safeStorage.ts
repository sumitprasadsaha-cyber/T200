/**
 * Safe LocalStorage Utilities & Storage Quota Protection
 */

export function getStorageMetrics(): { keys: Record<string, number>; totalKB: number } {
  if (typeof window === "undefined" || !window.localStorage) {
    return { keys: {}, totalKB: 0 };
  }
  const keys: Record<string, number> = {};
  let totalBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) {
        const val = localStorage.getItem(k) || "";
        const bytes = (k.length + val.length) * 2;
        const kb = Math.round((bytes / 1024) * 100) / 100;
        keys[k] = kb;
        totalBytes += bytes;
      }
    }
  } catch (_) {}
  const totalKB = Math.round((totalBytes / 1024) * 100) / 100;
  return { keys, totalKB };
}

export function purgeObsoleteStorage(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    // Keys to always purge if storage pressure occurs or on startup
    const keysToRemove = [
      "tuition_topic_practice_tests_bank",
      "tuition_practice_tests_sync_queue",
      "uploaded_pdf_",
      "tuition_ai_report_",
      "mock_storage_meta_"
    ];

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;

      // Purge match
      const shouldPurge = keysToRemove.some((prefix) => k.startsWith(prefix) || k.includes(prefix));
      if (shouldPurge) {
        localStorage.removeItem(k);
      }
    }
  } catch (err) {
    console.warn("[SafeStorage] Purge error:", err);
  }
}

export function autoCleanupStorageIfOverLimit(limitMB: number = 2): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const { totalKB } = getStorageMetrics();
    const limitKB = limitMB * 1024;
    
    // Check if any legacy heavy test cache exists
    const legacyTestsCache = localStorage.getItem("tuition_topic_practice_tests_bank");
    if (legacyTestsCache && (legacyTestsCache.includes('"questions"') || legacyTestsCache.includes('"rawText"'))) {
      console.warn("[SafeStorage] Legacy heavy practice test cache detected. Purging immediately.");
      localStorage.removeItem("tuition_topic_practice_tests_bank");
    }

    if (totalKB > limitKB) {
      console.warn(`[SafeStorage] Storage usage (${totalKB} KB) exceeds threshold (${limitKB} KB). Cleaning up non-essential caches.`);
      purgeObsoleteStorage();
    }
  } catch (_) {}
}

const MAX_LOCAL_STORAGE_ITEM_BYTES = 50 * 1024;

function estimateBytes(value: string): number {
  return value.length * 2;
}

export function safeLocalStorageSetItem(key: string, value: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;

  const itemBytes = estimateBytes(value);
  if (itemBytes > MAX_LOCAL_STORAGE_ITEM_BYTES) {
    console.warn(
      `[SafeStorage] Refusing to store key "${key}" because size ${Math.round(itemBytes / 1024)} KB exceeds ${Math.round(
        MAX_LOCAL_STORAGE_ITEM_BYTES / 1024
      )} KB limit.`
    );
    return;
  }

  try {
    localStorage.setItem(key, value);
  } catch (err: any) {
    console.warn(`[SafeStorage] QuotaExceededError or write failure for key "${key}". Executing storage recovery.`, err);
    try {
      purgeObsoleteStorage();
      localStorage.setItem(key, value);
    } catch (retryErr) {
      console.error(`[SafeStorage] Retry failed for key "${key}". Swallowing error to prevent crash.`, retryErr);
      try {
        localStorage.removeItem(key);
      } catch (_) {}
    }
  }
}

export function safeLocalStorageGetItem(key: string): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`[SafeStorage] getItem failed for key "${key}":`, e);
    return null;
  }
}

export function safeLocalStorageRemoveItem(key: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn(`[SafeStorage] removeItem failed for key "${key}":`, e);
  }
}

// Automatically execute safety check on script load
if (typeof window !== "undefined") {
  autoCleanupStorageIfOverLimit(1.5);
}

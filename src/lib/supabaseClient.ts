import { createClient } from "@supabase/supabase-js";
import { safeLocalStorageSetItem, safeLocalStorageRemoveItem } from "./safeStorage";

let supabaseInstance: any = null;

// In-memory mock storage for files when Supabase is unconfigured
const mockStorage = new Map<string, Blob>();

function createMockSupabaseClient() {
  console.log("[Supabase Mock] Using in-memory fallback client because VITE_SUPABASE_URL is not set.");
  return {
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, file: File | Blob, options?: any) {
            console.log(`[Supabase Mock] upload to ${bucket}/${path}`);
            mockStorage.set(`${bucket}/${path}`, file);
            
            try {
              if (file instanceof File || file instanceof Blob) {
                const fileMeta = {
                  name: (file as File).name || "file",
                  size: file.size,
                  type: file.type,
                  uploadedAt: new Date().toISOString()
                };
                safeLocalStorageSetItem(`mock_storage_meta_${bucket}_${path}`, JSON.stringify(fileMeta));
              }
            } catch (e) {
              // Ignore localstorage errors
            }

            return { data: { path }, error: null };
          },
          async download(path: string) {
            console.log(`[Supabase Mock] download from ${bucket}/${path}`);
            const blob = mockStorage.get(`${bucket}/${path}`);
            if (blob) {
              return { data: blob, error: null };
            }
            
            let dummyBlob: Blob;
            if (path.endsWith(".pdf")) {
              dummyBlob = new Blob(["%PDF-1.4 mock pdf content"], { type: "application/pdf" });
            } else {
              dummyBlob = new Blob(["mock image content"], { type: "image/png" });
            }
            return { data: dummyBlob, error: null };
          },
          async remove(paths: string[]) {
            console.log(`[Supabase Mock] remove from ${bucket}:`, paths);
            paths.forEach(p => {
              mockStorage.delete(`${bucket}/${p}`);
              safeLocalStorageRemoveItem(`mock_storage_meta_${bucket}_${p}`);
            });
            return { data: null, error: null };
          },
          getPublicUrl(path: string) {
            console.log(`[Supabase Mock] getPublicUrl for ${bucket}/${path}`);
            const blob = mockStorage.get(`${bucket}/${path}`);
            const url = `https://mock-supabase.local/storage/v1/object/public/${bucket}/${path}`;
            return { data: { publicUrl: url }, error: blob ? null : { message: "Object not found in mock storage." } };
          },
          async createSignedUrl(path: string, expiresIn: number) {
            console.log(`[Supabase Mock] createSignedUrl for ${bucket}/${path}`);
            const blob = mockStorage.get(`${bucket}/${path}`);
            const url = `https://mock-supabase.local/storage/v1/object/sign/${bucket}/${path}?expiresIn=${expiresIn}`;
            return {
              data: { signedUrl: url },
              error: blob ? null : { message: "Object not found in mock storage." }
            };
          }
        };
      }
    }
  };
}

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

const DEFAULT_SUPABASE_URL = "https://kffaehofciebfqczhfxm.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_t9Xgetmt4736XUtCrAq8pQ_zcTJWzUg";

function getClient() {
  if (!supabaseInstance) {
    const rawSupabaseUrl = getRuntimeEnvValue("VITE_SUPABASE_URL") || DEFAULT_SUPABASE_URL;
    const supabaseAnonKey = getRuntimeEnvValue("VITE_SUPABASE_ANON_KEY") || DEFAULT_SUPABASE_ANON_KEY;
    
    // Normalize Supabase URL by stripping trailing '/rest/v1' or '/rest/v1/' or trailing slashes
    const cleanSupabaseUrl = rawSupabaseUrl
      .trim()
      .replace(/\/rest\/v1\/?$/i, "")
      .replace(/\/+$/, "");

    console.log(`[SupabaseClient] Initialized client with clean base URL: "${cleanSupabaseUrl}"`);
    supabaseInstance = createClient(cleanSupabaseUrl, supabaseAnonKey);
  }
  return supabaseInstance;
}

export const supabase = new Proxy({} as any, {
  get(target, prop, receiver) {
    try {
      const client = getClient();
      const value = Reflect.get(client, prop);
      if (typeof value === "function") {
        return value.bind(client);
      }
      return value;
    } catch (err: any) {
      if (prop === "then" || prop === "toJSON" || typeof prop === "symbol") {
        return undefined;
      }
      throw err;
    }
  }
});


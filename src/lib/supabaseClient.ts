import { createClient } from "@supabase/supabase-js";

let supabaseInstance: any = null;

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

export function getSupabaseConfig(): { url: string; anonKey: string } {
  const rawSupabaseUrl = getRuntimeEnvValue("VITE_SUPABASE_URL") || DEFAULT_SUPABASE_URL;
  const supabaseAnonKey = getRuntimeEnvValue("VITE_SUPABASE_ANON_KEY") || DEFAULT_SUPABASE_ANON_KEY;
  const cleanSupabaseUrl = rawSupabaseUrl
    .trim()
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/+$/, "");
  return { url: cleanSupabaseUrl, anonKey: supabaseAnonKey };
}

function getClient() {
  if (!supabaseInstance) {
    const { url: cleanSupabaseUrl, anonKey: supabaseAnonKey } = getSupabaseConfig();
    console.log(`[SupabaseClient] Initialized client for database queries: "${cleanSupabaseUrl}"`);
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


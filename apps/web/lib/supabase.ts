import { createClient } from "@supabase/supabase-js";

// Public, client-safe Supabase config. The URL and the *anon* key are designed to
// be shipped in the browser bundle (the anon key is gated by Row Level Security),
// so we ship them as defaults. This guarantees the client works even when the
// production build wasn't given NEXT_PUBLIC_SUPABASE_* as build args (e.g. Railway).
// Env vars still take precedence so other deployments can point elsewhere.
// NOTE: never put the SERVICE ROLE key here — that one is server-only.
const DEFAULT_SUPABASE_URL = "https://slmlubxaclmoqxivcurz.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsbWx1YnhhY2xtb3F4aXZjdXJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxNTAxNzksImV4cCI6MjA2OTcyNjE3OX0.z-hHINCzcOEbU4mj8CrayoJhXRmOH6Fi8jfg0Fl72fw";

/**
 * Resolved public Supabase config — env overrides the shipped defaults. Shared by
 * the browser client AND server-side token verification (lib/server/requireAuth)
 * so auth always has a working URL + anon key even when the host build wasn't given
 * NEXT_PUBLIC_SUPABASE_* (e.g. Railway). The anon key is public + RLS-gated.
 */
export function getSupabaseAuthConfig(): { url: string; anonKey: string } {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
  };
}

let _browserClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  const { url, anonKey } = getSupabaseAuthConfig();
  if (!url || !anonKey) {
    throw new Error("Supabase client is not configured (missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).");
  }
  // Browser: reuse ONE client so we don't spawn "Multiple GoTrueClient instances
  // detected in the same browser context". Auth is 100% Privy — this client only
  // does anon, RLS-gated reads (content_rewards*), so auth persistence is off,
  // making the lone GoTrueClient inert. Server: fresh per call (no shared storage).
  if (typeof window !== "undefined") {
    if (!_browserClient) {
      _browserClient = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    }
    return _browserClient;
  }
  return createClient(url, anonKey);
}

/**
 * Public Privy app id.
 *
 * `NEXT_PUBLIC_PRIVY_APP_ID` overrides it; otherwise we ship the known Vello app
 * id as a default. NEXT_PUBLIC_* values are inlined into the client bundle at
 * BUILD time, so a host (Railway, etc.) that doesn't pass the build arg would
 * otherwise bake an empty value and silently fall back to the no-Privy wallet
 * modal in production. The app id is PUBLIC (it ships in the bundle regardless),
 * so defaulting it here is safe — exactly like this repo's shipped Supabase
 * defaults. The app SECRET is NOT here; it stays a server-only runtime env var.
 */
export const PRIVY_APP_ID =
  (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").trim() || "cmq7zz1pj00d00cjmr00fihcz";

/** True when a Privy app id is available (always true given the shipped default). */
export const PRIVY_ENABLED = PRIVY_APP_ID.length > 0;

/**
 * Optional Privy **client** id. Privy apps can define multiple "clients" (Local,
 * Production, …) that OVERRIDE app-level settings — most importantly the allowed
 * origins and cookie config for that environment. Passing the matching client id
 * makes login use that client's allowed origins, which is what unblocks wallet
 * login on localhost (set `NEXT_PUBLIC_PRIVY_CLIENT_ID` to the "Local" client id
 * in .env.local). Empty in prod → app-level defaults apply. No hardcoded default:
 * a client id is environment-specific, so baking one in would be wrong elsewhere.
 */
export const PRIVY_CLIENT_ID =
  (process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID ?? "").trim() || undefined;

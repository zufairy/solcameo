# Vello Auth Setup — Google login (Supabase)

Vello's Google login reuses the **same Supabase project as jobtepi-web**
(`slmlubxaclmoqxivcurz`), where Google OAuth is already fully configured. There
are no new OAuth credentials to create and no Google Console changes — it's the
same login users already get on jobtepi-web.

## How it works

- The browser signs in with `supabase.auth.signInWithOAuth({ provider: "google" })`.
- Supabase returns a session (access token + user) and handles refresh.
- Convex **actions** verify that access token server-side by calling Supabase's
  own `GET /auth/v1/user` endpoint, then upsert the user into the Convex `users`
  table. The admin panel is gated by `users.isAdmin`, enforced inside those
  verified actions (`assertAdminUser`).

This avoids the JWKS/asymmetric-key requirement of Convex's native third-party
auth — it works with the project's current HS256 tokens, using only the public
anon key.

## Configuration

### 1. Convex env (already set on this deployment)

```bash
npx convex env set SUPABASE_URL       https://slmlubxaclmoqxivcurz.supabase.co
npx convex env set SUPABASE_ANON_KEY  <anon key>          # public, from .env.local
```

These were set during implementation. Verify with `npx convex env list`.

### 2. Admin seeding

The **first user to sign in is auto-promoted to admin** so the panel is
reachable. To explicitly seed admins by email instead:

```bash
npx convex env set ADMIN_SEED_EMAILS "you@example.com,teammate@example.com"
```

Any signed-in admin can then grant/revoke admin and suspend users from
`/admin → Users`.

### 3. Supabase redirect URLs

If sign-in doesn't return to the app, add vello's origin to the Supabase
dashboard → Authentication → URL Configuration → **Redirect URLs**
(e.g. `http://localhost:3000`, and the deployed vello domain). `localhost` is
usually allowed by default.

## Env var reference

| Var | Where | Purpose |
|-----|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` | Supabase project URL (client) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` | Supabase anon key (client) |
| `SUPABASE_URL` | Convex env | Same URL, for server-side token verification |
| `SUPABASE_ANON_KEY` | Convex env | Same anon key, used as `apikey` header |
| `ADMIN_SEED_EMAILS` | Convex env | Comma-separated emails auto-promoted to admin |

## Files

- `lib/supabase.ts` — browser Supabase client.
- `providers/supabase-auth-provider.tsx` — tracks the session, exposes
  `signInWithGoogle` / `signOut`, and resolves the Convex profile via `whoami`.
- `convex/lib/supabaseAuth.ts` — `verifyToken()` (calls Supabase `/auth/v1/user`).
- `convex/users.ts` — `whoami`, `linkWallet`, `unlinkWallet` actions + internal ops.
- `convex/admin.ts` — admin-only actions, each gated by a verified-token admin check.
- `components/layout/account-button.tsx` — sign-in + account menu + link wallet.
- `app/admin/page.tsx` + `components/admin/*` — the gated panel.

## Identity model

- A **Google account** (via Supabase) is the identity. `users.walletAddress` is
  set when a user links a Solana wallet, bridging the account to all existing
  wallet-keyed data (`creatorWallet`, `investorWallet`, …) — no data migration.
- Google-only users can browse/manage; on-chain actions (mint/invest) still
  require connecting a wallet, which they can then link from the account menu.

## Note on reactivity

Admin reads/writes go through Convex **actions** (token-verified), which are not
live-reactive like queries. The Users tab fetches on mount and after each change
(there's a refresh button). Public data (agents, campaigns) still uses reactive
queries.

# Google Auth + Admin Panel — Design (Vello)

Date: 2026-06-01
App: `apps/vello` (Next.js 16.2.6, React 19.2, Convex 1.39)

## Goal

1. Let non-crypto users onboard with **Google login** (professional, no web3 jargon), establishing a real user identity.
2. Keep existing Solana wallet (Phantom/Solflare) flows for on-chain actions; allow a Google user to **link a wallet**.
3. Build a **gated admin panel** at `/admin` that shows users, agents, campaigns, wallet balances, and cron/heartbeat status, with working edits.

Privy was considered and rejected. Chosen solution: **Convex Auth** (`@convex-dev/auth`) — native to the Convex backend, built-in users table, server-enforced identity for the admin gate.

## Identity model

- Today identity is wallet-only (Solana wallet adapter); a "user" is just a wallet string appearing across `influencers.creatorWallet`, `investments.investorWallet`, `campaigns.creatorWallet`, `workerHires.businessWallet`, etc. No users table, no server session.
- After this work: **Google account = identity**. `users.walletAddress` (set when the user links a wallet) bridges the account to all existing wallet-keyed data — **no data migration** required.
- Without Privy embedded wallets, a Google-only user can browse/manage but must connect a wallet for on-chain actions (mint/invest).

## Part 1 — Google login + Users (Convex Auth)

### Backend (Convex)
- Add deps: `@convex-dev/auth`, `@auth/core`.
- `convex/auth.ts`: `convexAuth({ providers: [Google] })`.
- `convex/auth.config.ts`: provider/domain config for JWT verification.
- `convex/http.ts`: register `auth.addHttpRoutes(http)`.
- `convex/schema.ts`: spread `...authTables`; customize the `users` table with extra fields.

### Users table (extends Convex Auth's base `users`)
```
users: {
  // base (from authTables): name?, email?, image?, emailVerificationTime?, ...
  walletAddress: optional(string),     // linked Solana pubkey
  walletType:    optional("external"|"embedded"),
  isAdmin:       optional(boolean),    // gates admin panel, server-enforced
  status:        optional("active"|"suspended"),
  createdAt:     optional(number),
  lastSeenAt:    optional(number),
}  // indexes: by_wallet (walletAddress)
```

### Convex functions
- `users.me` — current user from `ctx.auth.getUserIdentity()` / `getAuthUserId`.
- `users.isCurrentUserAdmin` — boolean.
- `users.upsertProfileOnLogin` — sets `createdAt`/`lastSeenAt`; seeds `isAdmin` from `ADMIN_SEED_EMAILS` env or first-user.
- `users.linkWallet({ walletAddress, walletType })` — stores pubkey on the caller's user row.
- `requireAdmin(ctx)` helper (in `convex/lib/auth.ts`) — throws unless caller `isAdmin`. Used by all admin mutations/queries.

### Frontend
- `providers/convex-provider.tsx` → use `ConvexAuthProvider` (Convex Auth React) wrapping `ConvexReactClient`.
- `app/layout.tsx` provider order: ConvexAuth → SolanaWallet → Sidebar.
- TopBar: "Sign in with Google" button when signed out; account menu (name/email, wallet link status, sign out) when signed in. Uses `useAuthActions().signIn("google")` / `signOut()`.
- Link wallet: when a wallet is connected and the user is signed in but `walletAddress` is unset, surface a "Link wallet" action calling `users.linkWallet`.
- Onboarding: minimal — first Google login lands on `/market`; profile is optional.

### Env (scaffold with placeholders + checklist)
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (Google OAuth client).
- `SITE_URL` (e.g. http://localhost:3000).
- `JWT_PRIVATE_KEY`, `JWKS` (generated for Convex Auth) — set via `npx convex env set`.
- `ADMIN_SEED_EMAILS` (comma-separated) — emails auto-promoted to admin on first login.

## Part 2 — Admin panel (`/admin`, gated)

- Client gate: `useQuery(api.users.isCurrentUserAdmin)`; non-admins see an access-denied / sign-in screen.
- **Server gate (authoritative):** every admin query/mutation calls `requireAdmin(ctx)`.
- Sections:
  - **Overview**: existing KPIs (TVL, earnings, agents, campaigns, submissions, workers).
  - **Users**: list (email, wallet, isAdmin, status, # agents created, balances) → drill-in; edit `isAdmin` and `status` via `admin.setUserAdmin` / `admin.setUserStatus`.
  - **Agents**: list + edit agent fields (`influencers.update`); adjust paper balance (`adjustPaperBalance`); cron/heartbeat — toggle `heartbeatEnabled`, change `heartbeatCron`, view `heartbeatLastFiredAt` + next-due, "fire now" (`admin.fireHeartbeatNow`).
  - **Campaigns**: change `status` / `budget` / `deadline` (`admin.updateCampaign`).
  - **Crons monitor**: every heartbeat-enabled agent — interval, last fired, computed next-due, enabled flag.
- New admin-gated mutations live in `convex/admin.ts`, all guarded by `requireAdmin`.

## Error handling
- Missing Privy/Google env → app still renders; sign-in surfaces a clear "auth not configured" message rather than crashing.
- Convex unauthenticated → admin queries return null/false; panel shows access-denied.
- Wallet link conflict (pubkey already linked to another user) → mutation throws a friendly error.

## Testing
- Convex unit tests (`convex-test`, already in repo): `users.upsertProfileOnLogin` (new/returning/admin-seed), `users.linkWallet` (link, conflict), `requireAdmin` (allow/deny), `admin.setUserAdmin`.
- Manual: Google login → user row created → link Phantom → owned agents resolve → admin seed flips `isAdmin` → `/admin` reachable only by admin → edits persist → "fire now" updates `heartbeatLastFiredAt`.

## Risks
- Next 16 + React 19 are new; Convex Auth is beta — integration friction possible; debug iteratively.
- Login is live only after real Google OAuth creds + generated JWT keys are set. All code is built and scaffolded with placeholders until then.
- Client gate must always be backed by server `requireAdmin` — never trust the client.

## Build order
1. Spec (this doc).
2. Part 1 backend (auth, schema, users functions) + tests.
3. Part 1 frontend (providers, TopBar sign-in, link wallet).
4. Verify Part 1.
5. Part 2 admin backend (`admin.ts` + `requireAdmin`) + tests.
6. Part 2 admin UI sections.
7. Verify Part 2; env checklist + docs.

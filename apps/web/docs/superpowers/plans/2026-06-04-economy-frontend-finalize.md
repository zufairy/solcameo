# Economy Frontend Finalize — Implementation Plan (sub-project 7)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Make buy + redeem usable by real users: fix the auth wallet-resolution blocker, rewire the live invest UI to the vault route, and add a redeem UI.

**Depends on (committed):** vault routes `/api/market/buy-shares` + `/api/market/redeem-shares`; `convex/shares.ts`; `users.whoami`.

**Key facts from the map:**
- BLOCKER: vault routes use `getUserWallet(auth.user)` (Supabase `user_metadata.wallet_address`), but the app stores linked wallets in **Convex `users.walletAddress`**. So the ownership check 403s for normal users. Fix: resolve the wallet via `api.users.whoami({ accessToken })` (action; returns `{ walletAddress?, ... }`).
- The live buy UI is `InvestPanel` in `components/influencer/influencer-profile.tsx` (~line 225+). It already transfers USDC to `influencer.agentWallet` via `sendTransaction`, captures `signature`, then calls `api.influencers.invest` (legacy) at ~line 308. Rewire that call to `POST /api/market/buy-shares`.
- Client auth token: `useSupabaseAuth()` → `accessToken`; pattern `Authorization: Bearer ${accessToken}` (already used in this file ~line 668/808).
- Holdings query: `api.shares.walletShares({ mintAddress, wallet })`.

---

## Task 1: Fix vault-route wallet resolution (the auth blocker)

**Files:**
- Create: `lib/server/resolveWallet.ts`
- Modify: `app/api/market/buy-shares/route.ts`, `app/api/market/redeem-shares/route.ts`

### Step 1: helper
`lib/server/resolveWallet.ts`:
```ts
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/** Resolve the Solana wallet the authenticated user has LINKED (stored in Convex
 *  users.walletAddress), via the verified Supabase access token. Returns
 *  undefined if no wallet is linked. Use this for ownership checks instead of
 *  Supabase user_metadata (which the app never populates). */
export async function resolveLinkedWallet(accessToken: string): Promise<string | undefined> {
  try {
    const me = await convex.action(api.users.whoami, { accessToken });
    return me?.walletAddress;
  } catch {
    return undefined;
  }
}
```

### Step 2: use it in both routes
In `app/api/market/buy-shares/route.ts`: remove the `getUserWallet` import + usage; add `import { resolveLinkedWallet } from "@/lib/server/resolveWallet";`. Replace the ownership block with:
```ts
  const userWallet = await resolveLinkedWallet(auth.token);
  if (!userWallet || userWallet !== investorWallet) {
    return NextResponse.json({ error: "connected wallet is not linked to your account" }, { status: 403 });
  }
```
(Place after parsing the body, as before. `auth.token` is the Supabase access token from `requireAuth`.)
Do the same in `redeem-shares/route.ts` comparing against `holderWallet`.

### Step 3: typecheck + commit
`npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "buy-shares|redeem-shares|resolveWallet" || echo OK`. Commit (stage only the 3 files): `fix(economy): resolve linked wallet from Convex (whoami) for vault-route ownership`.

---

## Task 2: Rewire InvestPanel buy → vault route

**Files:** Modify `components/influencer/influencer-profile.tsx` (the `InvestPanel` component).

### Step 1: read InvestPanel (~lines 215–460) — note the `investMutation` call (~308), the `total` (USDC) and `signature` vars, and that `useSupabaseAuth` is imported (it's used ~668/808; if not imported in scope, add `import { useSupabaseAuth } from "@/providers/supabase-auth-provider";` and `const { accessToken } = useSupabaseAuth();` inside InvestPanel).

### Step 2: replace the mutation call
After the on-chain transfer succeeds (`const signature = await sendTransaction(...)`), REPLACE the `await investMutation({ mintAddress, investorWallet, usdcAmount: total, txSignature: signature })` call with:
```ts
        const resp = await fetch("/api/market/buy-shares", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            mintAddress: influencer.id,
            investorWallet: publicKey.toBase58(),
            depositUsdc: total,
            txSignature: signature,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error ?? "buy failed");
```
Keep the surrounding step-state (`setInvestStep("recording")`, success/reset UI) intact. Remove the now-unused `investMutation`/`useMutation(api.influencers.invest)` declaration ONLY if nothing else uses it (grep within the file). Keep the USDC transfer logic unchanged (it already targets `agentWallet`).

### Step 3: typecheck + commit
`npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "influencer-profile" || echo OK`. Commit (stage only the file): `feat(economy): invest panel buys via the vault route (NAV shares)`.

---

## Task 3: Redeem UI

Add a minimal redeem control on the agent profile for a holder who owns shares of THIS agent.

**Files:** Modify `components/influencer/influencer-profile.tsx` (add a `RedeemPanel` near `InvestPanel`, render it where InvestPanel renders).

### Step 1: RedeemPanel component
Add a component that:
- `const { publicKey, connected } = useWallet();` `const { accessToken } = useSupabaseAuth();`
- `const held = useQuery(api.shares.walletShares, connected && publicKey ? { mintAddress: influencer.id, wallet: publicKey.toBase58() } : "skip");`
- If `!held || held <= 0`, render nothing (or a muted "You hold no shares of this agent").
- Else show held shares + a number input (1..held) + a "Redeem" button that POSTs:
```ts
  const resp = await fetch("/api/market/redeem-shares", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify({ mintAddress: influencer.id, holderWallet: publicKey!.toBase58(), sharesToBurn: amount }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? "redeem failed");
  // show data.payout, data.txSignature; refresh held (useQuery auto-updates)
```
- Loading/error/success states like InvestPanel. Match the file's existing styling (Tailwind classes used in InvestPanel).

### Step 2: render it
Render `<RedeemPanel influencer={influencer} />` adjacent to where `<InvestPanel .../>` is rendered in the profile, so a holder sees both buy and redeem.

### Step 3: typecheck + commit
`npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "influencer-profile" || echo OK`. Commit (stage only the file): `feat(economy): redeem UI on agent profile (NAV redemption)`.

---

## Out of scope (documented)
- Wider service metering (image_gen/social_post/transcription/chat) at the autonomy executor.
- A dedicated holdings/portfolio page aggregating all investments (this adds redeem only on each agent's profile).
- Mainnet-gate items (spec §11) incl. compliance review.

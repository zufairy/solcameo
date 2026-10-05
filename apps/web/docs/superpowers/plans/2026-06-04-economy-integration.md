# Economy Integration — Implementation Plan (sub-project 6)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Wire the tested economy accounting into live code so it runs on devnet: settle service tabs on-chain via a keeper cron, meter the agent's most expensive autonomous service (video render), and switch the mint UI to pay in USDC.

**Spec:** `docs/superpowers/specs/2026-06-03-agent-economic-layer-design.md` §6.1, §7, §5.1.

**Depends on (committed, tested):** SP1–SP5 — `convex/usage.ts` (`recordUsage`, `settleTab`, `markSettlementPaid`), `convex/agentAccount.ts`, `lib/trader/usdcTransfer.ts`, `lib/economy/constants.ts` (`SETTLE_THRESHOLD_USDC`), `lib/economy/walletSecretAccess.ts`.

**Key facts from the integration map:**
- Table is `agentAccount` (singular). Cron pattern: `convex/crons.ts` uses `crons.interval` + an `internalAction` that `fetch`es a Next route with `X-Internal-Secret: process.env.INTERNAL_CRON_SECRET`, base `process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"`.
- Internal auth: `requireInternalOrUserAuth(req)` / `checkInternalSecret(req)` from `@/lib/server/requireAuth`.
- `video/render-step` has `job.mintAddress` and records `cost: 0.2` on `agentTasks.succeed` (line ~129).
- Mint UI: `components/builder/NftMintCard.tsx` `handleMint` (lines ~66–117) builds a `SystemProgram.transfer` of `MINT_FEE` SOL to `TREASURY`; client-side USDC transfer reference is in `components/influencer/share-purchase-dialog.tsx` (lines ~91–108).

---

## Task 1: On-chain tab settlement route + keeper cron

**Files:**
- Create: `app/api/economy/settle-tab/route.ts`
- Modify: `convex/crons.ts` (add `getAgentAccountsDue` internalQuery + `settleDueTabs` internalAction + a `crons.interval`)
- Test: `convex/crons.test.ts` (the internalQuery filter only — the on-chain bits are devnet-manual)

### Step 1: settle-tab route
`app/api/economy/settle-tab/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "@/convex/_generated/api";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { transferUsdc } from "@/lib/trader/usdcTransfer";
import { readAgentSecret } from "@/lib/economy/walletSecretAccess";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const TREASURY = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET ?? "";

export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const { mintAddress } = await req.json();
  if (!mintAddress) return NextResponse.json({ error: "missing mintAddress" }, { status: 400 });
  if (!TREASURY) return NextResponse.json({ error: "treasury not configured" }, { status: 500 });

  const agent = await convex.query(internal.influencers.getByMintInternal, { mintAddress });
  if (!agent?.agentWallet || !agent.agentWalletSecret) {
    return NextResponse.json({ error: "agent has no escrow wallet" }, { status: 400 });
  }

  // 1) Record the settlement (marks usage rows, decrements escrow mirror).
  const settled = await convex.mutation(api.usage.settleTab, { mintAddress });
  if (!settled.settled) return NextResponse.json({ ok: true, settled: false });

  // 2) Move the accrued fee escrow → treasury.
  const transfer = await transferUsdc({
    fromSecretBase64: readAgentSecret(agent.agentWalletSecret),
    fromPubkey: agent.agentWallet,
    toPubkey: TREASURY,
    amountUsdc: settled.amountUsdc,
  });
  if (!transfer.ok) {
    return NextResponse.json(
      { error: `settlement transfer failed (${transfer.step}: ${transfer.error}); settlement ${settled.settlementId} pending`, settlementId: settled.settlementId },
      { status: 502 },
    );
  }

  // 3) Stamp the payout signature.
  await convex.mutation(api.usage.markSettlementPaid, { settlementId: settled.settlementId, txSignature: transfer.txSignature! });
  return NextResponse.json({ ok: true, settled: true, amountUsdc: settled.amountUsdc, txSignature: transfer.txSignature });
}
```

### Step 2: cron in `convex/crons.ts`
Add (after reading the file to match its import style — it imports `internalAction`, `internalQuery` from `./_generated/server` and `internal` from `./_generated/api`; import `SETTLE_THRESHOLD_USDC` from `../lib/economy/constants`):
```ts
export const getAgentAccountsDue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("agentAccount").collect();
    return accounts
      .filter((a) => a.unsettledTabUsdc >= SETTLE_THRESHOLD_USDC)
      .map((a) => ({ mintAddress: a.mintAddress }));
  },
});

export const settleDueTabs = internalAction({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.crons.getAgentAccountsDue, {});
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await Promise.allSettled(
      due.map((a) =>
        fetch(`${baseUrl}/api/economy/settle-tab`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
          },
          body: JSON.stringify({ mintAddress: a.mintAddress }),
        }).catch(() => null),
      ),
    );
    return { triggered: due.length };
  },
});
```
And register the interval near the existing `crons.interval(...)` (hourly):
```ts
crons.interval("settle due agent service tabs", { hours: 1 }, internal.crons.settleDueTabs, {});
```

### Step 3: test the internalQuery filter
`convex/crons.test.ts` (create) — seed two accounts (one above, one below threshold) via `internal.agentAccount.create` + a `t.run` patch of `unsettledTabUsdc`, assert `getAgentAccountsDue` returns only the above-threshold one. Run `npx vitest run convex/crons.test.ts`.

### Step 4: typecheck + commit
`npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "settle-tab|crons" || echo "OK"` (ignore unrelated pre-existing errors). Commit (stage only the 3 files): `feat(economy): on-chain tab settlement route + keeper cron`.

---

## Task 2: Meter agent video renders (safe, guarded)

Record a `render` usage event when a minted agent completes a video render. Guarded so it NEVER breaks the render pipeline and is skipped for agents without an economic account (e.g. legacy/pre-account agents).

**Files:**
- Create: `lib/economy/meterAgentService.ts`
- Modify: `app/api/video/render-step/route.ts` (call it on the success path)

### Step 1: safe meter helper
`lib/economy/meterAgentService.ts`:
```ts
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/** Best-effort metering of a paid agent service. NEVER throws — a metering
 *  failure (no account, transient error) must not break the agent's work.
 *  Returns the recordUsage result, or { ok: true, skipped: true } when there's
 *  no economic account / metering couldn't run. Spec §6.1. */
export async function meterAgentService(mintAddress: string, service: string, qty = 1): Promise<{ ok: boolean; skipped?: boolean }> {
  if (!mintAddress) return { ok: true, skipped: true };
  try {
    const res = await convex.mutation(api.usage.recordUsage, { mintAddress, service, qty });
    return res;
  } catch {
    // No agentAccount (legacy/pre-mint) or transient error → skip, don't block work.
    return { ok: true, skipped: true };
  }
}
```

### Step 2: wire into render-step success
In `app/api/video/render-step/route.ts`, add `import { meterAgentService } from "@/lib/economy/meterAgentService";`. On the SUCCESS path — right after the `api.agentTasks.succeed` mutation that records `cost: 0.2` (~line 129) — add:
```ts
        // Meter the render against the agent's economic account (best-effort).
        await meterAgentService(job.mintAddress, "render", 1);
```
Do NOT change any other logic. (This records the tab; it does not gate the in-flight render. Pre-render gating across the autonomy executor is a documented follow-up.)

### Step 3: typecheck + commit
`npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "render-step|meterAgentService" || echo "OK"`. Commit (stage only the 2 files): `feat(economy): meter agent video renders (best-effort)`.

---

## Task 3: Mint UI pays in USDC

Switch `components/builder/NftMintCard.tsx` `handleMint` from sending 0.5 SOL to sending `MINT_FEE_USDC` (5) USDC to the treasury's USDC ATA, mirroring the working pattern in `components/influencer/share-purchase-dialog.tsx`.

**Files:**
- Modify: `components/builder/NftMintCard.tsx`

### Step 1: read both files
Read `components/builder/NftMintCard.tsx` (the `handleMint` SOL flow + constants) and `components/influencer/share-purchase-dialog.tsx` lines ~85–122 (the working client-side USDC transfer: `getAssociatedTokenAddress`, `createAssociatedTokenAccountInstruction` if treasury ATA missing, `createTransferInstruction`, sign+send).

### Step 2: replace the payment build
- Add imports: `import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferInstruction } from "@solana/spl-token";`
- Add constants near the existing `MINT_FEE`:
  ```ts
  const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT ?? "";
  const MINT_FEE_USDC = 5;
  ```
- Replace the `SystemProgram.transfer(...)` transaction build with a USDC transfer to `getAssociatedTokenAddress(USDC_MINT, treasuryPk)`, creating the treasury ATA if `connection.getAccountInfo(treasuryAta)` is null, and transferring `BigInt(Math.round(MINT_FEE_USDC * 1_000_000))` (USDC has 6 decimals) from the builder's ATA. Use `share-purchase-dialog.tsx` as the exact reference for the instruction shapes and the ATA-missing check.
- Keep the rest of `handleMint` (sign, send, confirm, capture `signature`, POST to `/api/nft/mint` with `txSignature: signature`) unchanged.
- Update the button label(s) from SOL to `{MINT_FEE_USDC} USDC`. Add a guard: if `!USDC_MINT`, show/return an error rather than minting.

### Step 3: typecheck + commit
`npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "NftMintCard" || echo "OK"`. Commit (stage only NftMintCard.tsx): `feat(economy): mint UI pays the fee in USDC`.

---

## Verification
- `npx vitest run convex/crons.test.ts` green; full economy suite still green.
- Typecheck clean for all touched files.

## Out of scope (documented follow-ups)
- Metering the other paid services (`image_gen`, `social_post`, `transcription`) — they lack `mintAddress`; thread the agent identity at the caller (autonomy executor) and gate there.
- Pre-render gating across the autonomy/run-task executor (this task records render usage but doesn't block an in-flight render).
- Rewiring `share-purchase-dialog.tsx` from the legacy `influencers.invest` mutation to the vault `/api/market/buy-shares` route, and building a redeem UI.
- On-chain settlement transfer + buy/redeem are devnet-manual (need env + funded wallets).
- All mainnet-gate items (spec §11).

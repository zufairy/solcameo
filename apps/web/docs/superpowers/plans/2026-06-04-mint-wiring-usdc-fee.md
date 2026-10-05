# Mint Wiring + USDC Mint Fee — Implementation Plan (sub-project 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the agent economy reachable end-to-end: every newly-minted agent gets an empty `agentAccount` at mint time, and the mint fee is paid in USDC (verified against the treasury).

**Architecture:** Genesis happens *inside* the existing `saveInfluencer` Convex mutation via a shared `ensureAgentAccount(ctx, mintAddress)` helper (idempotent), so it's atomic with the agent record and needs no new public surface. The mint route swaps its SOL-payment verification for a USDC verification reusing `verifyUsdcDeposit` against the treasury wallet.

**Tech Stack:** Convex, convex-test + Vitest, Next.js route, existing `verifyUsdcDeposit`.

**Spec:** `docs/superpowers/specs/2026-06-03-agent-economic-layer-design.md` §5.1.

**Depends on (committed):** spine + sub-project 2 — `convex/agentAccount.ts` (`create`), `lib/economy/constants.ts` (`INITIAL_SHARE_SUPPLY`, `SEED_SHARE_PRICE_USDC`), `lib/trader/verifyUsdcDeposit.ts`.

---

## Task 1: Create the agentAccount at mint (the unlock)

**Files:**
- Modify: `convex/agentAccount.ts` (extract `ensureAgentAccount` helper; refactor `create` to use it; export it)
- Modify: `convex/nftAgents.ts` (`saveInfluencer` calls `ensureAgentAccount`)
- Test: `convex/nftAgents.test.ts` (create) — assert an account exists after saveInfluencer

- [ ] **Step 1: Extract `ensureAgentAccount` in `convex/agentAccount.ts`**

Add a `MutationCtx` import and an exported helper, and refactor `create` to call it. Replace the existing `create` mutation with:
```ts
import { internalMutation, query, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { navPerShare } from "../lib/economy/nav";
import { SEED_SHARE_PRICE_USDC, INITIAL_SHARE_SUPPLY } from "../lib/economy/constants";

/** Idempotent genesis of an agent's empty economic account. Safe to call from any
 *  mutation (e.g. saveInfluencer at mint). No founder shares — the builder's 15%
 *  accrues from earnings later. Returns the account id. Spec §5.1. */
export async function ensureAgentAccount(ctx: MutationCtx, mintAddress: string) {
  const existing = await ctx.db
    .query("agentAccount")
    .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
    .unique();
  if (existing) return existing._id;
  const now = Date.now();
  return await ctx.db.insert("agentAccount", {
    mintAddress,
    sharesOutstanding: 0,
    escrowUsdc: 0,
    liquidUsdc: 0,
    unsettledTabUsdc: 0,
    status: "active",
    seedSharePrice: SEED_SHARE_PRICE_USDC,
    plannedSupply: INITIAL_SHARE_SUPPLY,
    updatedAt: now,
  });
}

/** Internal genesis entry point (kept for tests / manual seeding). */
export const create = internalMutation({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => ensureAgentAccount(ctx, mintAddress),
});
```
(Leave `get` and `getWithNav` exactly as they are.)

- [ ] **Step 2: Call it from `saveInfluencer` in `convex/nftAgents.ts`**

Add the import at the top of `convex/nftAgents.ts`:
```ts
import { ensureAgentAccount } from "./agentAccount";
```
In the `saveInfluencer` handler, call `ensureAgentAccount(ctx, args.mintAddress)` immediately before BOTH `return` statements:
- In the existing-record branch: after the `await ctx.db.patch(existing._id, {...});` line and before `return existing._id;`, add:
  ```ts
      await ensureAgentAccount(ctx, args.mintAddress);
  ```
- In the new-record branch, change `return await ctx.db.insert("influencers", {...});` so the id is captured, the account ensured, then returned:
  ```ts
    const influencerId = await ctx.db.insert("influencers", {
      // ...all existing fields unchanged...
    });
    await ensureAgentAccount(ctx, args.mintAddress);
    return influencerId;
  ```
  (Keep every existing field in the insert exactly as-is; only wrap the return.)

- [ ] **Step 3: Write the test**

Create `convex/nftAgents.test.ts`:
```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINT = "MintSP5111111111111111111111111111111111";

const baseArgs = {
  mintAddress: MINT,
  creatorWallet: "Creator1111111111111111111111111111111111",
  name: "Test Agent",
  handle: "@test",
  avatarUrl: "https://example.com/a.png",
  niche: "tech",
  language: "en",
  archetype: "builder",
  description: "d",
  agentType: "influencer",
};

describe("saveInfluencer creates the economic account", () => {
  it("an agentAccount exists (empty pool) after minting an agent", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.nftAgents.saveInfluencer, baseArgs);

    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct).not.toBeNull();
    expect(acct!.sharesOutstanding).toBe(0);
    expect(acct!.escrowUsdc).toBe(0);
    expect(acct!.plannedSupply).toBe(1_000_000);
    expect(acct!.status).toBe("active");
  });

  it("is idempotent — re-saving the same agent does not create a second account", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.nftAgents.saveInfluencer, baseArgs);
    await t.mutation(api.nftAgents.saveInfluencer, { ...baseArgs, name: "Renamed" });
    const all = await t.run(async (ctx) =>
      ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(all).toHaveLength(1);
  });
});
```
NOTE: if `saveInfluencer` rejects `baseArgs` for a missing required field, read its `args` validator and add the missing field(s) to `baseArgs` with valid values — do not change the mutation.

- [ ] **Step 4: Run tests**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx vitest run convex/nftAgents.test.ts convex/agentAccount.test.ts`
Expected: PASS (the existing agentAccount tests must still pass after the refactor).

- [ ] **Step 5: Commit (stage ONLY these files; never `git add -A`)**

```bash
git add convex/agentAccount.ts convex/nftAgents.ts convex/nftAgents.test.ts
git commit -m "feat(economy): create empty agentAccount at mint (genesis in saveInfluencer)"
```

---

## Task 2: USDC mint fee

Swap the mint route's SOL-payment verification for a USDC verification against the treasury. **Frontend coordination required:** the mint UI must now send `MINT_FEE_USDC` USDC (not SOL) to the treasury and pass that tx signature — flag this in the commit body.

**Files:**
- Modify: `app/api/nft/mint/route.ts`

- [ ] **Step 1: Read the current payment block**

Read `app/api/nft/mint/route.ts` lines ~10–17 (constants) and ~120–160 (the `if (TREASURY) { ... verify SOL ... }` block). Note the request field carrying the payment signature (it's `txSignature`).

- [ ] **Step 2: Add constants + import**

Near the existing constants (top of file), add:
```ts
import { verifyUsdcDeposit } from "@/lib/trader/verifyUsdcDeposit";
const MINT_FEE_USDC = 5; // USDC paid to treasury to mint an agent
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT ?? "";
```
(Keep `MINT_FEE_SOL` defined or remove it once unused — remove it if nothing else references it; grep first.)

- [ ] **Step 3: Replace the SOL verification with USDC verification**

Replace the entire `if (TREASURY) { ... }` SOL-verification block (the one using `connection.getTransaction`, `treasuryKey`, `postBalances/preBalances`, and the `MINT_FEE_SOL` check) with:
```ts
    // Verify the builder's USDC mint-fee payment to the treasury (skip only in
    // local dev when TREASURY is unset). Frontend must send MINT_FEE_USDC USDC.
    if (TREASURY) {
      if (!USDC_MINT) {
        return NextResponse.json({ error: "NEXT_PUBLIC_USDC_MINT not configured" }, { status: 500 });
      }
      try {
        await verifyUsdcDeposit({
          txSignature,
          escrowOwner: TREASURY,
          usdcMint: USDC_MINT,
          minAmountUsdc: MINT_FEE_USDC,
        });
      } catch (e) {
        return NextResponse.json(
          { error: `mint fee not verified: ${(e as Error).message}` },
          { status: 400 },
        );
      }
    }
```
(Leave everything else in the route — keypair generation, `encryptWalletSecret`, `saveInfluencer` — unchanged. `saveInfluencer` now also creates the agentAccount via Task 1, so no extra call is needed here.)

- [ ] **Step 4: Typecheck**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "nft/mint" || echo "mint route OK"`
Expected: `mint route OK` (ignore unrelated pre-existing errors elsewhere). If `MINT_FEE_SOL` is now unused and the lint/build flags it, remove its declaration and the unused Solana imports (`Connection`, `LAMPORTS_PER_SOL`, `PublicKey`) ONLY if nothing else in the file uses them (grep to confirm).

- [ ] **Step 5: Commit (stage ONLY this file)**

```bash
git add app/api/nft/mint/route.ts
git commit -m "feat(economy): mint fee paid in USDC (verified vs treasury)

Frontend coordination required: the mint UI must now send MINT_FEE_USDC USDC
to the treasury (was 0.5 SOL) and pass that tx signature as txSignature.
Replay-guarding the mint-fee signature is a documented mainnet-gate follow-up."
```

---

## Verification

- [ ] **Economy + mint tests green**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx vitest run lib/economy convex/agentAccount.test.ts convex/economyReconcile.test.ts convex/shares.test.ts convex/nftAgents.test.ts convex/walletSecret.test.ts`
Expected: PASS.

## Spec coverage (self-review)

- §5.1 empty agentAccount created at mint → Task 1 ✅
- §5.1 mint fee in USDC → Task 2 ✅
- founder shares deferred to earnings (sub-project 4) — correctly NOT minted here ✅

**Out of scope / follow-ups:** frontend mint UI must switch SOL→USDC (flagged); replay-guard the mint-fee signature (mainnet-gate); the broader public-mutation hardening (spec §11).

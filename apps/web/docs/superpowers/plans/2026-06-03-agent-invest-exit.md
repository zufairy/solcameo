# Agent Invest & Exit — Implementation Plan (sub-project 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let investors buy shares of an agent at NAV (capped at 10% of a planned supply) and exit by redeeming shares for USDC (minus a 2% fee retained in escrow), on top of the spine.

**Architecture:** The authoritative accounting lives in Convex mutations (`buyShares`, `redeemShares`, `markRedeemPaid`) that are pure-DB and unit-tested. Real USDC moves on Solana (devnet) via the existing `lib/trader/usdcTransfer.ts` and a deposit-verification helper, wired through two API routes. Custody is Phase-1 operator-custodial: the escrow wallet's secret is read server-side via `getByMintInternal` + the `readAgentSecret` seam from sub-project 1. Replay protection reuses `consumeSignature` (`processedSignatures` table).

**Tech Stack:** TypeScript, Convex, `convex-test` + Vitest 2, Solana web3.js / SPL token (existing helpers), Next.js route handlers.

**Spec:** `docs/superpowers/specs/2026-06-03-agent-economic-layer-design.md` (§5.2 buy, §6.2 redeem, §4.3 invariants 3 & 4, §13 rounding).

**Depends on (committed, passing):** sub-project 1 spine — `lib/economy/nav.ts`, `lib/economy/constants.ts`, `agentAccount` tables, `convex/agentAccount.ts`, `lib/economy/walletSecretAccess.ts`.

---

## File structure

| File | Responsibility |
|---|---|
| `convex/schema.ts` (modify) | add `plannedSupply` to `agentAccount` |
| `convex/agentAccount.ts` (modify) | set `plannedSupply` at genesis |
| `convex/agentAccount.test.ts` (modify) | assert `plannedSupply` at genesis |
| `lib/economy/nav.ts` (modify) | replace `exceedsBuyCap` (vs live shares) with `exceedsWalletCap` (vs planned supply) |
| `lib/economy/nav.test.ts` (modify) | update cap test |
| `convex/shares.ts` (create) | `walletShares` query, `buyShares` / `redeemShares` / `markRedeemPaid` mutations |
| `convex/shares.test.ts` (create) | unit tests for all of the above |
| `lib/trader/verifyUsdcDeposit.ts` (create) | verify a devnet tx credited the escrow USDC account by ≥ amount |
| `app/api/market/buy-shares/route.ts` (create) | verify deposit → `buyShares` |
| `app/api/market/redeem-shares/route.ts` (create) | `redeemShares` → transfer USDC → `markRedeemPaid` |

---

## Task 1: plannedSupply field + wallet-cap math

**Files:**
- Modify: `convex/schema.ts` (the `agentAccount` table)
- Modify: `convex/agentAccount.ts` (the `create` mutation)
- Modify: `convex/agentAccount.test.ts`
- Modify: `lib/economy/nav.ts`, `lib/economy/nav.test.ts`

- [ ] **Step 1: Add `plannedSupply` to the schema**

In `convex/schema.ts`, in the `agentAccount` table, add this field right after `seedSharePrice: v.number(),`:
```ts
    plannedSupply: v.number(),       // fixed buy-cap denominator (default INITIAL_SHARE_SUPPLY)
```

- [ ] **Step 2: Set `plannedSupply` at genesis**

In `convex/agentAccount.ts`, add `INITIAL_SHARE_SUPPLY` to the constants import:
```ts
import { SEED_SHARE_PRICE_USDC, INITIAL_SHARE_SUPPLY } from "../lib/economy/constants";
```
and in the `create` mutation's `ctx.db.insert("agentAccount", {...})`, add right after `seedSharePrice: SEED_SHARE_PRICE_USDC,`:
```ts
      plannedSupply: INITIAL_SHARE_SUPPLY,
```

- [ ] **Step 3: Update the genesis test**

In `convex/agentAccount.test.ts`, in the first test ("creates an empty pool…"), add after the `status` assertion:
```ts
    expect(acct!.plannedSupply).toBe(1_000_000);
```

- [ ] **Step 4: Replace `exceedsBuyCap` with `exceedsWalletCap` in `lib/economy/nav.ts`**

Delete the existing `exceedsBuyCap` function and replace it with:
```ts
/** Spec invariant 3: a wallet may not hold more than BUY_CAP_PCT of the agent's
 *  PLANNED share supply (a fixed denominator, so the first buyer can take up to
 *  the cap rather than 100% of a tiny pool). */
export function exceedsWalletCap(a: { walletSharesAfter: number; plannedSupply: number; capPct?: number }): boolean {
  const cap = (a.capPct ?? BUY_CAP_PCT) * a.plannedSupply;
  const epsilon = 10 ** -SHARE_DECIMALS; // tolerate float noise; allows an exact-cap buy
  return a.walletSharesAfter > cap + epsilon;
}
```

- [ ] **Step 5: Update the cap test in `lib/economy/nav.test.ts`**

Replace the `describe("exceedsBuyCap", …)` block with:
```ts
describe("exceedsWalletCap", () => {
  it("caps a wallet at 10% of the planned supply (100k of 1M)", () => {
    expect(exceedsWalletCap({ walletSharesAfter: 100001, plannedSupply: 1_000_000 })).toBe(true);
    expect(exceedsWalletCap({ walletSharesAfter: 100000, plannedSupply: 1_000_000 })).toBe(false);
  });
  it("lets the first buyer into an empty pool take up to the cap", () => {
    // pool currently has 0 shares but plannedSupply is fixed at 1M → cap is 100k
    expect(exceedsWalletCap({ walletSharesAfter: 100000, plannedSupply: 1_000_000 })).toBe(false);
  });
});
```
Also update the import line at the top of the test file: change `exceedsBuyCap` to `exceedsWalletCap`.

- [ ] **Step 6: Run the affected tests**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx vitest run lib/economy/nav.test.ts convex/agentAccount.test.ts`
Expected: PASS (no reference to `exceedsBuyCap` remains — confirm with `grep -rn exceedsBuyCap lib convex` returning nothing).

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts convex/agentAccount.ts convex/agentAccount.test.ts lib/economy/nav.ts lib/economy/nav.test.ts
git commit -m "feat(economy): plannedSupply + 10%-of-planned-supply wallet cap"
```

---

## Task 2: `walletShares` query

**Files:**
- Create: `convex/shares.ts`
- Test: `convex/shares.test.ts`

- [ ] **Step 1: Write the failing test**

`convex/shares.test.ts`:
```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINT = "Mint1111111111111111111111111111111111111";
const A = "WalletAAA1111111111111111111111111111111";

describe("shares.walletShares", () => {
  it("sums a wallet's signed share rows for the mint (0 when none)", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.shares.walletShares, { mintAddress: MINT, wallet: A })).toBe(0);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("shareLedger", { mintAddress: MINT, wallet: A, kind: "buy", shares: 100, navPerShare: 1, usdcAmount: 100, at: now });
      await ctx.db.insert("shareLedger", { mintAddress: MINT, wallet: A, kind: "buy", shares: 50, navPerShare: 1, usdcAmount: 50, at: now });
      await ctx.db.insert("shareLedger", { mintAddress: MINT, wallet: A, kind: "redeem", shares: -30, navPerShare: 1, usdcAmount: 30, at: now });
      // a different wallet's row must not count
      await ctx.db.insert("shareLedger", { mintAddress: MINT, wallet: "Other", kind: "buy", shares: 999, navPerShare: 1, usdcAmount: 999, at: now });
    });

    expect(await t.query(api.shares.walletShares, { mintAddress: MINT, wallet: A })).toBe(120);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx vitest run convex/shares.test.ts`
Expected: FAIL — `api.shares` undefined.

- [ ] **Step 3: Implement `walletShares`**

Create `convex/shares.ts`:
```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { consumeSignature } from "./lib/payments";
import { navPerShare, sharesForDeposit, redeemPayout, exceedsWalletCap } from "../lib/economy/nav";

/** Net shares a wallet currently holds in an agent (sum of signed ledger rows). */
export const walletShares = query({
  args: { mintAddress: v.string(), wallet: v.string() },
  handler: async (ctx, { mintAddress, wallet }) => {
    const rows = await ctx.db
      .query("shareLedger")
      .withIndex("by_wallet", (q) => q.eq("wallet", wallet))
      .collect();
    return rows
      .filter((r) => r.mintAddress === mintAddress)
      .reduce((s, r) => s + r.shares, 0);
  },
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run convex/shares.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/shares.ts convex/shares.test.ts
git commit -m "feat(economy): walletShares query (net holdings per wallet)"
```

---

## Task 3: `buyShares` mutation

**Files:**
- Modify: `convex/shares.ts`
- Modify: `convex/shares.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `convex/shares.test.ts`:
```ts
const ACCT_MINT = "Mint2222222222222222222222222222222222222";
const INV1 = "Inv1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const INV2 = "Inv2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

async function seedAccount(t: ReturnType<typeof convexTest>) {
  await t.mutation(internal.agentAccount.create, { mintAddress: ACCT_MINT });
}

describe("shares.buyShares", () => {
  it("first buyer into an empty pool mints at the seed price ($1) and owns those shares", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const res = await t.mutation(internal.shares.buyShares, {
      mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 10000, txSignature: "sig-buy-1",
    });
    expect(res.shares).toBe(10000);          // 10000 / $1.00
    expect(res.navPerShare).toBe(1);

    const acct = await t.query(api.agentAccount.getWithNav, { mintAddress: ACCT_MINT });
    expect(acct!.sharesOutstanding).toBe(10000);
    expect(acct!.escrowUsdc).toBe(10000);
    expect(acct!.liquidUsdc).toBe(10000);
    expect(await t.query(api.shares.walletShares, { mintAddress: ACCT_MINT, wallet: INV1 })).toBe(10000);
  });

  it("rejects a buy that would push a wallet over 10% of planned supply (100k)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await expect(
      t.mutation(internal.shares.buyShares, {
        mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 100001, txSignature: "sig-cap",
      }),
    ).rejects.toThrow(/cap/i);
  });

  it("rejects a replayed deposit signature", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await t.mutation(internal.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 100, txSignature: "dup" });
    await expect(
      t.mutation(internal.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV2, depositUsdc: 100, txSignature: "dup" }),
    ).rejects.toThrow();
  });

  it("a second investor buys at the current NAV after earnings lifted it", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await t.mutation(internal.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 10000, txSignature: "s1" });
    // simulate earnings: escrow doubles to 20000 with shares still 10000 → NAV 2.0
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", ACCT_MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 20000, liquidUsdc: 20000 });
    });
    const res = await t.mutation(internal.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV2, depositUsdc: 10000, txSignature: "s2" });
    expect(res.navPerShare).toBe(2);
    expect(res.shares).toBe(5000); // 10000 / 2.0
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run convex/shares.test.ts`
Expected: FAIL — `internal.shares.buyShares` undefined.

- [ ] **Step 3: Implement `buyShares`**

Append to `convex/shares.ts`:
```ts
/** Record an investor's USDC deposit and mint shares at the current NAV.
 *  Replay-guarded by the on-chain deposit signature. Enforces the 10%-of-
 *  planned-supply wallet cap. The actual USDC must already be in escrow (the
 *  route verifies the deposit tx before calling this). Spec §5.2. */
export const buyShares = mutation({
  args: {
    mintAddress: v.string(),
    investorWallet: v.string(),
    depositUsdc: v.number(),
    txSignature: v.string(),
  },
  handler: async (ctx, { mintAddress, investorWallet, depositUsdc, txSignature }) => {
    if (depositUsdc <= 0) throw new Error("depositUsdc must be positive");

    // Single-use proof: one on-chain deposit funds exactly one buy.
    await consumeSignature(ctx, { txSignature, purpose: "invest", ref: mintAddress, amount: depositUsdc });

    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!account) throw new Error("no agentAccount for mint");
    if (account.status === "suspended") throw new Error("agent is suspended");

    const nav = navPerShare(account);
    const shares = sharesForDeposit({ depositUsdc, nav }); // throws if nav <= 0

    const current = (await ctx.db
      .query("shareLedger")
      .withIndex("by_wallet", (q) => q.eq("wallet", investorWallet))
      .collect())
      .filter((r) => r.mintAddress === mintAddress)
      .reduce((s, r) => s + r.shares, 0);

    if (exceedsWalletCap({ walletSharesAfter: current + shares, plannedSupply: account.plannedSupply })) {
      throw new Error("buy exceeds the 10%-of-planned-supply wallet cap");
    }

    const now = Date.now();
    await ctx.db.patch(account._id, {
      sharesOutstanding: account.sharesOutstanding + shares,
      escrowUsdc: account.escrowUsdc + depositUsdc,
      liquidUsdc: account.liquidUsdc + depositUsdc,
      updatedAt: now,
    });
    await ctx.db.insert("shareLedger", {
      mintAddress, wallet: investorWallet, kind: "buy",
      shares, navPerShare: nav, usdcAmount: depositUsdc, txSignature, at: now,
    });
    return { shares, navPerShare: nav };
  },
});
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run convex/shares.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/shares.ts convex/shares.test.ts
git commit -m "feat(economy): buyShares — mint at NAV, 10% cap, replay-guarded"
```

---

## Task 4: `redeemShares` + `markRedeemPaid` mutations

**Files:**
- Modify: `convex/shares.ts`
- Modify: `convex/shares.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `convex/shares.test.ts`:
```ts
describe("shares.redeemShares", () => {
  async function seedWithBuyer(t: ReturnType<typeof convexTest>) {
    await t.mutation(internal.agentAccount.create, { mintAddress: ACCT_MINT });
    await t.mutation(internal.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 10000, txSignature: "rb1" });
  }

  it("pays shares × NAV minus the 2% fee, and the fee stays in escrow (lifts NAV for stayers)", async () => {
    const t = convexTest(schema, modules);
    await seedWithBuyer(t); // 10000 shares, escrow 10000, NAV 1.0
    // a second investor so the pool isn't fully drained on redeem
    await t.mutation(internal.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV2, depositUsdc: 10000, txSignature: "rb2" });
    // now 20000 shares, escrow 20000, NAV 1.0

    const res = await t.mutation(internal.shares.redeemShares, {
      mintAddress: ACCT_MINT, holderWallet: INV1, sharesToBurn: 10000,
    });
    expect(res.payout).toBe(9800);     // 10000 × 1.0 × 0.98
    expect(res.exitFee).toBeCloseTo(200, 6);

    const acct = await t.query(api.agentAccount.getWithNav, { mintAddress: ACCT_MINT });
    expect(acct!.sharesOutstanding).toBe(10000);          // INV2's shares remain
    expect(acct!.escrowUsdc).toBe(10200);                 // 20000 − 9800 payout (200 fee retained)
    // NAV ticked up for the remaining holder: 10200 / 10000 = 1.02
    expect(acct!.navPerShare).toBeCloseTo(1.02, 6);
    expect(await t.query(api.shares.walletShares, { mintAddress: ACCT_MINT, wallet: INV1 })).toBe(0);
  });

  it("rejects redeeming more shares than the wallet holds", async () => {
    const t = convexTest(schema, modules);
    await seedWithBuyer(t);
    await expect(
      t.mutation(internal.shares.redeemShares, { mintAddress: ACCT_MINT, holderWallet: INV1, sharesToBurn: 10001 }),
    ).rejects.toThrow(/shares/i);
  });

  it("rejects when liquid USDC can't cover the payout", async () => {
    const t = convexTest(schema, modules);
    await seedWithBuyer(t); // escrow 10000, liquid 10000
    await t.run(async (ctx) => { // simulate capital deployed: liquid drops to 100
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", ACCT_MINT)).unique();
      await ctx.db.patch(a!._id, { liquidUsdc: 100 });
    });
    await expect(
      t.mutation(internal.shares.redeemShares, { mintAddress: ACCT_MINT, holderWallet: INV1, sharesToBurn: 10000 }),
    ).rejects.toThrow(/liquid/i);
  });

  it("rejects when the redemption would pull escrow below the unsettled tab", async () => {
    const t = convexTest(schema, modules);
    await seedWithBuyer(t); // escrow 10000
    await t.run(async (ctx) => { // a big unsettled service tab
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", ACCT_MINT)).unique();
      await ctx.db.patch(a!._id, { unsettledTabUsdc: 9000 });
    });
    // redeeming all 10000 shares would pay ~9800 → escrow 200 < 9000 tab → reject
    await expect(
      t.mutation(internal.shares.redeemShares, { mintAddress: ACCT_MINT, holderWallet: INV1, sharesToBurn: 10000 }),
    ).rejects.toThrow(/tab/i);
  });
});

describe("shares.markRedeemPaid", () => {
  it("stamps the txSignature on the pending redeem row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: ACCT_MINT });
    await t.mutation(internal.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 10000, txSignature: "mb1" });
    await t.mutation(internal.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV2, depositUsdc: 10000, txSignature: "mb2" });
    const r = await t.mutation(internal.shares.redeemShares, { mintAddress: ACCT_MINT, holderWallet: INV1, sharesToBurn: 1000 });
    await t.mutation(internal.shares.markRedeemPaid, { redeemRowId: r.redeemRowId, txSignature: "payout-sig" });
    const row = await t.run(async (ctx) => ctx.db.get(r.redeemRowId));
    expect(row!.txSignature).toBe("payout-sig");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run convex/shares.test.ts`
Expected: FAIL — `internal.shares.redeemShares` / `markRedeemPaid` undefined.

- [ ] **Step 3: Implement `redeemShares` + `markRedeemPaid`**

Append to `convex/shares.ts` (add `Id` to the server import if you reference the type; the row id is returned as-is so no extra import is needed):
```ts
/** Burn a holder's shares and record a (pending) USDC payout at NAV, minus a 2%
 *  exit fee that STAYS in escrow (lifts NAV for remaining holders). Does NOT move
 *  funds — the route transfers the returned payout then calls markRedeemPaid.
 *  Guards: holder owns the shares; escrow stays ≥ the unsettled tab (invariant 4);
 *  liquid USDC covers the payout. Spec §6.2. */
export const redeemShares = mutation({
  args: { mintAddress: v.string(), holderWallet: v.string(), sharesToBurn: v.number() },
  handler: async (ctx, { mintAddress, holderWallet, sharesToBurn }) => {
    if (sharesToBurn <= 0) throw new Error("sharesToBurn must be positive");

    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!account) throw new Error("no agentAccount for mint");

    const held = (await ctx.db
      .query("shareLedger")
      .withIndex("by_wallet", (q) => q.eq("wallet", holderWallet))
      .collect())
      .filter((r) => r.mintAddress === mintAddress)
      .reduce((s, r) => s + r.shares, 0);
    if (sharesToBurn > held) throw new Error(`insufficient shares: holds ${held}, asked ${sharesToBurn}`);

    const nav = navPerShare(account);
    const { exitFee, payout } = redeemPayout({ sharesToBurn, nav });

    if (account.escrowUsdc - payout < account.unsettledTabUsdc) {
      throw new Error("redemption would pull escrow below the unsettled service tab");
    }
    if (account.liquidUsdc < payout) {
      throw new Error(`insufficient liquid USDC: ${account.liquidUsdc} < payout ${payout} (capital deployed)`);
    }

    const now = Date.now();
    await ctx.db.patch(account._id, {
      sharesOutstanding: account.sharesOutstanding - sharesToBurn,
      escrowUsdc: account.escrowUsdc - payout,   // fee retained → NAV ↑ for stayers
      liquidUsdc: account.liquidUsdc - payout,
      updatedAt: now,
    });
    const redeemRowId = await ctx.db.insert("shareLedger", {
      mintAddress, wallet: holderWallet, kind: "redeem",
      shares: -sharesToBurn, navPerShare: nav, usdcAmount: payout, exitFeeUsdc: exitFee,
      at: now, // txSignature left unset → "pending payout" until markRedeemPaid
    });
    return { redeemRowId, payout, exitFee, navPerShare: nav, sharesBurned: sharesToBurn };
  },
});

/** Stamp the on-chain payout signature onto a redeem row once the transfer lands. */
export const markRedeemPaid = mutation({
  args: { redeemRowId: v.id("shareLedger"), txSignature: v.string() },
  handler: async (ctx, { redeemRowId, txSignature }) => {
    await ctx.db.patch(redeemRowId, { txSignature });
  },
});
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run convex/shares.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole economy suite**

Run: `npx vitest run lib/economy convex/agentAccount.test.ts convex/economyReconcile.test.ts convex/shares.test.ts convex/walletSecret.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex/shares.ts convex/shares.test.ts
git commit -m "feat(economy): redeemShares (2% fee retained, invariant-4 + liquidity guards) + markRedeemPaid"
```

---

## Task 5: Buy & redeem API routes (devnet integration)

This task wires the mutations to real devnet USDC. It cannot be unit-tested without devnet creds (RPC, a funded investor wallet, the escrow secret), so it is verified by **typecheck + a manual devnet checklist**. Keep the logic thin — push all accounting into the mutations from Tasks 3–4.

**Files:**
- Create: `lib/trader/verifyUsdcDeposit.ts`
- Create: `app/api/market/buy-shares/route.ts`
- Create: `app/api/market/redeem-shares/route.ts`

- [ ] **Step 1: Deposit verification helper**

`lib/trader/verifyUsdcDeposit.ts`:
```ts
import { getRpcConnection } from "./usdcTransfer";

/** Verify (on devnet/mainnet) that `txSignature` is a confirmed tx that increased
 *  the USDC token balance OWNED BY `escrowOwner` by at least `minAmountUsdc`.
 *  Returns the credited amount, or throws if not verifiable. */
export async function verifyUsdcDeposit(opts: {
  txSignature: string;
  escrowOwner: string;   // the agent escrow wallet pubkey (token account OWNER)
  usdcMint: string;
  minAmountUsdc: number;
}): Promise<{ creditedUsdc: number }> {
  const { txSignature, escrowOwner, usdcMint, minAmountUsdc } = opts;
  const conn = getRpcConnection();
  const tx = await conn.getParsedTransaction(txSignature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new Error("deposit tx not found / not confirmed");
  if (tx.meta?.err) throw new Error("deposit tx failed on-chain");

  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const match = (b: { owner?: string; mint?: string }) => b.owner === escrowOwner && b.mint === usdcMint;
  const preAmt = pre.filter(match).reduce((s, b) => s + (b.uiTokenAmount.uiAmount ?? 0), 0);
  const postAmt = post.filter(match).reduce((s, b) => s + (b.uiTokenAmount.uiAmount ?? 0), 0);
  const credited = postAmt - preAmt;
  if (credited < minAmountUsdc - 1e-6) {
    throw new Error(`escrow credited ${credited} USDC, expected ≥ ${minAmountUsdc}`);
  }
  return { creditedUsdc: credited };
}
```

- [ ] **Step 2: Buy-shares route**

`app/api/market/buy-shares/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "@/convex/_generated/api";
import { requireAuth } from "@/lib/server/requireAuth";
import { verifyUsdcDeposit } from "@/lib/trader/verifyUsdcDeposit";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT!;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { mintAddress, investorWallet, depositUsdc, txSignature } = await req.json();
  if (!mintAddress || !investorWallet || !depositUsdc || !txSignature) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // Need the agent escrow wallet (the deposit destination owner). Internal query
  // returns the full influencer doc; we only read agentWallet here.
  const agent = await convex.query(internal.influencers.getByMintInternal, { mintAddress });
  if (!agent?.agentWallet) return NextResponse.json({ error: "agent has no escrow wallet" }, { status: 400 });

  try {
    await verifyUsdcDeposit({ txSignature, escrowOwner: agent.agentWallet, usdcMint: USDC_MINT, minAmountUsdc: depositUsdc });
  } catch (e) {
    return NextResponse.json({ error: `deposit not verified: ${(e as Error).message}` }, { status: 400 });
  }

  try {
    const res = await convex.mutation(api.shares.buyShares, { mintAddress, investorWallet, depositUsdc, txSignature });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
```

- [ ] **Step 3: Redeem-shares route**

`app/api/market/redeem-shares/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "@/convex/_generated/api";
import { requireAuth } from "@/lib/server/requireAuth";
import { transferUsdc } from "@/lib/trader/usdcTransfer";
import { readAgentSecret } from "@/lib/economy/walletSecretAccess";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { mintAddress, holderWallet, sharesToBurn } = await req.json();
  if (!mintAddress || !holderWallet || !sharesToBurn) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const agent = await convex.query(internal.influencers.getByMintInternal, { mintAddress });
  if (!agent?.agentWallet || !agent.agentWalletSecret) {
    return NextResponse.json({ error: "agent has no escrow wallet" }, { status: 400 });
  }

  // 1) Commit the burn first (records a PENDING payout). Safer failure mode:
  //    burned-but-unpaid is recoverable (retry transfer); paid-but-not-burned is a loss.
  let redeem;
  try {
    redeem = await convex.mutation(api.shares.redeemShares, { mintAddress, holderWallet, sharesToBurn });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // 2) Transfer the payout out of escrow (operator-signed; Phase-1 custodial).
  const transfer = await transferUsdc({
    fromSecretBase64: readAgentSecret(agent.agentWalletSecret),
    fromPubkey: agent.agentWallet,
    toPubkey: holderWallet,
    amountUsdc: redeem.payout,
  });
  if (!transfer.ok) {
    // Burn is recorded but unpaid; surface for retry. (Reconciliation will flag
    // the row with no txSignature + the escrow mirror drift.)
    return NextResponse.json(
      { error: `payout transfer failed (${transfer.step}: ${transfer.error}); redeem pending`, redeemRowId: redeem.redeemRowId },
      { status: 502 },
    );
  }

  // 3) Stamp the payout signature onto the redeem row.
  await convex.mutation(api.shares.markRedeemPaid, { redeemRowId: redeem.redeemRowId, txSignature: transfer.txSignature! });
  return NextResponse.json({ ok: true, payout: redeem.payout, exitFee: redeem.exitFee, txSignature: transfer.txSignature });
}
```

- [ ] **Step 4: Typecheck the touched files**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "market/buy-shares|market/redeem-shares|verifyUsdcDeposit" || echo "routes OK"`
Expected: `routes OK`. (If the only errors are pre-existing `agentWalletSecret`/`api` typing on lines you did not add, note them and proceed — they stem from the project's known Convex codegen issue, same as the trader routes.)

- [ ] **Step 5: Manual devnet verification (document results in the commit body or a comment)**

These require devnet env (`NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_USDC_MINT`, `SOLANA_RPC`, a funded investor wallet, a minted agent). Do NOT fabricate results — if the env isn't available, report this step as "deferred: devnet env not configured" rather than claiming success.
  1. Mint/seed an agent so it has an `agentAccount` and an `agentWallet`.
  2. From an investor wallet, send e.g. 50 devnet USDC to the agent escrow's USDC ATA; capture the tx signature.
  3. `POST /api/market/buy-shares` with `{mintAddress, investorWallet, depositUsdc: 50, txSignature}` → expect `{ok:true, shares:50, navPerShare:1}` (first buy).
  4. `GET` the account (via `agentAccount.getWithNav`) → escrow 50, shares 50.
  5. `POST /api/market/redeem-shares` with `{mintAddress, holderWallet: investorWallet, sharesToBurn: 50}` → expect a payout of `50 × NAV × 0.98` arriving in the investor wallet, and a `txSignature`.
  6. Re-check the account → shares 0, escrow holds the retained fee.

- [ ] **Step 6: Commit**

```bash
git add lib/trader/verifyUsdcDeposit.ts app/api/market/buy-shares/route.ts app/api/market/redeem-shares/route.ts
git commit -m "feat(economy): buy/redeem-shares API routes (devnet USDC integration)"
```

---

## Verification (whole sub-project)

- [ ] **All accounting tests green**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx vitest run lib/economy convex/agentAccount.test.ts convex/economyReconcile.test.ts convex/shares.test.ts convex/walletSecret.test.ts`
Expected: PASS.

- [ ] **No dangling references to the removed `exceedsBuyCap`**

Run: `grep -rn "exceedsBuyCap" lib convex || echo "clean"`
Expected: `clean`.

---

## Spec coverage check (self-review)

- §5.2 buy at NAV → Task 3 `buyShares` ✅
- §4.3 invariant 3 (10% of planned supply) → Task 1 `exceedsWalletCap` + Task 3 enforcement ✅
- §6.2 redeem at NAV, 2% fee retained → Task 4 `redeemShares` ✅
- §4.3 invariant 4 (escrow ≥ tab on redeem) → Task 4 guard ✅
- §6.2 liquidity rule (pay from liquid; reject if short) → Task 4 guard ✅ (partial-fill/queue explicitly deferred per spec §12 non-goals)
- replay protection → Tasks 3 (`consumeSignature`) ✅
- devnet USDC movement → Task 5 routes ✅ (manual-verified)

**Out of scope (later):** partial/queued redemptions when capital is deployed (spec §12 non-goal — Task 4 rejects instead); the keeper freeing trader capital (sub-project 3); founder-share minting on earnings (sub-project 4); fixing the pre-existing `getByMint`-strips-secret bug in the *trader* routes (these new routes already use `getByMintInternal`); frontend buy/redeem UI.
```

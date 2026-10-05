# Agent Economic Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authoritative off-chain accounting foundation (the "spine") for the Vello agent economy: pure NAV/share math, the four Convex tables, the agent-account primitives, an invariant reconciliation check, and encryption-at-rest for agent wallet secrets — all proven with vitest.

**Architecture:** Pure functions in `lib/economy/` hold all money math (NAV, share minting, redemption payout, buy-cap, spendable) so they're unit-testable with zero infrastructure. Convex tables mirror cash and own the share/usage/settlement ledgers. Convex functions (`convex/agentAccount.ts`, `convex/economyReconcile.ts`) wrap the math for account genesis, NAV reads, and drift checks. A separate task wires the existing `walletCrypto` envelope encryption into the agent-wallet write/read paths. The on-chain money-moves (deposit/redeem/settle on Solana) are later sub-projects; this spine is custody-agnostic and off-chain.

**Tech Stack:** TypeScript, Convex (`convex@^1.39.1`), `convex-test@^0.0.53`, Vitest 2, Node `crypto` (AES-256-GCM via existing `lib/server/walletCrypto.ts`).

**Spec:** `docs/superpowers/specs/2026-06-03-agent-economic-layer-design.md` (§4 spine, §13 rounding).

---

## File structure

| File | Responsibility |
|---|---|
| `lib/economy/constants.ts` (create) | Tunable economic constants (seed price, exit fee, buy cap, founder %, settle threshold, initial supply, share decimals) |
| `lib/economy/nav.ts` (create) | Pure money math: `navPerShare`, `spendableUsdc`, `canSpend`, `sharesForDeposit`, `redeemPayout`, `exceedsBuyCap`, `floorTo` |
| `lib/economy/nav.test.ts` (create) | Unit tests for the math |
| `convex/schema.ts` (modify) | Add `agentAccount`, `shareLedger`, `usageLedger`, `feeSettlements` tables |
| `convex/agentAccount.ts` (create) | `create` (genesis + founder row), `get`, `getWithNav` |
| `convex/agentAccount.test.ts` (create) | Convex tests for account genesis + NAV read |
| `convex/economyReconcile.ts` (create) | `checkAccount` — recompute invariants from ledgers, report drift |
| `convex/economyReconcile.test.ts` (create) | Convex tests for reconciliation |
| `app/api/nft/mint/route.ts` (modify) | Encrypt `agentWalletSecret` before persisting |
| `app/api/nft/backfill-wallets/route.ts` (modify) | Encrypt before `setAgentWallet` |
| `app/api/trader/place-binary/route.ts`, `approve-trade/route.ts`, `run-tick/route.ts`, `auto-pilot/route.ts` (modify) | Decrypt `agentWalletSecret` before signing |
| `lib/economy/walletSecretAccess.ts` (create) | Tiny helper `readAgentSecret(stored)` = `decryptWalletSecret(stored)` — single seam for reads |
| `lib/economy/walletSecretAccess.test.ts` (create) | Round-trip + legacy passthrough test |

---

## Task 1: Economic constants + NAV math (pure)

**Files:**
- Create: `lib/economy/constants.ts`
- Create: `lib/economy/nav.ts`
- Test: `lib/economy/nav.test.ts`

- [ ] **Step 1: Create the constants module**

`lib/economy/constants.ts`:
```ts
/** Tunable economic constants for the agent economy. Spec §2, §13. */
export const SEED_SHARE_PRICE_USDC = 1.0; // NAV when an agent has 0 shares
export const EXIT_FEE_PCT = 0.02;         // 2% redemption fee, retained in escrow
export const BUY_CAP_PCT = 0.10;          // max 10% of shares per wallet
export const FOUNDER_PCT = 0.15;          // builder's founder allocation at mint
export const SETTLE_THRESHOLD_USDC = 5;   // batch-settle the service tab at/above this
export const INITIAL_SHARE_SUPPLY = 1_000_000; // share units created at mint
export const SHARE_DECIMALS = 6;          // share quantities rounded to this precision
export const USDC_DECIMALS = 6;           // USDC amounts rounded to this precision
```

- [ ] **Step 2: Write the failing tests**

`lib/economy/nav.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  floorTo, navPerShare, spendableUsdc, canSpend,
  sharesForDeposit, redeemPayout, exceedsBuyCap,
} from "./nav";
import { SEED_SHARE_PRICE_USDC } from "./constants";

describe("floorTo", () => {
  it("floors to the given decimals", () => {
    expect(floorTo(1.2345678, 6)).toBe(1.234567);
    expect(floorTo(10, 6)).toBe(10);
  });
});

describe("navPerShare", () => {
  it("uses seed price when no shares exist", () => {
    expect(navPerShare({ escrowUsdc: 0, unsettledTabUsdc: 0, sharesOutstanding: 0 }))
      .toBe(SEED_SHARE_PRICE_USDC);
  });
  it("is (escrow - tab) / shares", () => {
    expect(navPerShare({ escrowUsdc: 150000, unsettledTabUsdc: 0, sharesOutstanding: 1_000_000 }))
      .toBeCloseTo(0.15, 9);
  });
  it("nets out the unsettled tab", () => {
    expect(navPerShare({ escrowUsdc: 150000, unsettledTabUsdc: 30000, sharesOutstanding: 1_000_000 }))
      .toBeCloseTo(0.12, 9);
  });
  it("never goes negative", () => {
    expect(navPerShare({ escrowUsdc: 10, unsettledTabUsdc: 50, sharesOutstanding: 100 })).toBe(0);
  });
});

describe("spendableUsdc / canSpend", () => {
  it("spendable is escrow minus tab, floored at 0", () => {
    expect(spendableUsdc({ escrowUsdc: 100, unsettledTabUsdc: 30 })).toBe(70);
    expect(spendableUsdc({ escrowUsdc: 10, unsettledTabUsdc: 30 })).toBe(0);
  });
  it("canSpend gates on spendable >= price", () => {
    expect(canSpend({ escrowUsdc: 100, unsettledTabUsdc: 30 }, 70)).toBe(true);
    expect(canSpend({ escrowUsdc: 100, unsettledTabUsdc: 30 }, 70.01)).toBe(false);
  });
});

describe("sharesForDeposit", () => {
  it("mints deposit / nav, rounded DOWN (favors the pool)", () => {
    expect(sharesForDeposit({ depositUsdc: 10000, nav: 0.1 })).toBe(100000);
    // 100 / 3 = 33.333... → floored to 6dp
    expect(sharesForDeposit({ depositUsdc: 100, nav: 3 })).toBe(33.333333);
  });
});

describe("redeemPayout", () => {
  it("applies the exit fee and rounds payout DOWN", () => {
    const r = redeemPayout({ sharesToBurn: 100000, nav: 0.15 });
    expect(r.gross).toBeCloseTo(15000, 6);
    expect(r.exitFee).toBeCloseTo(300, 6);
    expect(r.payout).toBe(14700);
  });
});

describe("exceedsBuyCap", () => {
  it("true when a wallet would exceed 10% of shares", () => {
    expect(exceedsBuyCap({ walletSharesAfter: 100001, sharesOutstandingAfter: 1_000_000 })).toBe(true);
    expect(exceedsBuyCap({ walletSharesAfter: 100000, sharesOutstandingAfter: 1_000_000 })).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx vitest run lib/economy/nav.test.ts`
Expected: FAIL — `Cannot find module './nav'`.

- [ ] **Step 4: Implement the math**

`lib/economy/nav.ts`:
```ts
import { SEED_SHARE_PRICE_USDC, EXIT_FEE_PCT, BUY_CAP_PCT, SHARE_DECIMALS, USDC_DECIMALS } from "./constants";

/** Floor a number to `decimals` places (avoids float dust accumulating in our favor). */
export function floorTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.floor(value * f) / f;
}

/** NAV per share = (escrow − unsettled tab) / shares, never negative.
 *  Seed price when there are no shares yet. Spec invariant 1. */
export function navPerShare(a: { escrowUsdc: number; unsettledTabUsdc: number; sharesOutstanding: number }): number {
  if (a.sharesOutstanding <= 0) return SEED_SHARE_PRICE_USDC;
  return Math.max(0, a.escrowUsdc - a.unsettledTabUsdc) / a.sharesOutstanding;
}

/** USDC available to spend on services = escrow − tab, floored at 0. */
export function spendableUsdc(a: { escrowUsdc: number; unsettledTabUsdc: number }): number {
  return Math.max(0, a.escrowUsdc - a.unsettledTabUsdc);
}

/** Spec invariant 2: a paid service may run only if spendable ≥ price. */
export function canSpend(a: { escrowUsdc: number; unsettledTabUsdc: number }, priceUsdc: number): boolean {
  return spendableUsdc(a) >= priceUsdc;
}

/** Shares minted for a deposit at the given NAV, rounded DOWN. Spec §13. */
export function sharesForDeposit(a: { depositUsdc: number; nav: number }): number {
  if (a.nav <= 0) return 0;
  return floorTo(a.depositUsdc / a.nav, SHARE_DECIMALS);
}

/** Gross/fee/payout for redeeming shares at NAV. Fee stays in escrow; payout rounded DOWN. */
export function redeemPayout(a: { sharesToBurn: number; nav: number; exitFeePct?: number }): {
  gross: number; exitFee: number; payout: number;
} {
  const pct = a.exitFeePct ?? EXIT_FEE_PCT;
  const gross = a.sharesToBurn * a.nav;
  const exitFee = gross * pct;
  const payout = floorTo(gross - exitFee, USDC_DECIMALS);
  return { gross, exitFee, payout };
}

/** Spec invariant 3: a wallet may not hold more than BUY_CAP_PCT of total shares. */
export function exceedsBuyCap(a: { walletSharesAfter: number; sharesOutstandingAfter: number; capPct?: number }): boolean {
  const cap = (a.capPct ?? BUY_CAP_PCT) * a.sharesOutstandingAfter;
  // small epsilon so exact-cap buys (e.g. exactly 10%) are allowed despite float noise
  return a.walletSharesAfter > cap + 1e-6;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/economy/nav.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
cd /Users/along/Documents/GitHub/jobtepi/apps/vello
git add lib/economy/constants.ts lib/economy/nav.ts lib/economy/nav.test.ts
git commit -m "feat(economy): pure NAV/share math + constants for agent economic spine"
```

---

## Task 2: Add the economic-account tables to the Convex schema

**Files:**
- Modify: `convex/schema.ts` (add four tables next to `investments`/`distributions`, ~line 388–413)

- [ ] **Step 1: Add the table definitions**

In `convex/schema.ts`, immediately AFTER the closing of the `distributions` table definition (the line with `.index("by_submission", ["submissionId"]),`), add:

```ts
  // ─── Agent economic account (spine) ─────────────────────────────────────────
  // One authoritative money account per agent. `escrowUsdc`/`liquidUsdc` mirror
  // on-chain cash; the ledgers below own shares + what's owed. Spec §4.2.
  agentAccount: defineTable({
    mintAddress: v.string(),
    sharesOutstanding: v.number(),
    escrowUsdc: v.number(),
    liquidUsdc: v.number(),          // escrow not deployed in open positions
    unsettledTabUsdc: v.number(),    // accrued, not-yet-settled service fees
    status: v.union(v.literal("active"), v.literal("needs_funding"), v.literal("suspended")),
    seedSharePrice: v.number(),
    updatedAt: v.number(),
  }).index("by_mint", ["mintAddress"]),

  // Every share buy / redeem / founder grant. Authoritative share ownership.
  shareLedger: defineTable({
    mintAddress: v.string(),
    wallet: v.string(),
    kind: v.union(v.literal("buy"), v.literal("redeem"), v.literal("founder")),
    shares: v.number(),              // signed: + on buy/founder, − on redeem
    navPerShare: v.number(),
    usdcAmount: v.number(),          // deposit (buy) or payout (redeem)
    exitFeeUsdc: v.optional(v.number()),
    txSignature: v.optional(v.string()),
    at: v.number(),
  }).index("by_mint", ["mintAddress"]).index("by_wallet", ["wallet"]),

  // Every priced service the agent consumed (the metered tab line items).
  usageLedger: defineTable({
    mintAddress: v.string(),
    service: v.string(),
    qty: v.number(),
    unitPriceUsdc: v.number(),
    costUsdc: v.number(),
    settledBatchId: v.optional(v.string()), // set once swept by a fee settlement
    at: v.number(),
  }).index("by_mint", ["mintAddress"]),

  // Each batched keeper sweep of the tab from escrow → treasury.
  feeSettlements: defineTable({
    mintAddress: v.string(),
    amountUsdc: v.number(),
    coversUsageIds: v.array(v.string()),
    txSignature: v.optional(v.string()),
    at: v.number(),
  }).index("by_mint", ["mintAddress"]),
```

- [ ] **Step 2: Verify the schema compiles**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "convex/schema.ts" || echo "schema OK"`
Expected: `schema OK` (no errors referencing `convex/schema.ts`).

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(economy): add agentAccount/shareLedger/usageLedger/feeSettlements tables"
```

---

## Task 3: Agent account genesis + NAV read

**Files:**
- Create: `convex/agentAccount.ts`
- Test: `convex/agentAccount.test.ts`

- [ ] **Step 1: Write the failing tests**

`convex/agentAccount.test.ts`:
```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { SEED_SHARE_PRICE_USDC, INITIAL_SHARE_SUPPLY, FOUNDER_PCT } from "../lib/economy/constants";

const modules = import.meta.glob("./**/*.ts");
const MINT = "Mint1111111111111111111111111111111111111";
const BUILDER = "Builder111111111111111111111111111111111";

describe("agentAccount.create", () => {
  it("creates an account with founder shares and a founder ledger row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT, founderWallet: BUILDER });

    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct).not.toBeNull();
    expect(acct!.sharesOutstanding).toBe(INITIAL_SHARE_SUPPLY * FOUNDER_PCT);
    expect(acct!.escrowUsdc).toBe(0);
    expect(acct!.status).toBe("active");

    const rows = await t.run(async (ctx) =>
      ctx.db.query("shareLedger").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("founder");
    expect(rows[0].wallet).toBe(BUILDER);
  });

  it("is idempotent — calling create twice does not duplicate", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT, founderWallet: BUILDER });
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT, founderWallet: BUILDER });
    const all = await t.run(async (ctx) =>
      ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(all).toHaveLength(1);
  });
});

describe("agentAccount.getWithNav", () => {
  it("returns seed price NAV at genesis", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT, founderWallet: BUILDER });
    const res = await t.query(api.agentAccount.getWithNav, { mintAddress: MINT });
    expect(res!.navPerShare).toBe(SEED_SHARE_PRICE_USDC);
  });

  it("reflects escrow growth in NAV", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT, founderWallet: BUILDER });
    // simulate earnings landing in escrow
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 30000 });
    });
    const res = await t.query(api.agentAccount.getWithNav, { mintAddress: MINT });
    // 30000 / (1_000_000 * 0.15) = 0.2
    expect(res!.navPerShare).toBeCloseTo(0.2, 9);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx vitest run convex/agentAccount.test.ts`
Expected: FAIL — `internal.agentAccount` is undefined / module not found.

- [ ] **Step 3: Implement the account functions**

`convex/agentAccount.ts`:
```ts
import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { navPerShare } from "../lib/economy/nav";
import { SEED_SHARE_PRICE_USDC, INITIAL_SHARE_SUPPLY, FOUNDER_PCT } from "../lib/economy/constants";

/** Genesis for an agent's economic account: founder allocation + founder ledger
 *  row. Idempotent (no-op if the account already exists). Spec §5.1. */
export const create = internalMutation({
  args: { mintAddress: v.string(), founderWallet: v.string() },
  handler: async (ctx, { mintAddress, founderWallet }) => {
    const existing = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (existing) return existing._id;

    const founderShares = INITIAL_SHARE_SUPPLY * FOUNDER_PCT;
    const now = Date.now();
    const id = await ctx.db.insert("agentAccount", {
      mintAddress,
      sharesOutstanding: founderShares,
      escrowUsdc: 0,
      liquidUsdc: 0,
      unsettledTabUsdc: 0,
      status: "active",
      seedSharePrice: SEED_SHARE_PRICE_USDC,
      updatedAt: now,
    });
    await ctx.db.insert("shareLedger", {
      mintAddress,
      wallet: founderWallet,
      kind: "founder",
      shares: founderShares,
      navPerShare: SEED_SHARE_PRICE_USDC,
      usdcAmount: 0,
      at: now,
    });
    return id;
  },
});

/** Raw account doc (or null). */
export const get = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) =>
    ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique(),
});

/** Account doc plus derived NAV per share. */
export const getWithNav = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const a = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!a) return null;
    return { ...a, navPerShare: navPerShare(a) };
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run convex/agentAccount.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/agentAccount.ts convex/agentAccount.test.ts
git commit -m "feat(economy): agent account genesis (founder shares) + NAV read"
```

---

## Task 4: Invariant reconciliation check

**Files:**
- Create: `convex/economyReconcile.ts`
- Test: `convex/economyReconcile.test.ts`

- [ ] **Step 1: Write the failing tests**

`convex/economyReconcile.test.ts`:
```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINT = "Mint1111111111111111111111111111111111111";
const BUILDER = "Builder111111111111111111111111111111111";

describe("economyReconcile.checkAccount", () => {
  it("ok=true at genesis (shares match founder ledger, tab is 0)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT, founderWallet: BUILDER });
    const res = await t.query(api.economyReconcile.checkAccount, { mintAddress: MINT });
    expect(res.ok).toBe(true);
    expect(res.issues).toHaveLength(0);
  });

  it("flags a shares mismatch between account and ledger", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT, founderWallet: BUILDER });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { sharesOutstanding: a!.sharesOutstanding + 5 }); // drift
    });
    const res = await t.query(api.economyReconcile.checkAccount, { mintAddress: MINT });
    expect(res.ok).toBe(false);
    expect(res.issues.join(" ")).toMatch(/shares/i);
  });

  it("flags a tab mismatch vs unsettled usage rows", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT, founderWallet: BUILDER });
    await t.run(async (ctx) => {
      await ctx.db.insert("usageLedger", {
        mintAddress: MINT, service: "render", qty: 1, unitPriceUsdc: 0.4, costUsdc: 0.4, at: Date.now(),
      });
      // account.unsettledTabUsdc left at 0 → mismatch with the 0.4 unsettled usage
    });
    const res = await t.query(api.economyReconcile.checkAccount, { mintAddress: MINT });
    expect(res.ok).toBe(false);
    expect(res.issues.join(" ")).toMatch(/tab/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx vitest run convex/economyReconcile.test.ts`
Expected: FAIL — `api.economyReconcile` undefined.

- [ ] **Step 3: Implement the reconciliation check**

`convex/economyReconcile.ts`:
```ts
import { query } from "./_generated/server";
import { v } from "convex/values";

const TOLERANCE = 1e-6; // float comparison slack

/** Recompute the spine invariants from the ledgers and report drift.
 *  Convex-internal consistency only (on-chain mirror reconciliation is Phase 2).
 *  Spec §4.3 invariants 1 & (the share/tab bookkeeping behind) 2. */
export const checkAccount = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const issues: string[] = [];

    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!account) return { ok: false, issues: ["no agentAccount for mint"] };

    const shareRows = await ctx.db
      .query("shareLedger")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    const ledgerShares = shareRows.reduce((s, r) => s + r.shares, 0);
    if (Math.abs(ledgerShares - account.sharesOutstanding) > TOLERANCE) {
      issues.push(
        `shares drift: account ${account.sharesOutstanding} vs ledger ${ledgerShares}`,
      );
    }

    const usageRows = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    const unsettled = usageRows
      .filter((u) => !u.settledBatchId)
      .reduce((s, u) => s + u.costUsdc, 0);
    if (Math.abs(unsettled - account.unsettledTabUsdc) > TOLERANCE) {
      issues.push(
        `tab drift: account ${account.unsettledTabUsdc} vs unsettled usage ${unsettled}`,
      );
    }

    if (account.escrowUsdc < -TOLERANCE) issues.push(`escrow negative: ${account.escrowUsdc}`);

    return { ok: issues.length === 0, issues };
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run convex/economyReconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/economyReconcile.ts convex/economyReconcile.test.ts
git commit -m "feat(economy): reconciliation check (shares/tab/escrow invariants)"
```

---

## Task 5: Encrypt agent wallet secrets at rest

The crypto already exists (`lib/server/walletCrypto.ts`); this task wires it into the write paths and routes all reads through one decrypt seam. `decryptWalletSecret` passes legacy plaintext through unchanged, so reads are safe before any backfill.

**Files:**
- Create: `lib/economy/walletSecretAccess.ts`
- Test: `lib/economy/walletSecretAccess.test.ts`
- Modify (write): `app/api/nft/mint/route.ts:237`, `app/api/nft/backfill-wallets/route.ts:37`
- Modify (read): `app/api/trader/place-binary/route.ts:118`, `app/api/trader/approve-trade/route.ts:118`, `app/api/trader/run-tick/route.ts:742`, `app/api/trader/auto-pilot/route.ts:237`

- [ ] **Step 1: Write the failing test for the read seam**

`lib/economy/walletSecretAccess.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { encryptWalletSecret } from "../server/walletCrypto";
import { readAgentSecret } from "./walletSecretAccess";

beforeAll(() => {
  // 32-byte key so encrypt/decrypt actually round-trips in this test
  process.env.WALLET_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
});

describe("readAgentSecret", () => {
  it("round-trips an encrypted secret back to the original base64", () => {
    const original = Buffer.from(crypto.randomBytes(64)).toString("base64");
    const stored = encryptWalletSecret(original);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(readAgentSecret(stored)).toBe(original);
  });

  it("passes legacy plaintext through unchanged", () => {
    const legacy = Buffer.from(crypto.randomBytes(64)).toString("base64");
    expect(readAgentSecret(legacy)).toBe(legacy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx vitest run lib/economy/walletSecretAccess.test.ts`
Expected: FAIL — `Cannot find module './walletSecretAccess'`.

- [ ] **Step 3: Implement the read seam**

`lib/economy/walletSecretAccess.ts`:
```ts
import { decryptWalletSecret } from "../server/walletCrypto";

/** Single seam for reading an agent's signing secret. Stored values may be
 *  encrypted (v1:) or legacy plaintext base64; this returns the raw base64
 *  64-byte secret either way. Use everywhere the agent key is loaded to sign. */
export function readAgentSecret(stored: string): string {
  return decryptWalletSecret(stored);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/economy/walletSecretAccess.test.ts`
Expected: PASS.

- [ ] **Step 5: Encrypt on the write paths**

In `app/api/nft/mint/route.ts`, add the import near the other `lib/server` imports:
```ts
import { encryptWalletSecret } from "@/lib/server/walletCrypto";
```
Then change the `saveInfluencer` argument (currently `agentWalletSecret,` at ~line 237) to:
```ts
      agentWalletSecret: encryptWalletSecret(agentWalletSecret),
```

In `app/api/nft/backfill-wallets/route.ts`, add the same import, then wrap the value passed to `setAgentWallet` (~line 37):
```ts
    await convex.mutation(api.influencers.setAgentWallet, {
      mintAddress, agentWallet, agentWalletSecret: encryptWalletSecret(agentWalletSecret),
    });
```

- [ ] **Step 6: Route all reads through the seam**

In each of these files, add:
```ts
import { readAgentSecret } from "@/lib/economy/walletSecretAccess";
```
and replace the place that passes the raw secret:

- `app/api/trader/place-binary/route.ts:118` — `fromSecretBase64: influencer.agentWalletSecret,` → `fromSecretBase64: readAgentSecret(influencer.agentWalletSecret),`
- `app/api/trader/approve-trade/route.ts:118` — `agentWalletSecret: influencer.agentWalletSecret,` → `agentWalletSecret: readAgentSecret(influencer.agentWalletSecret),`
- `app/api/trader/run-tick/route.ts:742` — `agentWalletSecret: influencer.agentWalletSecret,` → `agentWalletSecret: readAgentSecret(influencer.agentWalletSecret),`
- `app/api/trader/auto-pilot/route.ts:237` — `fromSecretBase64: influencer.agentWalletSecret,` → `fromSecretBase64: readAgentSecret(influencer.agentWalletSecret),`

- [ ] **Step 7: Verify types still compile for the touched files**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "nft/mint|backfill-wallets|place-binary|approve-trade|run-tick/route|auto-pilot|walletSecretAccess" || echo "touched files OK"`
Expected: `touched files OK` (no errors in the files this task changed). Pre-existing unrelated errors elsewhere are out of scope.

- [ ] **Step 8: Run the full economy + wallet test suite**

Run: `npx vitest run lib/economy convex/agentAccount.test.ts convex/economyReconcile.test.ts convex/walletSecret.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/economy/walletSecretAccess.ts lib/economy/walletSecretAccess.test.ts \
  app/api/nft/mint/route.ts app/api/nft/backfill-wallets/route.ts \
  app/api/trader/place-binary/route.ts app/api/trader/approve-trade/route.ts \
  app/api/trader/run-tick/route.ts app/api/trader/auto-pilot/route.ts
git commit -m "feat(economy): encrypt agent wallet secrets at rest + single decrypt seam"
```

---

## Verification (whole spine)

- [ ] **All spine tests green**

Run: `cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx vitest run lib/economy convex/agentAccount.test.ts convex/economyReconcile.test.ts`
Expected: PASS, no failures.

- [ ] **Schema + touched files typecheck clean** (pre-existing unrelated errors ignored)

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "lib/economy|convex/agentAccount|convex/economyReconcile|convex/schema" || echo "spine files OK"`
Expected: `spine files OK`.

---

## Spec coverage check (self-review)

- §4.1 encrypt-at-rest → Task 5 ✅ (PDA escrow is Phase 2, out of this sub-project)
- §4.2 four tables (`agentAccount`, `shareLedger`, `usageLedger`, `feeSettlements`) → Task 2 ✅
- §4.3 invariant 1 (NAV) → Task 1 `navPerShare` + Task 3 `getWithNav` ✅
- §4.3 invariant 2 (spendable gate) → Task 1 `canSpend`/`spendableUsdc` ✅ (enforced at call sites in sub-project 3)
- §4.3 invariant 3 (10% buy cap) → Task 1 `exceedsBuyCap` ✅ (enforced in sub-project 2)
- §4.3 invariant 4 (redeem can't breach tab) → math present (`spendableUsdc`); enforced in sub-project 2
- §4.3 invariant 5 (reconciliation) → Task 4 ✅
- §5.1 founder shares genesis → Task 3 `create` ✅
- §13 rounding down on buy/redeem → Task 1 `sharesForDeposit`/`redeemPayout` ✅

**Out of scope for the spine (later sub-projects, by design):** actual deposit/redeem mutations and the 10%/tab enforcement at call sites (sub-project 2), `meter()` + keeper settlement (sub-project 3), earnings-in migration (sub-project 4), USDC mint fee + wiring `agentAccount.create` into the mint route (sub-project 5), on-chain PDA escrow (Phase 2).
```

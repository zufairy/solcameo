# Post Campaign → Treasury Deposit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the Post Campaign flow as a per-campaign treasury deposit, make launch idempotent/resumable so it can never double-charge, add pre-flight balance review + a mainnet-gated Transak on-ramp, and remove the halal feature everywhere.

**Architecture:** The `/stage/create` wizard (`campaign-form.tsx`) already funds a per-campaign on-chain escrow PDA. We keep that rail but (a) reuse the existing draft campaign row + deterministic PDA on retry, (b) verify the vault's real USDC balance via `getEscrowBalance` before ever re-prompting the wallet, (c) gate the wallet prompt behind a USDC+SOL pre-flight check with a Transak fund-shortfall path, and (d) reframe the Step-3 copy. Halal (`isHalalOnly`/`isHalal`/`isHalalCompliant`) is deleted from UI + write paths + matcher; Convex schema fields become optional (non-destructive).

**Tech Stack:** Next.js (App Router, custom build — read `node_modules/next/dist/docs/` before writing Next code), React + react-hook-form + zod, Convex backend, Solana web3.js `^1.98.4`, `@solana/spl-token ^0.4.14`, `@coral-xyz/anchor ^0.32.1`, Privy wallets (`@privy-io/react-auth ^3.29.2`), Transak (`@transak/transak-sdk`, to be added), Vitest.

## Global Constraints

- **Convex:** read `apps/web/convex/_generated/ai/guidelines.md` before touching Convex code. Queries/mutations use `import { query, mutation, ... } from "./_generated/server"` and `v` from `convex/values`. Campaign draft-vs-funded state: **draft = `!pdaAddress`**; funded = `pdaAddress && (onchainVersion ?? 1) >= 2`. Do NOT hard-remove required schema fields with live data — make them `v.optional(...)`.
- **Network/mainnet gate:** mainnet ⇔ `getNetwork() === "mainnet-beta"` (from `lib/solana/network.ts`, driven by `NEXT_PUBLIC_SOLANA_NETWORK`). On-ramp is mainnet-only.
- **Wallet:** `useUnifiedSolanaWallet()` returns `{ publicKey, signTransaction, signMessage, connected, connecting }` — **no `connection`, no `signAllTransactions`**. Build a `Connection` via `getRpcUrl(getNetwork())`. Signing routes through Privy.
- **On-chain reliability primitive:** use `getEscrowBalance(connection, pdaAddress)` (raw SPL balance — works without IDL regen). Do NOT depend on the typed `getCampaignAccount` reader for the reliability path.
- **Money math:** USDC has 6 decimals. Budget min 1 USDC; rate min 0.5. Deadline min 6h (program `MIN_CAMPAIGN_DURATION_SECS`).
- **Commits:** conventional-commit messages; **never** add a `Co-Authored-By: Claude` trailer.
- **Scope of green:** `tsc`/`eslint`/`vitest` must be clean **for touched files**; the repo has known pre-existing `_generated`/stale-test noise — don't chase unrelated failures.

---

## Task 1: Mainnet-ready escrow RPC + `isMainnet` helper

**Files:**
- Modify: `apps/web/lib/solana/network.ts` (add `isMainnet`)
- Modify: `apps/web/lib/escrow.ts:15-17,52` (+ new `getEscrowRpcUrl`/`getEscrowConnection`)
- Test: `apps/web/lib/solana/network.test.ts`

**Interfaces:**
- Produces: `isMainnet(network?: SolanaNetwork): boolean`; `getEscrowRpcUrl(): string`; `getEscrowConnection(): Connection` (from `lib/escrow.ts`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/solana/network.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { isMainnet, getNetwork } from "./network";

const orig = process.env.NEXT_PUBLIC_SOLANA_NETWORK;
afterEach(() => { process.env.NEXT_PUBLIC_SOLANA_NETWORK = orig; });

describe("isMainnet", () => {
  it("is true for mainnet + mainnet-beta", () => {
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "mainnet";
    expect(getNetwork()).toBe("mainnet-beta");
    expect(isMainnet()).toBe(true);
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "mainnet-beta";
    expect(isMainnet()).toBe(true);
  });
  it("is false for devnet / unset", () => {
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "devnet";
    expect(isMainnet()).toBe(false);
    delete process.env.NEXT_PUBLIC_SOLANA_NETWORK;
    expect(isMainnet()).toBe(false);
  });
  it("respects an explicit network arg", () => {
    expect(isMainnet("mainnet-beta")).toBe(true);
    expect(isMainnet("devnet")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/solana/network.test.ts`
Expected: FAIL — `isMainnet is not a function` / not exported.

- [ ] **Step 3: Add `isMainnet` to `network.ts`**

Add after `getNetwork()` (near `network.ts:17`):
```ts
/** Mainnet detection — the single source used to gate real-money features. */
export function isMainnet(network?: SolanaNetwork): boolean {
  return (network ?? getNetwork()) === "mainnet-beta";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/solana/network.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix the devnet-pinned escrow RPC**

In `apps/web/lib/escrow.ts`:
1. Add to the network import at the top (currently `import { getUsdcMint } from "./solana/network";`):
```ts
import { getUsdcMint, getRpcUrl, getNetwork } from "./solana/network";
```
2. Replace the `DEVNET_RPC` const (`escrow.ts:15-17`) and add helpers:
```ts
/** RPC for the escrow program — network-aware so mainnet signs against mainnet.
 *  (Was hardcoded to devnet, which would sign a mainnet deploy against devnet.) */
export function getEscrowRpcUrl(): string {
  return getRpcUrl(getNetwork());
}

export function getEscrowConnection(): Connection {
  return new Connection(getEscrowRpcUrl(), "confirmed");
}
```
3. In `buildEscrowProgram` (`escrow.ts:52`), change:
```ts
const connection = new web3.Connection(DEVNET_RPC, "confirmed");
```
to:
```ts
const connection = new web3.Connection(getEscrowRpcUrl(), "confirmed");
```
(Remove the now-unused `DEVNET_RPC` const. `Connection` is already imported from `@solana/web3.js` at `escrow.ts:5`.)

- [ ] **Step 6: Verify types + commit**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "escrow|network" || echo "no new errors in touched files"`
Expected: no new errors referencing `escrow.ts`/`network.ts`.

```bash
git add apps/web/lib/solana/network.ts apps/web/lib/solana/network.test.ts apps/web/lib/escrow.ts
git commit -m "fix(escrow): network-aware RPC + isMainnet helper (mainnet-ready)"
```

---

## Task 2: Convex — drop `isHalalOnly` from campaign + add `listDraftsByCreator`

**Files:**
- Modify: `apps/web/convex/schema.ts:239` (isHalalOnly → optional)
- Modify: `apps/web/convex/campaigns.ts:32,244` (remove isHalalOnly validators), add `listDraftsByCreator`
- Modify: `apps/web/convex/campaigns.test.ts:36` (remove fixture field)
- Test: `apps/web/convex/campaigns.test.ts` (new draft-query test)

**Interfaces:**
- Produces: `api.campaigns.listDraftsByCreator({ creatorWallet: string }) → Doc<"campaigns">[]` (only unfunded open drafts).

- [ ] **Step 1: Write the failing test**

Add to `apps/web/convex/campaigns.test.ts` (follow the existing `convexTest` harness in that file; adapt seed helper names to what the file already uses):
```ts
test("listDraftsByCreator returns only unfunded open drafts", async () => {
  const t = convexTest(schema);
  const wallet = "Wa11etCreator1111111111111111111111111111111";
  // draft: no pdaAddress
  await t.mutation(api.campaigns.create, {
    creatorWallet: wallet, brandName: "B", title: "Draft one",
    brief: "x".repeat(60), budget: 100, ratePerThousandViews: 3,
    campaignType: "marketing", targetNiche: ["lifestyle"], targetLanguage: ["en"],
    deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
  });
  // funded: has pdaAddress + onchainVersion 2
  const fundedId = await t.mutation(api.campaigns.create, {
    creatorWallet: wallet, brandName: "B", title: "Funded one",
    brief: "x".repeat(60), budget: 100, ratePerThousandViews: 3,
    campaignType: "marketing", targetNiche: ["lifestyle"], targetLanguage: ["en"],
    deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
  });
  await t.mutation(api.campaigns.updateCampaignPda, {
    id: fundedId, pdaAddress: "PdA11111111111111111111111111111111111111111",
    callerWallet: wallet, onchainVersion: 2,
  });

  const drafts = await t.query(api.campaigns.listDraftsByCreator, { creatorWallet: wallet });
  expect(drafts).toHaveLength(1);
  expect(drafts[0].title).toBe("Draft one");
});
```
Note: this test also proves `create` accepts args **without** `isHalalOnly`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run convex/campaigns.test.ts -t "listDraftsByCreator"`
Expected: FAIL — `create` still requires `isHalalOnly` (validator error) and `listDraftsByCreator` doesn't exist.

- [ ] **Step 3: Remove `isHalalOnly` validators**

- `apps/web/convex/schema.ts:239`: change `isHalalOnly: v.boolean(),` → `isHalalOnly: v.optional(v.boolean()),`
- `apps/web/convex/campaigns.ts:244`: delete the line `isHalalOnly: v.boolean(),` from the `create` args.
- `apps/web/convex/campaigns.ts:32`: delete the `isHalalOnly: v.optional(v.boolean()),` line (verify it's a validator field in that block before deleting).
- `apps/web/convex/campaigns.test.ts:36`: delete `isHalalOnly: false,` from the shared fixture.

- [ ] **Step 4: Add `listDraftsByCreator`**

Add after `listByCreator` (`campaigns.ts:198`):
```ts
/** Unfunded campaign drafts for a creator — launches that never completed the
 *  escrow deposit (no on-chain vault yet). Used by the launch wizard to offer a
 *  Resume instead of silently re-creating (which is what double-charged users). */
export const listDraftsByCreator = query({
  args: { creatorWallet: v.string() },
  handler: async (ctx, { creatorWallet }) => {
    const rows = await ctx.db
      .query("campaigns")
      .withIndex("by_creator", (q) => q.eq("creatorWallet", creatorWallet))
      .collect();
    return rows.filter(
      (c) => !c.pdaAddress && (c.onchainVersion ?? 1) < 2 && c.status === "open",
    );
  },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run convex/campaigns.test.ts`
Expected: PASS (including the pre-existing tests, now without the `isHalalOnly` fixture field).

- [ ] **Step 6: Commit**

```bash
git add apps/web/convex/schema.ts apps/web/convex/campaigns.ts apps/web/convex/campaigns.test.ts
git commit -m "feat(campaign): drop isHalalOnly from campaign backend + add listDraftsByCreator draft query"
```

---

## Task 3: Remove `isHalalOnly` from campaign UI, matcher, types, catalog, mocks

**Files:**
- Modify: `apps/web/components/campaign/campaign-form.tsx:132,672,745,1243-1249`
- Modify: `apps/web/components/influencer/campaign-scanner.tsx:131-132,171`
- Modify: `apps/web/app/stage/page.tsx:137`, `apps/web/app/stage/[id]/page.tsx:55`
- Modify: `apps/web/lib/types.ts:91`
- Modify: `apps/web/lib/builder/skillsCatalog.ts:487`
- Modify: `apps/web/lib/mock-data.ts:135,153,171`
- Modify: test fixtures: `apps/web/convex/oracle.test.ts:20`, `replay.test.ts:49`, `submissions.test.ts:29`, `walletStats.test.ts:178`

**Interfaces:**
- Consumes: nothing new. Removes the `isHalalOnly` field from the campaign form values, the shared `Campaign` type, and the matcher.

- [ ] **Step 1: Update matcher first (behavioral) and its fixture**

`apps/web/components/influencer/campaign-scanner.tsx`:
- Delete line 131 comment `// Hard block: halal-only + non-halal agent` and line 132 `if (c.isHalalOnly && !inf.isHalal) return null;`.
- Delete line 171 `if (c.isHalalOnly && inf.isHalal) { score += 10; }`.

- [ ] **Step 2: Remove the form field + checkbox**

`apps/web/components/campaign/campaign-form.tsx`:
- Line 132: delete `isHalalOnly: z.boolean().default(false),` from `campaignSchema`.
- Line 672: delete `isHalalOnly: false,` from `defaultValues`.
- Line 745: delete `isHalalOnly: values.isHalalOnly,` from the `createCampaign({...})` call.
- Lines 1243-1249: delete the entire halal `<label>…</label>` block (the checkbox from Image 3).

- [ ] **Step 3: Remove read/passthrough + shared type + catalog + mocks**

- `apps/web/app/stage/page.tsx:137`: delete `isHalalOnly: doc.isHalalOnly,`.
- `apps/web/app/stage/[id]/page.tsx:55`: delete `isHalalOnly: doc.isHalalOnly,`.
- `apps/web/lib/types.ts:91`: delete `isHalalOnly: boolean;`.
- `apps/web/lib/builder/skillsCatalog.ts:487`: delete the line ``- Respect `isHalalOnly` and the campaign's target niche/language.`` (if the sentence also covers niche/language, keep that part: replace with ``- Respect the campaign's target niche/language.``).
- `apps/web/lib/mock-data.ts`: delete `isHalalOnly: true|false,` at lines 135, 153, 171.
- Delete `isHalalOnly: false,` from fixtures: `convex/oracle.test.ts:20`, `convex/replay.test.ts:49`, `convex/submissions.test.ts:29`, `convex/walletStats.test.ts:178`.

- [ ] **Step 4: Verify types + suites**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep -iE "isHalalOnly|campaign-form|campaign-scanner|mock-data" || echo "clean"`
Expected: `clean` (no references to the removed field in touched files).
Run: `cd apps/web && npx vitest run convex/oracle.test.ts convex/replay.test.ts convex/submissions.test.ts convex/walletStats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web
git commit -m "feat(campaign): remove Halal-only checkbox + isHalalOnly matcher/type/catalog/mocks"
```

---

## Task 4: Remove agent/influencer `isHalal` everywhere

**Files (all Modify):**
- `apps/web/convex/schema.ts:98` (→ optional)
- `apps/web/convex/influencers.ts:609,633`, `apps/web/convex/workers.ts:43,77`, `apps/web/convex/admin.ts:134,210`, `apps/web/convex/nftAgents.ts:190`
- `apps/web/app/studio/agent/[id]/edit/page.tsx:58,75,246-261`
- `apps/web/components/admin/agents-section.tsx:22,63,79,136-146`
- `apps/web/store/wizard.ts:43,66`, `apps/web/components/studio/step-launch.tsx:100`
- `apps/web/app/workers/create/page.tsx:69,105`
- `apps/web/app/market/[id]/page.tsx:42`, `apps/web/app/workers/[id]/page.tsx:50`, `apps/web/app/workers/page.tsx:45`, `apps/web/app/workers/hire/[id]/page.tsx:50`
- `apps/web/lib/types.ts:30,133`, `apps/web/lib/mock-data.ts:16,64,103`
- Test fixtures: `apps/web/convex/submissions.test.ts:376`, `replay.test.ts:24`, `walletStats.test.ts:32`, `walletSecret.test.ts:37`, `workers.test.ts:23`, `adminEconomy.test.ts:175`

**Interfaces:**
- Removes the `isHalal` attribute from agents/influencers/workers. `schema.ts:98` becomes optional (non-destructive).

- [ ] **Step 1: Schema + Convex validators/handlers**

- `schema.ts:98`: `isHalal: v.boolean(),` → `isHalal: v.optional(v.boolean()),`
- `influencers.ts:609` and `:633`: delete `isHalal: v.boolean(),` from both mutation validators; remove any `isHalal` assignment in their handlers (grep the handler body).
- `workers.ts:77`: delete `isHalal: v.boolean(),`; `workers.ts:43`: delete `isHalal: agent.isHalal ?? false,` from the mapping.
- `admin.ts:134` and `:210`: delete `isHalal: v.optional(v.boolean()),`.
- `nftAgents.ts:190`: delete `isHalal: false,` from the insert.

- [ ] **Step 2: UI — studio edit, admin, wizard, workers**

- `app/studio/agent/[id]/edit/page.tsx`: delete `isHalal: false,` (58), `isHalal: agent.isHalal,` (75), and the whole "Halal Certified" `<button>…</button>` (246-261).
- `components/admin/agents-section.tsx`: delete the `isHalal: boolean;` type field (22), `f.isHalal = …` (63), `patch.isHalal = …` (79), and the "Halal" `<label>…</label>` select (136-146).
- `store/wizard.ts`: delete `isHalal: boolean;` (43) and `isHalal: false,` from `brand` init (66). `components/studio/step-launch.tsx:100`: delete `isHalal: wizardState.brand.isHalal,`.
- `app/workers/create/page.tsx`: delete `const [isHalal] = useState(false);` (69) and `isHalal,` from the submit payload (105).

- [ ] **Step 3: Reads + shared type + mocks**

- Delete `isHalal: doc.isHalal,` at `app/market/[id]/page.tsx:42`, `app/workers/[id]/page.tsx:50`, `app/workers/page.tsx:45`, `app/workers/hire/[id]/page.tsx:50`.
- `lib/types.ts`: delete `isHalal: boolean;` at 30 and 133.
- `lib/mock-data.ts`: delete `isHalal: …` at 16, 64, 103.
- Delete `isHalal: …` from test fixtures listed in Files.

- [ ] **Step 4: Verify no dangling references**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep -i "isHalal" || echo "no isHalal type errors"`
Expected: `no isHalal type errors`.
Run: `cd apps/web && npx vitest run convex/workers.test.ts convex/submissions.test.ts convex/replay.test.ts convex/walletStats.test.ts convex/walletSecret.test.ts convex/adminEconomy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web
git commit -m "feat(agents): remove isHalal (Halal Certified) attribute across UI, convex, types, mocks"
```

---

## Task 5: Remove trader `isHalalCompliant`

**Files (all Modify):**
- `apps/web/convex/traderStrategies.ts:17,34,49`, `apps/web/convex/schema.ts:813` (→ optional)
- `apps/web/lib/trader/tradeRouter.ts:20-32,42-43,56,74,77-87`

**Interfaces:**
- Removes the halal screen from the trade router. No asset is ever `halal-block`ed.

- [ ] **Step 1: tradeRouter — delete the halal screen**

`apps/web/lib/trader/tradeRouter.ts`:
- Delete the `HALAL_BLOCKLIST` set + `isHalalSafe()` (20-32).
- Delete the `halalCompliant?: boolean;` param field (42-43).
- In the `RouteResult.venue` union (56), remove `"halal-block" | `.
- In the `routeAndExecute` destructure (74), remove `halalCompliant, `.
- Delete the entire "Halal screen first" block (77-87).

- [ ] **Step 2: Convex trader strategy**

- `traderStrategies.ts:17`: delete `isHalalCompliant: v.optional(v.boolean()),`.
- `traderStrategies.ts:34` and `:49`: delete `isHalalCompliant: args.isHalalCompliant ?? true,`.
- `schema.ts:813`: `isHalalCompliant: v.optional(v.boolean()),` → keep as optional but stop writing it (leave the line so existing docs validate; it's already optional). **No change needed if already `v.optional`** — confirm and leave.

- [ ] **Step 3: Verify + commit**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep -iE "halalCompliant|tradeRouter|traderStrateg" || echo "clean"`
Expected: `clean`.
Run: `cd apps/web && npx vitest run 2>&1 | tail -5` (full suite; confirm no new failures vs baseline).

```bash
git add -A apps/web
git commit -m "feat(trader): remove isHalalCompliant halal screen from tradeRouter + strategies"
```

---

## Task 6: Wallet SOL balance hook + pure funding check

**Files:**
- Modify: `apps/web/lib/client/usdcClient.ts` (add `useWalletSol`, `checkFunding`, `SOL_GAS_FLOOR`)
- Test: `apps/web/lib/client/funding.test.ts`

**Interfaces:**
- Produces: `useWalletSol(): { sol: number | null; refresh: () => void }`; `checkFunding(opts): FundingCheck`; `type FundingCheck = { ok, needUsdc, needSol, usdcShort, solShort }`; const `SOL_GAS_FLOOR`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/client/funding.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { checkFunding, SOL_GAS_FLOOR } from "./usdcClient";

describe("checkFunding", () => {
  it("ok when usdc >= budget and sol >= gas floor", () => {
    const r = checkFunding({ usdc: 100, sol: 0.05, budget: 100 });
    expect(r).toMatchObject({ ok: true, needUsdc: false, needSol: false });
  });
  it("flags a usdc shortfall with the exact amount", () => {
    const r = checkFunding({ usdc: 40, sol: 0.05, budget: 100 });
    expect(r.ok).toBe(false);
    expect(r.needUsdc).toBe(true);
    expect(r.usdcShort).toBeCloseTo(60);
  });
  it("flags a sol shortfall", () => {
    const r = checkFunding({ usdc: 100, sol: 0, budget: 100 });
    expect(r.ok).toBe(false);
    expect(r.needSol).toBe(true);
    expect(r.solShort).toBeCloseTo(SOL_GAS_FLOOR);
  });
  it("treats null balances as zero", () => {
    const r = checkFunding({ usdc: null, sol: null, budget: 10 });
    expect(r).toMatchObject({ ok: false, needUsdc: true, needSol: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/client/funding.test.ts`
Expected: FAIL — `checkFunding`/`SOL_GAS_FLOOR` not exported.

- [ ] **Step 3: Implement in `usdcClient.ts`**

Add near the top (after `USDC_DECIMALS`):
```ts
/** SOL headroom for one escrow tx + a possible ATA rent (~0.002 SOL) + fees. */
export const SOL_GAS_FLOOR = 0.01;

export type FundingCheck = {
  ok: boolean;
  needUsdc: boolean;
  needSol: boolean;
  usdcShort: number;
  solShort: number;
};

/** Pure balance gate for the pre-flight review. Null balances count as 0. */
export function checkFunding(opts: {
  usdc: number | null;
  sol: number | null;
  budget: number;
  gasFloor?: number;
}): FundingCheck {
  const gasFloor = opts.gasFloor ?? SOL_GAS_FLOOR;
  const usdc = opts.usdc ?? 0;
  const sol = opts.sol ?? 0;
  const needUsdc = usdc < opts.budget;
  const needSol = sol < gasFloor;
  return {
    ok: !needUsdc && !needSol,
    needUsdc,
    needSol,
    usdcShort: needUsdc ? opts.budget - usdc : 0,
    solShort: needSol ? gasFloor - sol : 0,
  };
}
```
Add the SOL hook (mirrors `useWalletUsdc`, same `rpc()`/`useUnifiedSolanaWallet`):
```ts
/** Live SOL balance of the connected wallet. Polls every 20s + refetch on demand. */
export function useWalletSol(): { sol: number | null; refresh: () => void } {
  const { publicKey } = useUnifiedSolanaWallet();
  const [sol, setSol] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!publicKey) { setSol(null); return; }
    try {
      const lamports = await rpc().getBalance(publicKey, "confirmed");
      setSol(lamports / 1e9);
    } catch { /* keep last value on transient RPC errors */ }
  }, [publicKey]);

  useEffect(() => {
    void load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  return { sol, refresh: load };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/client/funding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/client/usdcClient.ts apps/web/lib/client/funding.test.ts
git commit -m "feat(wallet): add useWalletSol + pure checkFunding pre-flight gate"
```

---

## Task 7: On-ramp provider layer + Transak adapter (mainnet-gated)

**Files:**
- Modify: `apps/web/package.json` (add `@transak/transak-sdk`)
- Create: `apps/web/lib/client/onramp/types.ts`, `apps/web/lib/client/onramp/transak.ts`, `apps/web/lib/client/onramp/index.ts`
- Test: `apps/web/lib/client/onramp/onramp.test.ts`

**Interfaces:**
- Produces: `interface OnrampProvider { id: string; open(opts: OnrampOpenOptions): void | Promise<void> }`; `getOnrampProvider(): OnrampProvider`; `isOnrampAvailable(): boolean`.

- [ ] **Step 1: Add the dependency**

Run: `cd apps/web && npm install --save --ignore-scripts @transak/transak-sdk`
(Repo convention: `--ignore-scripts`.) Confirm a version pin lands in `package.json`. **Verify the installed SDK's event/config API against `node_modules/@transak/transak-sdk/README.md`** before Step 3 — the config keys/event names below target the v3 SDK and may need adjusting.

- [ ] **Step 2: Write the failing test**

Create `apps/web/lib/client/onramp/onramp.test.ts`:
```ts
import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); });

describe("onramp selector + gating", () => {
  it("defaults to the transak provider", async () => {
    const { getOnrampProvider } = await import("./index");
    expect(getOnrampProvider().id).toBe("transak");
  });
  it("isOnrampAvailable is false off mainnet", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "devnet");
    vi.stubEnv("NEXT_PUBLIC_TRANSAK_API_KEY", "key");
    const { isOnrampAvailable } = await import("./index");
    expect(isOnrampAvailable()).toBe(false);
  });
  it("isOnrampAvailable requires a key even on mainnet", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "mainnet-beta");
    vi.stubEnv("NEXT_PUBLIC_TRANSAK_API_KEY", "");
    const { isOnrampAvailable } = await import("./index");
    expect(isOnrampAvailable()).toBe(false);
  });
  it("the transak provider satisfies the OnrampProvider shape", async () => {
    const { transakProvider } = await import("./transak");
    expect(transakProvider.id).toBe("transak");
    expect(typeof transakProvider.open).toBe("function");
  });
});
```

- [ ] **Step 3: Implement the layer**

`apps/web/lib/client/onramp/types.ts`:
```ts
export interface OnrampOpenOptions {
  walletAddress: string;
  fiatCurrency?: string; // default "MYR"
  cryptoAsset: "USDC";
  chain: "solana";
  suggestedAmountUsd?: number;
  onSuccess?: (o: { orderId?: string }) => void;
  onExit?: () => void;
}

export interface OnrampProvider {
  id: string;
  open(opts: OnrampOpenOptions): void | Promise<void>;
}
```

`apps/web/lib/client/onramp/transak.ts` (v3 baseline — reconcile with the installed README in Step 1):
```ts
import { Transak } from "@transak/transak-sdk";
import type { OnrampProvider, OnrampOpenOptions } from "./types";

export const transakProvider: OnrampProvider = {
  id: "transak",
  open(opts: OnrampOpenOptions) {
    const apiKey = process.env.NEXT_PUBLIC_TRANSAK_API_KEY;
    if (!apiKey) throw new Error("NEXT_PUBLIC_TRANSAK_API_KEY not set");
    const env = (process.env.NEXT_PUBLIC_TRANSAK_ENV ?? "STAGING").toUpperCase();

    const transak = new Transak({
      apiKey,
      environment: env === "PRODUCTION"
        ? Transak.ENVIRONMENTS.PRODUCTION
        : Transak.ENVIRONMENTS.STAGING,
      productsAvailed: "BUY",
      cryptoCurrencyCode: opts.cryptoAsset,          // "USDC"
      network: opts.chain,                            // "solana"
      walletAddress: opts.walletAddress,
      fiatCurrency: opts.fiatCurrency ?? "MYR",
      defaultFiatAmount: opts.suggestedAmountUsd,
    });

    transak.init();

    Transak.on(Transak.EVENTS.TRANSAK_ORDER_SUCCESSFUL, (payload: unknown) => {
      const orderId = (payload as { status?: { id?: string } })?.status?.id;
      opts.onSuccess?.({ orderId });
    });
    Transak.on(Transak.EVENTS.TRANSAK_WIDGET_CLOSE, () => {
      opts.onExit?.();
      transak.close();
    });
  },
};
```

`apps/web/lib/client/onramp/index.ts`:
```ts
import { isMainnet } from "@/lib/solana/network";
import type { OnrampProvider } from "./types";
import { transakProvider } from "./transak";

const PROVIDERS: Record<string, OnrampProvider> = { transak: transakProvider };

export function getOnrampProvider(): OnrampProvider {
  const id = (process.env.NEXT_PUBLIC_ONRAMP_PROVIDER ?? "transak").toLowerCase();
  return PROVIDERS[id] ?? transakProvider;
}

/** On-ramp is only meaningful on mainnet (delivers real mainnet USDC) and needs
 *  a provider key. */
export function isOnrampAvailable(): boolean {
  return isMainnet() && Boolean(process.env.NEXT_PUBLIC_TRANSAK_API_KEY);
}

export type { OnrampProvider, OnrampOpenOptions } from "./types";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/client/onramp/onramp.test.ts`
Expected: PASS. (If `@transak/transak-sdk` fails to import in the test env, mock it: add `vi.mock("@transak/transak-sdk", () => ({ Transak: class {} }))` at the top of the test — the selector/gating tests don't call `open`.)

- [ ] **Step 5: Add env docs + commit**

Append to the env reference (`apps/web/.env.example` if present, else note in the PR):
```
NEXT_PUBLIC_ONRAMP_PROVIDER=transak
NEXT_PUBLIC_TRANSAK_API_KEY=
NEXT_PUBLIC_TRANSAK_ENV=STAGING
```
```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/lib/client/onramp
git commit -m "feat(onramp): provider-agnostic on-ramp layer + Transak adapter (mainnet-gated)"
```

---

## Task 8: Treasury reframe (Step 3 copy + preview badge)

**Files:**
- Modify: `apps/web/components/campaign/campaign-form.tsx` — `StepHeading` blurb (1156-1160), `stepLabel` (154-161), Escrow→Treasury badge (458), + a treasury summary card after the deadline field (~1242).

**Interfaces:**
- Consumes: `formValues.budget`, `formValues.ratePerThousandViews`, `campaignType` (already in scope).

- [ ] **Step 1: Extend the `Step` union, then relabel the money copy**

First extend the `Step` union (`campaign-form.tsx:152`) so `stepLabel` compiles standalone (Task 9 relies on the same union and only adds imports/refs):
```ts
type Step =
  | "idle" | "resuming" | "creating-convex" | "preflight"
  | "funding-wallet" | "signing-escrow" | "verifying" | "finalizing" | "done";
```

- `campaign-form.tsx:1158-1159`: change title/blurb to:
```tsx
title="Fund your campaign treasury"
blurb="Deposit your budget into this campaign's on-chain treasury. Agents get paid from it only for verified work — you can reclaim the remainder after the deadline."
```
- Budget field label (`:1182`): `label="Total budget (USDC)"` → `label="Deposit into campaign treasury (USDC)"`.
- `stepLabel()` (154-161): update/extend:
```ts
function stepLabel(step: Step): string {
  switch (step) {
    case "resuming": return "Resuming draft...";
    case "creating-convex": return "Creating campaign...";
    case "preflight": return "Checking your balance...";
    case "funding-wallet": return "Funding wallet...";
    case "signing-escrow": return "Approve deposit in wallet...";
    case "verifying": return "Confirming deposit on-chain...";
    case "finalizing": return "Locking treasury...";
    default: return "Launch campaign";
  }
}
```

- [ ] **Step 2: Rename the preview badge**

`campaign-form.tsx:458`: change `<p …>Escrow</p>` → `<p …>Treasury</p>` (label only; the `$X` at 460 stays).

- [ ] **Step 3: Add a treasury summary card**

Insert after the deadline `<Field>` (after line 1241, before the `</>` at 1250 — the halal `<label>` at 1243-1249 is already gone from Task 3), marketing-only:
```tsx
{campaignType === "marketing" && Number(formValues.budget) > 0 && (
  <div className="rounded-lg border border-emerald-900/40 bg-emerald-500/[0.04] px-3.5 py-3 text-xs text-zinc-300">
    You deposit{" "}
    <span className="font-mono font-semibold text-emerald-300">
      ${Number(formValues.budget).toLocaleString()} USDC
    </span>{" "}
    into this campaign&apos;s on-chain treasury. Agents earn{" "}
    <span className="font-mono font-semibold text-emerald-300">
      ${Number(formValues.ratePerThousandViews ?? 3).toLocaleString()} / 1,000 views
    </span>{" "}
    from it until it&apos;s drained. Released only on verified, approved work.
  </div>
)}
```

- [ ] **Step 4: Verify + commit**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep -i "campaign-form" || echo "clean"`
Expected: `clean`.
```bash
git add apps/web/components/campaign/campaign-form.tsx
git commit -m "feat(campaign): reframe Step 3 as a campaign treasury deposit"
```

---

## Task 9: Reliable, idempotent, resumable launch state machine

**Files:**
- Create: `apps/web/lib/client/launchMachine.ts` (pure decision fns) + `apps/web/lib/client/launchMachine.test.ts`
- Modify: `apps/web/lib/escrow.ts` (export a `checkVaultFunded` convenience, optional)
- Modify: `apps/web/components/campaign/campaign-form.tsx` — `Step` union (152), imports (1-26), `onSubmit` (697-806), submit-button label already handled by Task 8; add resume banner + pre-flight/fund UI in Step 3.

**Interfaces:**
- Consumes: `getEscrowBalance`, `getCampaignPda`, `getEscrowConnection` (`lib/escrow.ts`); `checkFunding`, `useWalletSol`, `useWalletUsdc` (`usdcClient.ts`); `getOnrampProvider`, `isOnrampAvailable` (`onramp`); `api.campaigns.listDraftsByCreator`.
- Produces: `decideBeforeSign`, `decideAfterSignError`, `type LaunchDecision` (`launchMachine.ts`).

- [ ] **Step 1: Write the failing test for the decision logic**

Create `apps/web/lib/client/launchMachine.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { decideBeforeSign, decideAfterSignError } from "./launchMachine";

describe("decideBeforeSign", () => {
  it("skips funding when the vault already holds the budget (timeout-but-landed)", () => {
    expect(decideBeforeSign({ vaultFunded: true, funding: { ok: false, needUsdc: true, needSol: false } }))
      .toEqual({ action: "skip-funding-finalize" });
  });
  it("routes to fund-wallet on a USDC shortfall", () => {
    expect(decideBeforeSign({ vaultFunded: false, funding: { ok: false, needUsdc: true, needSol: false } }))
      .toEqual({ action: "fund-wallet", reason: "usdc" });
  });
  it("routes to fund-wallet on a SOL shortfall", () => {
    expect(decideBeforeSign({ vaultFunded: false, funding: { ok: false, needUsdc: false, needSol: true } }))
      .toEqual({ action: "fund-wallet", reason: "sol" });
  });
  it("signs when funded-enough and vault empty", () => {
    expect(decideBeforeSign({ vaultFunded: false, funding: { ok: true, needUsdc: false, needSol: false } }))
      .toEqual({ action: "sign-escrow" });
  });
});

describe("decideAfterSignError", () => {
  it("finalizes if the vault turns out funded after a thrown/timeout", () => {
    expect(decideAfterSignError({ vaultFundedAfter: true })).toEqual({ action: "skip-funding-finalize" });
  });
  it("errors (never re-charges) if the vault is still empty", () => {
    expect(decideAfterSignError({ vaultFundedAfter: false })).toEqual({ action: "error", reason: "deposit-unconfirmed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/client/launchMachine.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `launchMachine.ts`**

```ts
export type LaunchDecision =
  | { action: "fund-wallet"; reason: "usdc" | "sol" }
  | { action: "skip-funding-finalize" }
  | { action: "sign-escrow" }
  | { action: "error"; reason: string };

/** What to do right before prompting the wallet.
 *  vaultFunded MUST come from getEscrowBalance(pda) >= budget so a prior
 *  timed-out attempt that actually landed never funds a second escrow. */
export function decideBeforeSign(opts: {
  vaultFunded: boolean;
  funding: { ok: boolean; needUsdc: boolean; needSol: boolean };
}): LaunchDecision {
  if (opts.vaultFunded) return { action: "skip-funding-finalize" };
  if (opts.funding.needUsdc) return { action: "fund-wallet", reason: "usdc" };
  if (opts.funding.needSol) return { action: "fund-wallet", reason: "sol" };
  return { action: "sign-escrow" };
}

/** After createCampaignTx throws (often a confirmation timeout even though the
 *  tx landed): re-read the vault. Funded → finalize; still empty → honest error,
 *  never a re-charge. */
export function decideAfterSignError(opts: { vaultFundedAfter: boolean }): LaunchDecision {
  if (opts.vaultFundedAfter) return { action: "skip-funding-finalize" };
  return { action: "error", reason: "deposit-unconfirmed" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/client/launchMachine.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `checkVaultFunded` to escrow.ts**

Append to `apps/web/lib/escrow.ts`:
```ts
/** True when the per-campaign vault already holds at least `budgetUsdc`
 *  (minus dust). Uses the raw SPL balance, so it works without IDL regen. */
export async function checkVaultFunded(
  campaignId: string,
  creatorWallet: PublicKey | string,
  budgetUsdc: number,
): Promise<{ funded: boolean; balance: number; pdaAddress: string }> {
  const [pda] = getCampaignPda(campaignId, creatorWallet);
  const balance = await getEscrowBalance(getEscrowConnection(), pda.toBase58());
  return { funded: balance + 1e-6 >= budgetUsdc, balance, pdaAddress: pda.toBase58() };
}
```

- [ ] **Step 6: Add imports (the `Step` union was extended in Task 8 Step 1)**

Add imports (top of file):
```ts
import { useMemo, useRef } from "react";               // extend the existing "react" import
import { useQuery } from "convex/react";                // add alongside useMutation
import { buildEscrowProgram, createCampaignTx, checkVaultFunded } from "@/lib/escrow";
import { useWalletUsdc, useWalletSol, checkFunding } from "@/lib/client/usdcClient";
import { decideBeforeSign, decideAfterSignError } from "@/lib/client/launchMachine";
import { getOnrampProvider, isOnrampAvailable } from "@/lib/client/onramp";
```

- [ ] **Step 7: Wire hooks + refs in the component body**

After `const { publicKey, signTransaction, ... } = useUnifiedSolanaWallet();` (581):
```ts
const { usdc, refresh: refreshUsdc } = useWalletUsdc();
const { sol, refresh: refreshSol } = useWalletSol();
const convexIdRef = useRef<Id<"campaigns"> | null>(null);
const drafts = useQuery(
  api.campaigns.listDraftsByCreator,
  publicKey ? { creatorWallet: publicKey.toBase58() } : "skip",
);
```

- [ ] **Step 8: Rewrite `onSubmit` (idempotent, verify-on-timeout)**

Replace `onSubmit` (`697-806`) with:
```ts
async function onSubmit(values: CampaignFormValues) {
  if (!publicKey) return;
  setError(null);
  setEscrowWarning(null);

  // 1. Reuse an existing draft row if we already created one this session (or
  //    resumed one) — NEVER insert a second campaign on retry.
  let convexId = convexIdRef.current;
  if (!convexId) {
    setStep("creating-convex");
    let campaignImageStorageId: string | undefined;
    const contentFileStorageIds: string[] = [];
    try {
      if (imageFile) campaignImageStorageId = await uploadFile(imageFile);
      for (const { file } of contentFiles) contentFileStorageIds.push(await uploadFile(file));
    } catch {
      setError("File upload failed. Check your connection and try again.");
      setStep("idle"); window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    const validLinks = contentLinks.filter((l) => l.trim().length > 0);
    try {
      convexId = await createCampaign({
        creatorWallet: publicKey.toBase58(),
        brandName: values.brandName, title: values.title, brief: values.brief,
        budget: values.budget,
        ratePerThousandViews: campaignType === "marketing" ? (values.ratePerThousandViews ?? 3) : 0,
        campaignType,
        rewardPerCompletion: campaignType !== "marketing" ? values.rewardPerCompletion : undefined,
        agentTaskCategory: campaignType === "agent_task" ? values.agentTaskCategory : undefined,
        deliverables: campaignType === "bounty" ? values.deliverables : undefined,
        contentLinks: validLinks.length > 0 ? validLinks : undefined,
        contentFileStorageIds: contentFileStorageIds.length > 0 ? contentFileStorageIds : undefined,
        campaignImageStorageId,
        targetNiche: [values.targetNiche], targetLanguage: [values.targetLanguage],
        deadline: new Date(values.deadline).toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign.");
      setStep("idle"); window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    convexIdRef.current = convexId;
  }

  // 2. Pre-flight: verify the vault first (handles a prior landed-but-timed-out
  //    deposit), then gate on balances before ever prompting the wallet.
  setStep("preflight");
  await Promise.all([refreshUsdc(), refreshSol()]);
  let vaultFunded = false;
  try {
    const v = await checkVaultFunded(convexId, publicKey, values.budget);
    vaultFunded = v.funded;
  } catch { /* vault not created yet — treat as unfunded */ }

  const funding = checkFunding({ usdc, sol, budget: values.budget });
  const decision = decideBeforeSign({ vaultFunded, funding });

  if (decision.action === "fund-wallet") {
    if (isOnrampAvailable()) {
      setStep("funding-wallet");
      getOnrampProvider().open({
        walletAddress: publicKey.toBase58(),
        cryptoAsset: "USDC", chain: "solana", fiatCurrency: "MYR",
        suggestedAmountUsd: decision.reason === "usdc" ? funding.usdcShort : undefined,
        onExit: () => { setStep("idle"); void refreshUsdc(); void refreshSol(); },
      });
    } else {
      setError(
        decision.reason === "usdc"
          ? `You need ${funding.usdcShort.toFixed(2)} more USDC on ${getNetwork()}. Fund your wallet (devnet: faucet.circle.com) and click Launch again — we kept your draft.`
          : `You need more SOL for gas on ${getNetwork()}. Top up and click Launch again — we kept your draft.`,
      );
      setStep("idle"); window.scrollTo({ top: 0, behavior: "smooth" });
    }
    return;
  }

  // 3. Fund the escrow (once) — or skip straight to finalize if already funded.
  let pdaAddress: string | undefined;
  if (decision.action === "skip-funding-finalize") {
    [pdaAddress] = getCampaignPda(convexId, publicKey).map((k) => k.toBase58?.() ?? String(k)) as [string];
  } else {
    setStep("signing-escrow");
    try {
      if (!signTransaction) throw new Error("Wallet not connected.");
      const program = buildEscrowProgram({
        publicKey, signTransaction,
        signAllTransactions: async (txs) => {
          const signed = []; for (const t of txs) signed.push(await signTransaction(t)); return signed;
        },
      });
      const ratePer1k = campaignType === "marketing" ? (values.ratePerThousandViews ?? 3) : 0;
      const deadlineUnix = Math.floor(new Date(values.deadline).getTime() / 1000);
      const res = await createCampaignTx(program, convexId, values.budget, ratePer1k, deadlineUnix);
      pdaAddress = res.pdaAddress;
    } catch (err) {
      // Verify on-chain BEFORE ever asking to pay again (confirmation timeouts
      // often fire even though the deposit landed).
      setStep("verifying");
      let after = false;
      try { after = (await checkVaultFunded(convexId, publicKey, values.budget)).funded; } catch { /* keep false */ }
      const post = decideAfterSignError({ vaultFundedAfter: after });
      if (post.action === "skip-funding-finalize") {
        [pdaAddress] = getCampaignPda(convexId, publicKey).map((k) => k.toBase58?.() ?? String(k)) as [string];
      } else {
        setError(
          "We couldn't confirm your deposit yet. If your wallet shows it was sent, click Launch again — " +
          "we'll verify on-chain and never charge you twice. " +
          (err instanceof Error ? err.message : ""),
        );
        setStep("idle"); window.scrollTo({ top: 0, behavior: "smooth" }); return;
      }
    }
  }

  // 4. Finalize: mark v2 with the confirmed vault PDA.
  setStep("finalizing");
  try {
    if (!pdaAddress) throw new Error("No vault address after funding.");
    await updateCampaignPda({ id: convexId, pdaAddress, callerWallet: publicKey.toBase58(), onchainVersion: 2 });
  } catch (err) {
    setError(`Deposit confirmed but finalizing failed — click Launch again to retry (no re-charge). ${err instanceof Error ? err.message : ""}`);
    setStep("idle"); return;
  }

  convexIdRef.current = null;
  setStep("done");
  router.push("/stage");
}
```
Add `getCampaignPda` and `getNetwork` to imports:
```ts
import { buildEscrowProgram, createCampaignTx, checkVaultFunded, getCampaignPda } from "@/lib/escrow";
import { getNetwork } from "@/lib/solana/network";
```
> Note: `getCampaignPda` returns `[PublicKey, number]`; use `getCampaignPda(convexId, publicKey)[0].toBase58()` directly instead of the `.map` shown if cleaner — the plan's `.map` guard is only to avoid a second import. Prefer: `pdaAddress = getCampaignPda(convexId, publicKey)[0].toBase58();`

- [ ] **Step 9: Add the resume banner (top of the form)**

Just inside the form's top (above the wizard steps), render when an unfunded draft exists and we haven't already adopted one:
```tsx
{drafts && drafts.length > 0 && !convexIdRef.current && (
  <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-900/40 bg-amber-500/[0.05] px-3.5 py-3 text-xs text-amber-200">
    <span>You have an unfinished campaign deposit ({drafts[0].title}). Resume it instead of starting over?</span>
    <div className="flex gap-2">
      <button type="button" className="rounded-md bg-amber-500/20 px-2.5 py-1 font-medium hover:bg-amber-500/30"
        onClick={() => { convexIdRef.current = drafts[0]._id as Id<"campaigns">; setError(null); }}>
        Resume
      </button>
    </div>
  </div>
)}
```
(Resume adopts the existing draft's `_id`; the next Launch reuses its row + PDA and verifies on-chain. Discard is implicit — ignoring the banner. A future task can add explicit cancel.)

- [ ] **Step 10: Add a pre-flight balance line to Step 3**

Below the treasury summary card (Task 8), show the live balances so the user sees the gate before clicking:
```tsx
{campaignType === "marketing" && Number(formValues.budget) > 0 && (
  <p className="text-[11px] text-zinc-500">
    You hold{" "}
    <span className="font-mono text-zinc-300">{usdc === null ? "—" : `$${usdc.toFixed(2)}`} USDC</span>{" "}
    · <span className="font-mono text-zinc-300">{sol === null ? "—" : sol.toFixed(3)} SOL</span> for gas
    {usdc !== null && usdc < Number(formValues.budget) && (
      <> — <span className="text-amber-300">{isOnrampAvailable() ? "you'll be asked to fund your wallet" : "add USDC before launching"}</span></>
    )}
  </p>
)}
```

- [ ] **Step 11: Verify + commit**

Run: `cd apps/web && npx vitest run lib/client/launchMachine.test.ts lib/client/funding.test.ts`
Expected: PASS.
Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep -i "campaign-form\|launchMachine\|escrow.ts" || echo "clean"`
Expected: `clean`.
```bash
git add apps/web/lib/client/launchMachine.ts apps/web/lib/client/launchMachine.test.ts apps/web/lib/escrow.ts apps/web/components/campaign/campaign-form.tsx
git commit -m "feat(campaign): idempotent, resumable, verify-on-timeout launch (kills double-charge)"
```

---

## Task 10: Full-suite + lint gate

**Files:** none (verification only)

- [ ] **Step 1: Type + lint the whole app**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | tail -20`
Expected: no NEW errors vs the pre-work baseline (record the baseline count first with `git stash` if unsure; known `_generated`/stale noise is acceptable).
Run: `cd apps/web && npx eslint components/campaign lib/client lib/escrow.ts lib/solana convex/campaigns.ts 2>&1 | tail -20`
Expected: clean for touched paths.

- [ ] **Step 2: Run the affected test suites**

Run: `cd apps/web && npx vitest run lib/ convex/campaigns.test.ts convex/workers.test.ts`
Expected: PASS.

- [ ] **Step 3: Final commit if any fixups were needed**

```bash
git add -A apps/web
git commit -m "chore(campaign): lint/type fixups for treasury-deposit + halal removal"
```

---

## Self-Review

**Spec coverage:**
- Unit 1 (nuke halal) → Tasks 2 (campaign backend), 3 (campaign UI/matcher), 4 (agent isHalal), 5 (trader isHalalCompliant). ✓
- Unit 2 (reliable/idempotent/resumable) → Task 9 + query in Task 2. ✓
- Unit 3 (treasury reframe) → Task 8. ✓
- Unit 4 (pre-flight review) → Task 6 (hook + pure check) + Task 9 Steps 8,10. ✓
- Unit 5 (on-ramp Transak) → Task 7 + wired in Task 9 Step 8. ✓
- Unit 6 (mainnet-ready RPC) → Task 1. ✓

**Placeholder scan:** No TBD/TODO. The one "verify against the installed SDK README" note (Task 7) is a real, necessary reconciliation for a third-party API whose surface varies by version — not a hand-wave; the v3 baseline code is provided.

**Type consistency:** `checkFunding` returns `{ ok, needUsdc, needSol, usdcShort, solShort }`, consumed as such in `decideBeforeSign` (uses `ok/needUsdc/needSol`) and Task 9. `checkVaultFunded` returns `{ funded, balance, pdaAddress }`, consumed as `.funded`. `LaunchDecision` actions (`fund-wallet`/`skip-funding-finalize`/`sign-escrow`/`error`) match the `onSubmit` switch. `getCampaignPda(id, wallet)[0].toBase58()` matches its `[PublicKey, number]` signature. Draft filter matches the `getFundedByContentRewardId` convention (`!pdaAddress && (onchainVersion ?? 1) < 2`).

**Ordering:** Tasks 2–5 (halal) are independent of 1,6–9 and can run in either stream. Task 9 depends on 1 (`getEscrowConnection`/`checkVaultFunded`), 2 (`listDraftsByCreator`), 6 (`checkFunding`/`useWalletSol`), 7 (onramp), and 8 (which extends the `Step` union). **Applied fix:** the `Step` union extension now lives in Task 8 Step 1 so Task 8 compiles standalone; Task 9 Step 6 only adds imports/refs. Execute Task 8 before Task 9.

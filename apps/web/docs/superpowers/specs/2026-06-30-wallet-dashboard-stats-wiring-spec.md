# Spec: Wire the `/wallet` Dashboard to Real Data

**Date:** 2026-06-30
**Target page:** `apps/web/app/wallet/page.tsx` (471 lines, fully read)
**Symptom:** logged-in user (wallet `pSZM…ipyb`) sees every stat `$0 / 0` and "0 agent NFTs".
**Method:** 6-subsystem understanding swarm (Opus 4.8 max) → per-subsystem adversarial verify (all 6 "agrees, high confidence") → 3-lens red-team (correctness / completeness / feasibility, all "revise"). Every file:line below was read and re-read; red-team corrections are folded in.

---

## TL;DR — there are TWO independent problems, and a clipper sees a third

The page derives **every** visible number from exactly three sources (`page.tsx:139-141`):
`api.influencers.listByCreator` · `api.campaigns.listByCreator` · `GET /api/agent-wallet-balance`.

1. **IDENTITY (blocks 100% of agent/campaign stats for this user).** `listByCreator({creatorWallet: <single active wallet>})` returns `[]` → `agents.length = 0` → every reduce/maturity/projection collapses to 0. `pSZM…ipyb` is a **Privy embedded wallet**; the agents were almost certainly minted under a *different* wallet string (`creatorWallet` is pinned at mint to whatever wallet was SIWS-signed then — `nft/mint/route.ts:142-145`). A user-level wallet set already exists (`profile.walletAddresses`) but the page never queries with it.
2. **VALUE (fields are dead/blocked even once agents appear).** `influencers.tvl` has **no live writer** — real locked USDC lives in `agentAccount.escrowUsdc`, which the dashboard never reads. `monthlyEarnings` **is** correctly wired to the real `distributions` ledger, but only campaign/hire payouts feed it — **content-reward clips never do**.
3. **For the flagship "clipping-agent owner": even after fixes 1+2, the money cards stay `$0`.** A clip-only agent is never vault-funded (`escrowUsdc = 0`) and earns nothing into `distributions` (no content-reward → earnings rail exists). **Delivering a non-zero portfolio/earnings number for a clipper requires a new content-reward payout rail (§4 Step 7), which is the real product gap.**

> Honest scope statement (red-team completeness mandate): without Step 7, this spec moves the dashboard from **"everything fabricated-$0"** to **"correct agent/campaign counts + real wallet balance + still-$0 money cards"** for a clip-only owner. That is a real improvement and removes the fake-data liability, but it does **not** by itself show clip earnings. Step 7 is what shows clip earnings, and it is upstream-blocked on a settlement decision.

---

## 1. Current reality table (corrected)

| UI stat | page.tsx | backing field / API | verdict | why |
|---|---|---|---|---|
| Available balance (USDC) | 237 | `GET /api/agent-wallet-balance?wallet=<connected>` → `usdc` | **real** | live ATA read of the connected wallet |
| SOL line | 243 | same API → `sol` | **real** | live `getBalance` |
| Net worth "Cash" | 269 | `usdc` | **real** | same live balance |
| Net worth "Holdings" | 269 | `sum(agent.tvl)` | **unwired** | `tvl` has no live writer (always 0) |
| Net worth total | 189 | `usdc + sum(tvl)` | **partial** | cash half real, holdings half dead-zero |
| Portfolio value / "USDC locked in agents" | 168, 313 | `sum(agent.tvl)` | **unwired + mislabeled** | real locked USDC is `agentAccount.escrowUsdc` (never read); label conflates with on-chain holdings |
| AI agents / "N NFTs owned" | 314, 360 | `agents.length` | **real, identity-blocked** | honest count; `[]` on wallet mismatch |
| Campaigns card | 315 | `campaigns.length` | **real, identity-blocked** | same single-wallet join key |
| "N submissions" | 172, 315, 458 | `sum(campaign.submissionsCount)` | **real (over-counts)** | accurate counter (`campaigns.ts:300-309`) but counts JOIN rows incl. pending, not just posted deliverables |
| per-campaign "$X treasury" | 458 | `campaign.budget` | **partial** | creator-declared; on-chain escrow lock is soft-fail (`campaign-form.tsx:773-777`) so often unbacked |
| per-campaign status badge | 460 | `campaign.status` | **stale** | hardcoded `"open"` at create (`campaigns.ts:236`), never transitioned anywhere |
| Annual projection | 170, 316 | `sum(monthlyEarnings)*12` | **real-wired, usually 0** | only campaigns/hires feed it; 0 for clip-only agents |
| est. APR | 171, 277 | `annual / sum(tvl)` | **broken** | denominator `tvl=0` → 0% even with real earnings |
| monthly /mo | 169, 273 | `sum(monthlyEarnings)` | **real-wired, usually 0** | no campaign/hire payout for this user |
| Agent maturity % | 176-184 | `_creationTime` + `monthlyEarnings>0` + `tvl>0` | **partial** | ageScore real; earnScore real-but-0; fundScore broken (reads dead `tvl`) |
| Earnings projection bars | 191-196, 335 | `monthly * {1,3,6,12}` | **real-wired, usually 0** | inherits `monthlyEarnings` |
| per-agent TVL | 400 | `inf.tvl` | **unwired** | dead field |
| per-agent Monthly | 401 | `inf.monthlyEarnings` | **real-wired, usually 0** | ledger-derived |
| per-agent APR | 382, 402 | `monthlyEarnings*12 / tvl` | **broken** | `tvl=0` denominator |

**Fabricated writers that must NOT be trusted** (all dead/gated — verified): `influencers.invest` (`influencers.ts:327-330`, `monthlyEarnings = floor(tvl*0.08*…)`) is `INTERNAL_CRON_SECRET`-gated (line 304); its only UI caller `share-purchase-dialog.tsx:118` passes no `authSecret` → throws. `tickEarnings` (RNG growth) has no caller. `admin.updateAgentData`/`updateAgent` are admin-only manual overrides. **None of these is a real data path; do not wire off their formulas, and do not trust the `50/45/5` split comments at `schema.ts:628` / `distributions.ts:94` — `distribute-earnings/route.ts:72-74` actually records `investorUsdc = full amount, builderUsdc = 0, protocolUsdc = 0`.**

---

## 2. Root causes (ordered by stats blocked)

### RC-1 — IDENTITY: ownership keyed on a single mutable wallet (blocks ALL agent/campaign stats)
`page.tsx:139-140` queries with one address = `useUnifiedSolanaWallet().publicKey.toBase58()`, which resolves `privyPk ?? adapterPk` where `privyPk` = the **most-recently-verified** linked wallet (`hooks/use-solana-wallet.ts:115-117`, `lib/solana/activeWallet.ts:85-96`). `influencers.creatorWallet` was pinned at mint to whatever wallet was active + SIWS-signed (`nft/mint/route.ts:142-145`, enforced by `requireOwnerWithSiws`). When those differ, `listByCreator` (strict `by_creator` eq, `influencers.ts:207-226`) returns `[]`.
**A user-level wallet bridge already exists:** `walletLinks` (`schema.ts:35-36`) → `users.whoami` → `WhoAmI.walletAddresses` (`users.ts:193, 218`) → surfaced as `profile.walletAddresses` on the auth provider (confirmed by `supabase-auth-provider.tsx:270` comment). **Red-team correction:** the wallet page imports and calls `useSupabaseAuth()` but at `page.tsx:136` destructures **only** `promptLogin` — `profile` is *not* in scope. The fix is two edits (add `profile` to the destructure **and** change the query key), not a one-line swap. There is **no** callable `users.listLinkedWallets` API (it's a private helper at `users.ts:73-86`); the wallet set reaches the client only via `whoami` → `profile.walletAddresses`.

### RC-2 — VALUE: `tvl` is wired to a dead column (blocks Portfolio, Holdings, per-agent TVL, APR denominator, maturity fundScore)
The live invest path `/api/market/buy-shares → shares.buyShares` patches `agentAccount.{escrowUsdc, liquidUsdc, sharesOutstanding}` (`shares.ts:66-71`) and **never** `influencers.tvl`. Campaign payouts (`earnings.creditEarnings`, `earnings.ts:24-29`) also bump `escrowUsdc`, never `tvl`. So `tvl` is permanently 0 via any genuine flow. The real "USDC locked" number is `agentAccount.escrowUsdc` (`schema.ts:669`), reconciled to the agent wallet's live on-chain balance by `reconcileImpl` (`agentAccount.ts:52-92`). **`agentAccount` is indexed `by_mint` only** (`schema.ts:682`) — no `by_creator` — so any per-owner read must join `influencers.by_creator → agentAccount.by_mint`.
**Dead-rail isolation (the spec's strongest property — state it explicitly):** `escrowUsdc` is patched **directly in Convex** against a plain agent keypair wallet. It does **NOT** route through the dead `vello-escrow` program / stale IDL. So the value fix (Step 2) is **not** blocked by the on-chain campaign-treasury deployment, unlike Steps 6 and 7(a).

### RC-3 — VALUE: `monthlyEarnings` is real-wired but never fed for content-reward clips (blocks every earnings/projection/APR-numerator stat for clippers)
`monthlyEarnings` is correctly derived from the `distributions` ledger by `addEarnings` (trailing-30-day sum, `influencers.ts:426-441`) and `recordHireEarning` (`influencers.ts:452-503`). But `addEarnings` is only reached from `app/api/agents/distribute-earnings/route.ts:79`, fetched only by the **campaign** v1 dispatch (`campaigns.markVerified:473`) and the **v2 oracle claim keeper** (`oracle/claim/route.ts`). The content-reward clip path writes a `contentRewardMeasurements` row that is **display-only** (`schema.ts:236-240`: "NEVER carries money; cannot trigger a payout") and never credits `distributions`. So for a clip-only owner, `monthlyEarnings = 0` is **correct, not a bug** — until a content-reward payout rail exists.

### RC-4 — Secondary
- `campaign.status` frozen `"open"` (no lifecycle anywhere).
- `budget` is **declared**, not necessarily on-chain-backed (escrow lock soft-fails).
- `useOnchainBalance` collapses `ok:false` (RPC 429/timeout) to `$0` (`page.tsx:46-49`), defeating the route's deliberate "never a confident zero" contract (`agent-wallet-balance/route.ts:74-78`).
- `NEXT_PUBLIC_HELIUS_API_KEY` / `NEXT_PUBLIC_SOLANA_NETWORK` are **build-baked**; an unset/`devnet` default zeroes a mainnet USDC balance even though the card is "real".

---

## 3. Decisions required BEFORE building (red-team made these hard prerequisites)

| # | Decision | Recommendation | Affects |
|---|---|---|---|
| D1 | What does "Portfolio value / USDC locked in agents" mean? gross `escrowUsdc` (whole vault = investors' capital + credited earnings) · owner's invested principal · owner's NAV stake (`shares*navPerShare`) | **gross `escrowUsdc`**, and **relabel** the card to "Agent treasury (TVL)" so it doesn't imply the owner's personal money | Step 2 |
| D2 | Scope the dashboard by **wallet set** (Step 1 union) or **Privy account DID** (Step 9)? | **Wallet-set union first** (cheap, no migration); add DID only if M0 shows unlinked-wallet orphans | Steps 1, 9 |
| D3 | Does "N submissions" count all join rows (incl. pending) or only verified/approved? | Keep all rows for now; **relabel to "joins"** or filter by status in a follow-up | Step 5 |
| D4 | **Content-reward settlement: on-chain v2 (revive IDL) or off-chain v1 credit?** (every earnings stat hinges on this) | **Off-chain v1 credit** in the content-reward settle path — does not depend on the dead IDL; can ship now | Step 7 |
| D5 | `monthlyEarnings` shows **realized** (`paidUsdc`, lags claim keeper) or **owed/estimated** (`approved payoutAmountUsdc`, immediate)? | Keep **realized** (settled-ledger 30-day, what `addEarnings` already does) for honesty | Step 7 |
| D6 | Aggregate **cash/SOL** across the wallet-set union too, or keep balance on the single active wallet? | **Aggregate across the same union** via the existing batch route so Net worth isn't "1-wallet cash + N-wallet holdings" | Steps 1, 4 |

---

## 4. The wiring plan (dependency-ordered, with deploy gates and blast radius)

> **Deploy gate (applies to every backend step — red-team feasibility):** Convex functions ship via `npx convex deploy`; the Next app ships via a **separate Railway redeploy**. A partial deploy is *worse than nothing* — the moment `page.tsx` calls a new `api.influencers.listByCreators` that prod Convex doesn't have, the page **throws**. Order every milestone: **Convex deploy → verify function exists → Next redeploy.** (This project has a documented history of "pushed to main, not deployed" no-ops.)

### Step 0 (M0) — DIAGNOSE, non-skippable gate — **S**
Run a one-off read script (`apps/web/scripts/diag-owner-agents.mjs`) comparing **every** `influencers.creatorWallet` against (a) the user's `profile.walletAddresses` and (b) `pSZM…ipyb`. Also confirm the prod `NEXT_PUBLIC_SOLANA_NETWORK` matches where the user's USDC lives. Branch the whole plan on the result:

```
M0 result                                            → required path
──────────────────────────────────────────────────────────────────────
(b1) agents exist under a LINKED wallet              → Step 1 fixes it
(b2) agents exist under an UNLINKED external wallet  → Step 1 misses them; Step 9 SIWS claim REQUIRED
(b3) no agents under ANY of the user's wallets       → user genuinely never minted; only a real mint helps (spec is a no-op for this user)
(env) balance reads $0 on mainnet                    → NEXT_PUBLIC_* env/redeploy issue, independent of all Convex wiring
```

### Step 1 (M1) — IDENTITY: query the user's full linked-wallet set — **M**
1a. **New Convex queries** `listByCreators({ creatorWallets: v.array(v.string()) })` in `influencers.ts` and `campaigns.ts`: loop the existing `by_creator` index per wallet, union, dedup by `mintAddress` / `_id`. **No schema change, no new index, no backfill.**
1b. **`page.tsx:136`** — add `profile` to the destructure: `const { promptLogin, profile } = useSupabaseAuth();`.
1c. **`page.tsx:139-140`** — pass `dedupe([...(profile?.walletAddresses ?? []), connectedPubkey])`; `"skip"` when empty.
1d. **`page.tsx:18`** — the `Agent`/`Campaign` type aliases reference `FunctionReturnType<typeof api.influencers.listByCreator>`; repoint them at `listByCreators` (or a shared row type) to avoid type drift.
- **Caveat (b2):** the union only recovers wallets in `profile.walletAddresses`. `whoami` auto-links **only the active Privy wallet per session** (`users.ts:207-217`); a pure wallet-adapter external wallet used at mint is **never auto-linked**, so it stays invisible until the user explicitly links it (`users.linkWallet`) or Step 9's claim runs. The spec must not assume the mint wallet is already in `walletLinks`.
- **Cross-surface note:** the same single-wallet `listByCreator` powers `studio/page.tsx:113`, `studio/build/page.tsx:338`, `campaign-detail.tsx:274`, `AgentWorkspace.tsx:599`. They stay identity-blocked unless they also adopt `listByCreators`. Decide consciously; recommend a fast-follow to switch all owner surfaces.

### Step 2 (M2) — VALUE: make `tvl` reflect real escrow. **Prefer the write-time MIRROR over a read join** — **M**
Two options; **recommend the mirror** because the read-join hits the 5 `listByCreator` consumers and the whole-table market query.

- **2A (RECOMMENDED) — denormalized mirror.** Wherever `agentAccount.escrowUsdc` changes, also patch the influencer row's `tvl`:
  - `shares.buyShares` (`shares.ts:66-71`), `earnings.creditEarnings` (`earnings.ts:24-29`), `shares.redeemShares` (`shares.ts:118-123`), and `agentAccount.reconcileImpl` (`agentAccount.ts:84`) → `ctx.db.patch(influencerId, { tvl: newEscrowUsdc })`.
  - One-off backfill `internalMutation`: for each influencer, set `tvl = its agentAccount.escrowUsdc`.
  - **Zero reader changes** — `page.tsx`, studio, market, campaign-detail, AgentWorkspace all keep reading `i.tvl`, now real. No extra reads per query. Single logical source (`escrowUsdc`) with `tvl` as its projection.
- **2B (alternative) — computed read join.** In `listByCreator`/`listByCreators`, convert the **synchronous** `.map(({agentWalletSecret, ...rest}) => rest)` (`influencers.ts:223-224`) to a `Promise.all` async map and override `tvl = (agentAccount by_mint).escrowUsdc ?? 0`. Single source of truth, no denormalization — but adds N point-reads to **every** `listByCreator` consumer and changes the return shape. Acceptable for the small per-creator query; **do not** copy this pattern into `getMarketStats`.

Either way this fixes Portfolio value, Net-worth Holdings, per-agent TVL, the APR **denominator** (171, 382), and maturity **fundScore** (181) — with **no `page.tsx` value-logic change**.
- **Semantics (D1):** `escrowUsdc` = whole vault (all investors + credited earnings − redemptions), not the owner's money. Relabel "USDC locked in agents" → "Agent treasury (TVL)".
- **Mirror-lag caveat:** `escrowUsdc` is exact for `buyShares`/`creditEarnings`; a **direct on-chain top-up** to an agent wallet only reflects after a reconcile/settle event (`settleAgent`, `clip-precheck`). If owners fund agent wallets directly, add a periodic `reconcileEscrowToOnchainServer` cron (`agentAccount.ts:101`) — Step 2C, optional, **M**.
- **Clip-only reality:** a clip agent never vault-funded has `escrowUsdc = 0`, so this turns a *fabricated* $0 into a *real* $0. Non-zero TVL appears only for vault-funded agents. (Real clip "portfolio" needs Step 7.)

### Step 3 (M2) — market parity, done safely — **S**
Make `/market` read real escrow too. **Do NOT** reuse Step 2B's per-row join here — `getMarketStats` (`influencers.ts:271-288`) does a whole-table `ctx.db.query('influencers').collect()`; adding a per-row `by_mint` lookup makes it O(allAgents) reads and risks Convex read/bandwidth limits as agents grow. **If Step 2A (mirror) is chosen, `getMarketStats` needs no change** — it already reads `i.tvl`, now real. (This is another reason to prefer 2A.)

### Step 4 (M1) — balance false-zero + optional cash aggregation — **S**
`page.tsx:46-49` `useOnchainBalance`: track an `unavailable` state when `data.ok === false`; render `—`/retry instead of `$0.00` on Available-balance and Cash. Per D6, optionally aggregate cash/SOL across the **same** wallet-set union via the existing batch route `POST /api/agent-wallet-balances` (`agent-wallet-balances/route.ts:49-112`, 20s cache + `getMultipleAccountsInfo`) so Net worth isn't "1-wallet cash + N-wallet holdings". **When aggregating N wallets, preserve the unavailable-vs-real-0 distinction** or a rate-limited Helius read renders a confident false $0.

### Step 5 (M3) — derive real campaign status — **S**
In `campaigns.listByCreator`/`listByCreators` (`campaigns.ts:176-184`) map a derived `status` onto returned rows: `deadline` (ISO string — parse) passed → `ended`; `(spentUsdc ?? 0) >= budget` → `completed`; else `open`. The badge (`page.tsx:460`) already styles non-`open` grey. Safe — `campaigns.listByCreator` has **exactly one** app consumer (the wallet page). Caveat: `spentUsdc` is a post-claim mirror, so `completed` can lag for v2 campaigns.

### Step 6 (M3) — declared vs funded budget — **S (UI) / L (true backing)**
`page.tsx:458`: show `budget` but flag `!c.pdaAddress` as "declared · not locked"; optionally show `remaining = budget − (spentUsdc ?? 0)`. True on-chain backing requires reviving the escrow rail (regenerate IDL + `anchor build`/deploy/init) — **out of scope here**, tracked as the L prerequisite.

### Step 7 (M4) — content-reward earnings rail (the real product gap; UNBLOCK per D4) — **L**
This is what actually makes `monthlyEarnings` (and thus monthly/annual/APR-numerator/projections/per-agent Monthly/maturity-earnScore) non-zero **for a clipper**. Per D4, take the **off-chain v1 credit** route (does not depend on the dead IDL):
- When a content-reward clip's reward USDC is **realized** for an agent, insert a `distributions` row (`api.distributions.record`, `source:'content-reward'`, `submissionId = ryze submission id` for idempotency) and call `api.influencers.addEarnings` (which already recomputes the 30-day window). Files: `apps/web/lib/server/contentRewardApprove.ts` + the measure/settle path (`oracle/measure-views`, `oracle/backfill-measurements`).
- The on-chain v2 alternative (D4 not taken): deploy escrow per `docs/campaign-treasury/03-INTEGRATION-HANDOFF.md`, create campaigns with `pdaAddress` + `onchainVersion >= 2`; then `internal.campaigns.getFundedByContentRewardId` (`campaigns.ts:109-129`, **called from** `clipJobs.ts:1736`) returns non-null → `api.submissions.submitClipToCampaign` (defined in `submissions.ts`, **call site** `clipJobs.ts:1739`) → oracle/claim → `distribute-earnings:79` → `addEarnings`.
- **Hard rule:** credit **only** on a real realized-payout signal. Do not fabricate distributions rows. This step is **upstream-blocked until the "what counts as a realized clip payout" rail is built/decided** — it is the prerequisite for the dashboard ever showing clip earnings, and it is the single most important item for the actual product.

### Step 8 (M2) — neutralize fabricating writers (cleanup) — **S**
Retire `influencers.invest` (`290-357`) and `tickEarnings` (`370-392`). **Confirm `share-purchase-dialog.tsx` is unmounted (grep its imports/usages) before deleting** — the verify pass flagged "needs a mount check"; the throwing `invest` call at `:118` is confirmed but its render status is not. After Step 2A, optionally drop the `influencers.tvl` *write* paths but **keep the column** (it's now the mirror target).

### Step 9 (M5) — account-stable ownership + SIWS claim (REQUIRED for M0 branch b2) — **L**
Promote from "optional" to **required when M0 = b2**. Add `influencers.ownerDid: v.optional(v.string())` (Privy `user.id`) + `.index("by_owner", ["ownerDid"])`; write `ownerDid` at mint from `auth.user.id` in `nft/mint/route.ts` (available via `requireInternalOrUserAuth`); add `listByOwner({did})`; mirror on `campaigns`. Plus a SIWS "claim" route: a caller presenting a wallet that `=== creatorWallet` stamps `ownerDid`, recovering agents minted under wallets never linked to Privy. Caveat: cron/internal mints have no `user` → no `ownerDid` → still rely on the SIWS claim.

---

## 5. Data-model additions

| Step | Change | Schema migration? |
|---|---|---|
| 1 | new `listByCreators` query, reuses `by_creator` (`schema.ts:182`) | **none** |
| 2A | patch `influencers.tvl` at 4 escrow-write sites + one-off backfill; reuses existing `tvl` column (`schema.ts:80`) | **none** (column already exists) |
| 2B (alt) | none — read-join via `agentAccount.by_mint` (`schema.ts:682`) | none |
| 5 | derived at read time | none |
| 7 | reuse existing `distributions` table (`schema.ts:630-661`) | **no new table** |
| 9 (b2 only) | `influencers.ownerDid` + `.index("by_owner")`; mirror on `campaigns`; backfill mapping `creatorWallet → user` | **yes** |

---

## 6. Milestones + acceptance criteria (what becomes non-zero-real vs stays real-$0)

| Milestone | Steps | Ships | Acceptance: for a **clip-only owner** | Acceptance: for a **vault-funded / campaign-paid owner** |
|---|---|---|---|---|
| **M0** gate | 0 | diag script + env check | Determines branch b1/b2/b3 + whether balance env is correct | same |
| **M1** identity + balance | 1, 4 | Convex deploy → Next redeploy | Agent/campaign **counts**, submissions, and (real) **balance** appear; money cards still $0 | counts + balance appear |
| **M2** real TVL | 2(A), 3, 8 | Convex deploy → Next redeploy | Portfolio/Holdings/per-agent TVL/APR-denom = **real $0** (no vault funding) | Portfolio/Holdings/TVL/APR-denom **non-zero real** |
| **M3** polish | 5, 6 | Convex deploy → Next redeploy | real campaign status + declared/funded budget flag | same |
| **M4** clip earnings (core) | 7 | Convex deploy → Next redeploy (after rail decision) | monthly/annual/APR/projections/maturity-earnScore become **non-zero real** | also benefits |
| **M5** stable ownership | 9 | Convex deploy + migration → Next redeploy | recovers agents under unlinked wallets (b2) | same |

**Dependency edges:** M0 gates everything. M2 is pointless before M1 (no rows to join). M4 is independent of M1/M2 but is the only path to clip earnings. M5 only if M0 = b2.

**The one-line truth for the reporting user (`pSZM…ipyb`, a clipper):** M0→M1 makes their agents/campaigns/balance appear (if data exists under a resolvable wallet); **M4 is what makes their earnings non-zero.** M2 only helps if they are also vault-funded.

---

## 7. Risks, assumptions

**Risks**
- **M1 misses unlinked external wallets** (b2) → needs M5 SIWS claim. The mint wallet must somehow enter `walletLinks`; `whoami` only auto-links the active Privy wallet.
- **Step 2 semantic conflation** — `escrowUsdc` is the whole vault, not the owner's stake (owner's real claim is the ~15% founder-share accrual). Mitigated by the D1 relabel.
- **Mirror drift (2A)** — must patch `tvl` at *all* escrow-write sites; a missed site silently desyncs. The backfill + the bounded 4-site list mitigate.
- **Net-worth mixing** — resolved by D6 (aggregate cash across the union) or by relabeling balance "active wallet".
- **Deploy no-op** — backend steps invisible (or throwing) until `npx convex deploy` + Railway redeploy; partial deploy throws.
- **Status lag** — `spentUsdc` is a post-claim mirror.

**Assumptions (each must hold or the corresponding step degrades)**
- `pSZM…ipyb` is a Privy embedded wallet and the user owns agents under a *different resolvable* wallet (confirm in M0; if b3, only a real mint helps).
- The campaign/hire earnings rail (`distribute-earnings → addEarnings`) is live in principle — just unexercised for this user.
- Reviving the on-chain escrow program is **out of scope**; it is the prerequisite only for Step 6 (true budget backing) and the *on-chain* variant of Step 7. The recommended off-chain Step 7 and all of Steps 1-5/8 do **not** depend on it.

---

## 8. What this spec deliberately does NOT fix
- True on-chain-locked campaign treasury backing (needs the dead escrow rail revived).
- Clip earnings without a realized-payout signal (Step 7 is the gate; no fabrication).
- Owner-vs-investor stake decomposition (Portfolio shows the whole agent treasury per D1).
- The non-`/wallet` owner surfaces (studio, builder, campaign-detail) unless they also adopt `listByCreators` (recommended fast-follow).

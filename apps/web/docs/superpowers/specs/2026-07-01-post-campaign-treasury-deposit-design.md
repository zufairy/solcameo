# Post Campaign → Treasury Deposit: UX + Reliability Redesign

**Date:** 2026-07-01
**Status:** Approved design → implementation
**Area:** Campaign posting flow (`/stage/create`), on-chain escrow funding, on-ramp
**Branch:** `feat/post-campaign-treasury-deposit`

---

## 1. Problem

The "Post Campaign" flow (`/stage/create`, rendered by `apps/web/components/campaign/campaign-form.tsx`) has three problems the user wants fixed together:

1. **Double-charge on retry (the "fund the agent twice" report).** `onSubmit` (`campaign-form.tsx:697`) always:
   - inserts a **new** campaign row via `createCampaign` (`:729` → `convex/campaigns.ts:225`), then
   - funds a **new** escrow PDA via `createCampaignTx` (`:782` → `lib/escrow.ts:111`) — a single `.rpc({commitment:"confirmed"})`.

   On **any** failure — including a confirmation *timeout* where the transaction actually landed on-chain — the catch (`campaign-form.tsx:792-802`) shows the actively-misleading copy *"Vault not funded — the USDC did not reach the on-chain vault"* and resets to `idle`. A second Launch click re-enters `onSubmit`, inserts **another** campaign row (new `convexId` → new PDA, `escrow.ts:123`) and funds a **second** escrow. The user is debited twice into two different vaults. There is **no idempotency, no resume, and no on-chain verification** before re-prompting.

   Verified: a single Launch click prompts the wallet **exactly once**. The new `app/api/agents/fund-vault/route.ts` is unrelated — it funds an *agent compute vault* (different program), is server-signed by `PLATFORM_VAULT_AUTHORITY_SECRET`, admin-gated, and has **no client caller**. So this is a retry artifact, not a two-prompt-per-click flow.

2. **The money model isn't framed as a deposit.** The user wants "Total budget (USDC)" to read as an explicit **deposit into an auto-created per-campaign treasury**, funded with Solana USDC, at a USDC-denominated rate. Functionally the escrow PDA already *is* an auto-created per-campaign vault — this is a framing + reliability + pre-flight change, not a new on-chain model.

3. **The Halal-only campaign checkbox should be removed entirely** (Image 3), across the whole app.

Additional blocker found during recon:
- **`buildEscrowProgram()` hardcodes devnet RPC** (`lib/escrow.ts:15-17, 52`) regardless of `NEXT_PUBLIC_SOLANA_NETWORK`. On mainnet it would sign against devnet. Must be network-aware for the mainnet-ready requirement.

## 2. Goals

- Kill the double-charge: launch is **idempotent, resumable, and verifies on-chain before ever re-prompting**.
- Reframe Step 3 as a **campaign treasury deposit** with an honest cost/escrow summary.
- **Pre-flight review**: check USDC + SOL balances before the wallet prompt; guide funding if short.
- **On-ramp funding** via a swappable provider layer, **Transak** first adapter, **gated to mainnet**.
- **Remove halal everywhere** (`isHalalOnly`, `isHalal`, `isHalalCompliant`).
- Make the escrow client **mainnet-ready** (network-aware RPC).

## 3. Non-goals

- Persistent per-user treasury (decided: **per-campaign** vault, reuse existing escrow). 
- Cross-chain USDC bridge (CCTP) — deferred; on-ramp only for v1.
- Deploying/verifying the escrow program on mainnet, `PlatformConfig` mainnet init, custody/multisig — these are **ops/deploy steps**, out of this code scope. We build mainnet-ready and devnet-testable.
- A physical Convex migration to drop halal columns (fields go optional now; a column-drop migration is an optional later cleanup).
- Reworking oracle/payout/claim cranks (`recordPerformanceTx`/`claimPayoutTx`) — untouched.

## 4. Design

### Unit 1 — Nuke halal everywhere

Three **separate** attributes; all removed:
- `isHalalOnly` — campaign-side (the checkbox).
- `isHalal` — agent/influencer "Halal Certified" toggle.
- `isHalalCompliant` — trader strategy screen.

**Campaign (`isHalalOnly`):**
- Delete checkbox JSX — `campaign-form.tsx:1244-1250`.
- Delete Zod field `:132`, `defaultValues` `:672`, and the `createCampaign` arg `:745`.
- `convex/campaigns.ts`: drop `isHalalOnly` from the `create` args validator (`:244`) and the read validator (`:32`).
- `convex/schema.ts:239`: `isHalalOnly: v.boolean()` → `v.optional(v.boolean())` (keeps existing docs valid; new writes omit it).
- Read/passthrough: remove from `app/stage/page.tsx:137`, `app/stage/[id]/page.tsx:55`, `lib/types.ts:91`.
- **Matcher (behavioral):** delete the hard filter `campaign-scanner.tsx:132` (`if (c.isHalalOnly && !inf.isHalal) return null;`) and the `+10` bonus `:171`.
- Agent prompt/catalog: remove the "Respect `isHalalOnly`" line in `lib/builder/skillsCatalog.ts` (verify exact line at implementation time).

**Agent/influencer (`isHalal`):**
- UI: `app/studio/agent/[id]/edit/page.tsx` "Halal Certified" toggle (`:247-259`, plus `:58,75`); admin `components/admin/agents-section.tsx` (`:22,63,79,137-140`); wizard `store/wizard.ts:43,66`; `components/studio/step-launch.tsx:100`; `app/workers/create/page.tsx:69,105`.
- Reads: `app/market/[id]/page.tsx:42`, `app/workers/[id]/page.tsx:50`, `app/workers/page.tsx:45`, `app/workers/hire/[id]/page.tsx:50`, `lib/types.ts:30,133`.
- Convex: `influencers.ts:609,633`, `workers.ts:43,77`, `admin.ts:134,210`, `nftAgents.ts:190`, `users.ts` (verify). `schema.ts:98` → optional.

**Trader (`isHalalCompliant`):**
- Remove the field from `traderStrategies.ts` args + writes (`:17,34,49`); `schema.ts:813` → optional. Delete the halal-screen from `lib/trader/tradeRouter.ts` (`isHalalSafe`/`halalCompliant` param and the `"halal-block"` venue, `:20-77`) so no asset is ever halal-blocked. (Trader is a de-prioritized product per project history; removed for consistency with "nuke everywhere.")

**Tests/mocks:** update fixtures so suites stay green — `convex/campaigns.test.ts:36`, `oracle.test.ts:20`, `replay.test.ts:49,24`, `submissions.test.ts:29,376`, `walletStats.test.ts:32,178`, `walletSecret.test.ts:37`, `workers.test.ts:23`, `adminEconomy.test.ts:175`, `lib/mock-data.ts:135,153,171`.

> The exact grep-driven site list is regenerated at implementation time (`grep -ri halal apps/web --exclude-dir=docs`) so nothing is missed; the above is the recon baseline.

### Unit 2 — Reliable, idempotent, resumable launch

Rework `campaign-form.tsx:onSubmit` into a state machine that **never funds twice**.

**New `Step` union** (extends `campaign-form.tsx:152`):
```
"idle" | "resuming" | "creating-convex" | "preflight" | "funding-wallet"
       | "signing-escrow" | "verifying" | "finalizing" | "done"
```

**Draft reuse (in-session idempotency):**
- Hold the created `convexId` in a ref/state. Once set, a retry **does not insert again** — it reuses the same row and the same deterministic PDA (`getCampaignPda(convexId, wallet)`).

**On-chain verify before/after funding (the core fix):**
- A helper `checkVaultFunded(convexId, wallet, budget)` derives the PDA and calls **`getEscrowBalance(connection, pda)`** (`escrow.ts:455`, raw SPL balance — works regardless of IDL regen). Returns `funded` when balance ≥ budget (minus dust tolerance).
- Before prompting `createCampaignTx`: if `checkVaultFunded` → **skip funding**, go straight to `finalizing` (`updateCampaignPda` v2). Prevents re-funding a vault that a prior timed-out attempt already filled.
- In the catch after `createCampaignTx` throws: **re-run `checkVaultFunded`**. If now funded (the classic "confirmed timeout but landed" case) → treat as success → `finalizing`. Only if still unfunded → show an honest error.

**Resume-on-reload:**
- New Convex query `campaigns.listDraftsByCreator(creatorWallet)` returning open campaigns with **no `pdaAddress`** and `onchainVersion !== 2` (unfunded drafts).
- On form mount, if a draft exists, show a non-blocking banner: *"You have an unfinished campaign deposit — Resume or Discard."* Resume loads it into the flow (reusing its `convexId` + PDA); Discard leaves it (optionally cancels).
- Because reuse skips the `create` insert, the fire-and-forget `pretranscribe`/`autoLinkContentReward` scheduling (`campaigns.ts:291-298`) is **not** re-triggered on retry (no duplicate work).

**Honest error copy:** replace the blanket *"Vault not funded — the USDC did not reach the on-chain vault"* (`:797`) with state-accurate messages:
- Confirmed-timeout-but-unverified: *"We couldn't confirm your deposit yet. If your wallet shows it was sent, click Resume — we'll verify on-chain and never charge you twice."*
- True send failure (balance still 0): the specific reason (insufficient USDC / SOL / program error), never a re-charge prompt.

**Concurrency:** the submit button stays `disabled={submitting}` (`:1284`); `submitting` now also true during `resuming`/`verifying`/`funding-wallet`.

### Unit 3 — Treasury reframe (Step 3 UX)

- Relabel field: "Total budget (USDC)" → **"Deposit into campaign treasury (USDC)"**.
- Add an **escrow summary card** near the deposit input:
  > "You deposit **$X USDC** into this campaign's on-chain treasury. Agents earn **$Y per 1,000 views** from it until it's drained. Funds release only on verified, approved work — you can reclaim the remainder after the deadline."
- Update `stepLabel()` (`:154-161`): `signing-escrow` → "Approve deposit in wallet…"; `finalizing` → "Locking treasury…" (already close); add labels for `verifying` ("Confirming on-chain…"), `resuming`, `funding-wallet`.
- Keep "Rate per 1K views (USDC)" and the existing 6-hour deadline min (`:143`, program `MIN_CAMPAIGN_DURATION_SECS`).
- The right-side live preview ("What agents see", `PreviewPanel`) keeps its `ESCROW $X` badge; align its wording to "Treasury".

### Unit 4 — Pre-flight review

- Extend the USDC client with a SOL-balance read (new `useWalletSol()` alongside `useWalletUsdc()` in `lib/client/usdcClient.ts:31`), or a combined `useWalletFunding()` returning `{ usdc, sol }`.
- New `preflight` step (or an inline panel) before `signing-escrow`, showing: *depositing **$X** · you hold **$Y USDC** · **$Z SOL** for gas.*
- Gate the wallet prompt:
  - `usdc < budget` → block, surface the **Fund wallet** path (Unit 5, mainnet) or faucet (devnet).
  - `sol < gasFloor` (e.g. ~0.01 SOL for the tx + potential ATA rent) → warn/block with the same funding guidance.
- Reuse the existing insufficient-balance messaging pattern from `sendUsdc` (`usdcClient.ts:92-99`).

### Unit 5 — On-ramp funding (Transak, provider-agnostic, mainnet-gated)

- **Interface** `lib/client/onramp/types.ts`:
  ```ts
  interface OnrampProvider {
    id: string;
    open(opts: {
      walletAddress: string;
      fiatCurrency?: string;   // default "MYR"
      cryptoAsset: "USDC";
      chain: "solana";
      suggestedAmountUsd?: number;
      onSuccess?: (o: { orderId?: string }) => void;
      onExit?: () => void;
    }): void | Promise<void>;
  }
  ```
- **Transak adapter** `lib/client/onramp/transak.ts` using `@transak/transak-sdk`: `apiKey = NEXT_PUBLIC_TRANSAK_API_KEY`, `environment` from `NEXT_PUBLIC_TRANSAK_ENV` (STAGING default), `defaultCryptoCurrency: "USDC"`, `network: "solana"`, `walletAddress`, `fiatCurrency`, `defaultCryptoAmount/defaultFiatAmount`.
- **Selector** `lib/client/onramp/index.ts`: pick by `NEXT_PUBLIC_ONRAMP_PROVIDER` (default `transak`). MoonPay/Coinbase adapters can be added later behind the same interface.
- **UI:** a **"Fund wallet"** button in the pre-flight panel, rendered only when USDC/SOL is short **and** the network is mainnet (`isMainnet(NEXT_PUBLIC_SOLANA_NETWORK)`). On devnet, show the faucet hint (`faucet.circle.com`) instead.
- **Source of truth = on-chain balance.** After the widget's `onSuccess`/`onExit`, poll `useWalletFunding().refresh()` until the deposit lands (bounded, e.g. up to ~2 min), then re-run pre-flight. **No Convex webhook required for v1** — the deposit is confirmed by reading the wallet's SPL balance, which the app already does.

### Unit 6 — Mainnet-readiness fix

- `lib/escrow.ts`: replace the module-level `DEVNET_RPC` (`:15-17`) usage in `buildEscrowProgram` (`:52`) with the network-aware RPC (`getRpcUrl(getNetwork())` from `lib/solana/network.ts`, the same source `usdcClient.ts` uses), so the provider's cluster matches `getEscrowUsdcMint()`'s cluster. Any client passing a `Connection` for `getEscrowBalance` must also use the network-aware RPC.

## 5. New launch state machine (data flow)

```
idle
 └─(mount)→ resuming? ──has draft──> banner: Resume / Discard
 └─(submit)→ creating-convex        # insert once, OR reuse existing convexId
          → preflight               # read {usdc, sol}; if short → funding-wallet
          → funding-wallet?         # Transak (mainnet) / faucet (devnet) → back to preflight
          → signing-escrow          # checkVaultFunded? skip→finalizing : createCampaignTx (ONCE)
          → verifying               # on success OR on throw: getEscrowBalance(pda)
                                     #   funded → finalizing ; not funded → honest error → idle (draft kept)
          → finalizing              # updateCampaignPda(v2)
          → done                    # router.push('/stage')
```

Invariant: **the wallet is never asked to pay unless `checkVaultFunded` says the vault is empty.** A timeout can never cause a second escrow.

## 6. Error handling

| Situation | Old behavior | New behavior |
|---|---|---|
| Confirmation timeout, tx landed | "Vault not funded" → retry double-charges | `verifying` reads balance → funded → finalize. No re-charge. |
| True send failure (balance 0) | Same misleading copy | Specific reason (USDC/SOL/program); draft kept; Resume re-verifies first. |
| Insufficient USDC | Cryptic on-chain failure | Pre-flight blocks; Fund wallet (mainnet) / faucet (devnet). |
| Insufficient SOL for gas | Wallet refuses to sign | Pre-flight blocks with SOL guidance. |
| Page reload mid-flow | Lost `convexId` → re-create | Resume banner reuses draft + PDA. |

## 7. Data model

- `campaigns` schema: `isHalalOnly` → optional (Unit 1). No other campaign field changes; drafts are already distinguishable by `pdaAddress`/`onchainVersion`.
- New query `campaigns.listDraftsByCreator` (read-only; unfunded open drafts for a wallet). Reuse the existing creator-index pattern (`listByCreator`/`listByCreators`).
- `influencers`/`workers`/`traderStrategies` schema: halal fields → optional (Unit 1).

## 8. Env vars (new)

| Var | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_ONRAMP_PROVIDER` | build | provider id, default `transak` |
| `NEXT_PUBLIC_TRANSAK_API_KEY` | build | Transak public key |
| `NEXT_PUBLIC_TRANSAK_ENV` | build | `STAGING` / `PRODUCTION` |

Existing and relied upon: `NEXT_PUBLIC_SOLANA_NETWORK` (mainnet gate), `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID`, `NEXT_PUBLIC_HELIUS_API_KEY`, `NEXT_PUBLIC_USDC_MINT`.

## 9. Testing

- **Convex unit tests:** `create`/`updateCampaignPda` after halal-field removal; new `listDraftsByCreator` returns only unfunded drafts; halal-fixture cleanup keeps all suites green.
- **Launch state-machine (pure-logic) tests:** funded-vault-skips-funding; timeout-then-verify→finalize; retry-reuses-same-PDA (no second `create`); insufficient-USDC/SOL gates.
- **Onramp:** Transak adapter satisfies `OnrampProvider`; selector defaults correctly; button hidden on devnet, shown on mainnet-when-short.
- **Type/lint:** `tsc` + `eslint` clean for touched files (note: repo has pre-existing unrelated `_generated` tsc noise — scope checks to changed files).

## 10. Rollout / risks

- **Mainnet go-live is an ops step**, not code: escrow program deployed+verified on mainnet, `PlatformConfig` init'd, mainnet env vars set, custody/multisig sign-off. On-ramp button is inert on devnet by design, so shipping to devnet is safe.
- **Transak:** requires an API key (staging first) and MYR→Solana-USDC availability for target regions; verify coverage before enabling in production.
- **Halal fields optional (non-destructive):** vestigial columns remain until an optional later migration; no data loss, no read path left.
- **IDL dependency:** the reliability path relies on `getEscrowBalance` (raw token balance), **not** the typed `getCampaignAccount` reader, so it works even if the regenerated IDL's typed account namespace isn't fully wired.

## 11. Out-of-scope follow-ups (flagged)

- Cross-chain USDC bridge (CCTP) as a second funding source.
- Physical Convex migration to drop halal columns.
- MoonPay/Coinbase onramp adapters behind the same interface.
- A dedicated draft/orphan-campaign management surface beyond the resume banner.

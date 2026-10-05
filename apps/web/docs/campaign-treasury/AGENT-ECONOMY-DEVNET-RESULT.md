# On-Chain Agent-Economy Loop — Devnet Result

**Branch:** `feat/onchain-agent-economy` (off `origin/main @ 6af23ef`). **NOT merged, NOT pushed** — awaiting the push-to-main green light.
**Date:** 2026-07-01. **Cluster:** devnet only. **No real money.**

## 1. What this is

The full autonomous money flywheel, on-chain, wired into the live app (devnet):

```
Brand funds a per-view campaign (USDC vault, rate = USDC/1000 views)
  → agent clips + auto-posts
  → oracle attests confirmed views on-chain (beneficiary = the agent's vault PDA)   [or admin view-injector]
  → claim_payout pays net USDC into the vault + 10% rake → treasury
  → each pipeline run debits its compute fee from the SAME vault → treasury (debit_fee)
  → vault richer → funds the next run → LOOP
```

**Keystone (proven):** the `agent-vault` vault PDA is the agent's single wallet — reward-in (`claim_payout`) and compute-out (`debit_fee`) hit the SAME USDC ATA; both fees reach ONE treasury.

## 2. Contracts (deployed to devnet)

| Program | Program id | Notes |
|---|---|---|
| `vello-escrow` | `Gztj63kcdst6YrdyCGPoWAgLqDGJZAG43UQqtDY8HVxx` | oracle pay-per-view reward escrow (built earlier; brought onto this branch with the fresh 54 KB IDL) |
| `agent-vault` | `93RLwdPcyuNFFougLvRLe7912oJBfq77Y8ZNYXQZD6CP` | per-agent USDC compute vault; deployed THIS session (sig `2AfofgQXSn3L3Mqmt2jFnVZKS96QU2pSg2mQyZ4NPCkkLbMUFKxGciCad2UghEouCYTmaA3CiVFXQZznrqndh4Vg`) |

Toolchain: Anchor 0.31.1, `solana-program = "=2.1.0"`, curve25519 anza patch, `[profile.dev] debug=false`, `CARGO_NET_GIT_FETCH_WITH_CLI=true`.

**agent-vault hardening this session:**
- **Owner-bound seed** `["vault", owner, agent_id]` (was `["vault", agent_id]`) — closes seed-squat takeover; the platform's vaults are unsquattable (only the platform key can init under its own owner-seed).
- **`init_if_needed` on the vault ATA** — closes the ATA pre-squat DoS (an attacker front-creating the ATA can no longer wedge vault creation).

## 3. Tests (localnet, all green)

- `vello-escrow` — **15/15** (config, campaign, record_performance, dispute window, double-crank idempotency=0, budget clamp, prospective rate raise/cut, reject_clip).
- `agent-vault` — **14/14** (init, deposit, debit_fee within/over cap, idempotent replay reject, unauthorized/treasury-redirect reject, withdraw owner-only, insufficient-funds, split payer, cross-vault FeeRecord reject).
- `full-loop` (cross-program keystone) — **8/8** run STANDALONE (it inits the singleton PlatformConfig, so it's kept out of the default `anchor test` script; see the file header). Proves: debit_fee (vault→treasury), record_performance beneficiary = vault PDA, claim_payout net→vault + 10% fee→treasury, and the final balances: vault = deposit − compute + reward_net (8.75), treasury = compute + reward_fee (1.25), one shared ATA.
- App-layer money tests: campaigns (6), submissions (55), usage/economy (65 incl. the review-fix suite). Green.

## 4. Fee

Protocol reward rake = **10%** (`protocol_fee_bps = 1000`), set at PlatformConfig init (`scripts/init-platform-config.ts`). Program hard-caps it at 20% and allows on-chain re-set by the authority (not one-way). The off-chain NAV mirror reads `feeBps` from the on-chain config dynamically (`oracle/claim/route.ts`), so both halves use 10% automatically. Compute per-run costs (`servicePrices.ts`, $0.05–$0.43) are separate.

## 5. App-layer changes (commit-by-commit)

| Area | Commit | What |
|---|---|---|
| Contracts + IDL | `2775d83` | escrow + agent-vault onto the branch, owner-bound seed + init_if_needed, deployed devnet |
| Injector | `15f9b92` | devnet admin view-injector (attest+settle → crank) + `onchainJoinById` |
| Campaign v2 + W7 | `63c6dc9` | fund a real v2 vault (deadline ≥6h, block-on-fail) + auto-match `contentRewardId` via `matchSourceToContentReward` |
| Vault at mint | `c4eeed3` | schema vault fields + platform-owned `init_vault` at mint + `fund-vault` route |
| Beneficiary → vault | `db70164` | `resolveAgentWallet` (DRY'd 4 sites) returns the vault PDA when enabled |
| Compute swap | `f6cd1ea` | 3 sweep sites → `debit_fee`; `settleTab` stops debiting the mirror; reconcile reads the vault balance |
| Fee 10% | `5906d3f`,`30c4095` | `init-platform-config.ts` feeBps=1000 + docs |
| Withdraw + config | `6111443` | vault withdraw route + single-source USDC mint for the mainnet flip |
| Full-loop test | `e078c58`,`76a607e`,`367754a` | cross-program keystone suite + oracle-interface escrow suite |
| Review fixes | `04f4932` | HIGH-1 + MED-A/B/C (below) |

## 6. Adversarial audits

**agent-vault skeptic:** no CRITICAL/HIGH, no external theft path; owner-bound seed verified consistent across all signer-seeds.

**Whole-branch review — 1 HIGH + 3 MED, ALL FIXED (`04f4932`, 65 tests green):**
- **HIGH-1** — a collapsed settlement > the $5 per-run cap reverted `FeeExceedsCap`, which the sweep didn't recognize → infinite release-retry loop → frozen money. **Fix:** split a settlement into ≤cap `debit_fee` chunks (runId `settlementId#i`, each idempotent; cap read on-chain), and treat `FeeExceedsCap` as terminal (no release-loop).
- **MED-A** — `settle-tab` / `recover-settlements` routes didn't re-reconcile after paying → spendable over-reported (bounded free compute). **Fix:** reconcile at the tail of both, like `settleAgent` step 5.
- **MED-B** — recover keeper still required the (unused) `agentWalletSecret`. **Fix:** require only the `agentWallet` pubkey.
- **MED-C** — idempotency was an error-substring match. **Fix:** read the FeeRecord PDA on-chain (confirm-timeout safe).

**Verified NO-BREAK:** single-count of the compute fee; beneficiary correct at all 4 resolver sites; campaign v2 can't flip without a funded PDA; auto-match writes the right reward; auth gates fail closed; debit_fee idempotency.

## 7. LOW items (documented, not fixed)

- **LOW-1** — vault init is best-effort at mint: if `init_vault` succeeds but `setVault` (Convex) fails, the vault exists on-chain but `vaultEnabled=false` → the agent uses the custodial rail; a mint retry can't re-init the account. No fund loss. (Backfill/repair is a follow-up.)
- **LOW-2** — **never backfill `vaultEnabled=true` onto an agent that already has attested-unpaid custodial claims** — the on-chain `claim.beneficiary` locked custodial, so `dueForClaim` would pass the vault PDA → `BeneficiaryMismatch`. Branch-minted agents are safe (vault set at mint, before any attest).
- **LOW-3** — a create-campaign confirm-timeout can leave an orphaned funded escrow (row stays v1, which is correct/safe); recoverable by the creator via `refund_remaining` after deadline+grace.
- **LOW-4** — `debit_fee` requires the treasury USDC ATA to pre-exist (same ATA the escrow fee path uses; normally present).

## 8. What YOU do to go live on devnet (the parts I can't)

1. **Env** (Next + Convex `bold-ram-39`):
   `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID=Gztj63kcdst6YrdyCGPoWAgLqDGJZAG43UQqtDY8HVxx`
   `NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID=93RLwdPcyuNFFougLvRLe7912oJBfq77Y8ZNYXQZD6CP`
   `NEXT_PUBLIC_SOLANA_NETWORK=devnet`
   `VELLO_ORACLE_SECRET`, `VELLO_CRANK_SECRET`, `PLATFORM_VAULT_AUTHORITY_SECRET` (base64 64-byte keypairs)
   `INTERNAL_CRON_SECRET`, `NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET`, `NEXT_PUBLIC_APP_URL`
2. **Fund** (devnet SOL): oracle, crank, and platform-vault-authority keys; create the treasury owner's USDC ATA.
3. **Set config (UPDATE, not init):** the singleton PlatformConfig (`CfDmNqPxF5JzASN3NdECDrVamgfJguxqSXjFFBwDgQAa`) ALREADY EXISTS on devnet — `authority = G6emPd5…` (your deployer wallet), currently `fee = 500 bps`, oracle/treasury = old E2E keys. Run `npx tsx apps/web/scripts/init-platform-config.ts` (as that wallet) → it calls `update_platform_config` to set **fee = 1000 (10%)** + your prod oracle/treasury. **`VELLO_ORACLE_SECRET` must be the keypair of the oracle you set**, or `record_performance` is `Unauthorized`. (H-1 front-run is moot — you already own the config.)
4. **Deploy** Convex `bold-ram-39` (schema + functions) + the Next app.
5. **Test USDC:** Circle devnet faucet for the brand wallet.
6. Fund an agent's vault (`/api/agents/fund-vault`) before its first paid run.

## 9. Mainnet gates (deferred — a separate, safety-gated effort)

On-chain USDC-mint pin (MED-1, mooted on devnet by platform-init passing the right mint); authority cumulative/rate cap (MED-3); user self-custody vaults + SIWS withdraw; keeper key security + multisig; RPC hardening; a professional audit; `transfer` → `transfer_checked`. See also `docs/campaign-treasury/ORACLE-RESULT.md §7`.

**Final Solana adversarial audit (2026-07-01) — verdict: safe-to-push-devnet, no external-attacker fund-loss path.** All money math NO-BREAK (delta/accrual, budget clamp, fee split net+fee==gross, prospective rate, oracle auth, claim substitution, debit_fee cap/idempotency, withdraw owner-only, owner-bound seed, init_if_needed, PDA bumps, refund/cancel). Residuals beyond the accepted-4:
- **H-1 (operational, MOOT here):** `init_platform_config` is first-caller-wins. On this devnet deploy the config is already owned by your wallet, so no window is open. For MAINNET: enable the reverted `program_data.upgrade_authority == authority` init-gate, and deploy+init atomically.
- **M-2 (follow-up):** the escrow's legacy `AgentWallet` rail (`register_agent_wallet`/`sweep_to_treasury`) is an uncapped authority sweep — dormant (the loop uses the agent-vault PDA, not this). Deprecate/remove it to shrink the trusted-drain surface.
- **L-1:** `create_campaign` escrow ATA uses `init` (griefing DoS on a guessed campaign_id; retry with a fresh id). **L-2/L-3:** set `max_staleness_slots` ≫ keeper cadence and `dispute_window` < the 6h cancel grace (the script's 8 / 200000 are safe).

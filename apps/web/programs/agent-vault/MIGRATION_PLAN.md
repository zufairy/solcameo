# Agent Vault — migration plan (custodied keypair → on-chain PDA vault)

**Status:** program shipped + `anchor test` green on localnet (11/11). Devnet deploy
pending; **mainnet deploy is gated on an audit** (see §6). This document is the
ADDITIVE, flag-gated rollout from the current custodial model to the vault.

## 0. Why
Today every agent's funds sit in a Solana keypair whose **secret is stored in the
Convex DB**, AES-encrypted at rest — but with a **plaintext fallback when
`WALLET_ENCRYPTION_KEY` is unset** (`apps/web/lib/server/walletCrypto.ts:80-90`).
A single Next-runtime/env compromise can drain every agent. The fee "siphon" signs
USDC transfers with that agent keypair (`apps/web/lib/economy/settleAgent.ts:80-86`
→ `apps/web/lib/trader/usdcTransfer.ts:130`). The Agent Vault removes the
private-key-on-DB liability: funds live in a program-owned PDA ATA with **no key**,
and the platform debits a **capped, idempotent** per-run fee.

## 1. What shipped (this branch — additive, nothing wired into the live path)
- `programs/agent-vault` (Anchor): PDA vault `seeds=["vault", agent_id(32)]` owning a
  USDC ATA. Instructions:
  - `init_vault(agent_id, authority, treasury, max_fee_per_run)` — owner = signer.
  - `deposit(amount)` — anyone funds the vault ATA.
  - `debit_fee(amount, run_id)` — **authority-signed**; three on-chain guards:
    (1) `amount ≤ max_fee_per_run`; (2) a `FeeRecord` PDA `seeds=["fee", vault, run_id]`
    is `init`'d, so a replayed `run_id` aborts (idempotent / no double-charge);
    (3) destination pinned to `vault.treasury` (no redirect).
  - `withdraw(amount)` — **owner-signed** self-custody.
  - `set_authority` / `set_cap` — owner-only (key/cap rotation).
- `lib/agentVault.ts` — client binding (server-oriented; `agentIdFromSessionId` =
  `sha256(sessionId)`, `runIdToBytes` = `sha256(runId)`, PDA helpers, tx builders).
- `lib/agent-vault-idl.json` — committed IDL for the client.
- `tests/agent-vault.ts` — 11 cases incl. over-cap, replay, unauthorized, wrong-treasury.

## 2. Mapping the custodial siphon → the vault
| Custodial (today) | Vault (target) |
|---|---|
| agent keypair secret in Convex (`influencers.agentWalletSecret`) | no secret — PDA owns the ATA |
| `transferUsdc(agentSecret → treasury)` in `settleAgent.ts` | `debit_fee(amount, run_id)` signed by the platform **authority** |
| dedupe via Convex `feeSettlements` + `claimSettlement` CAS | dedupe **on-chain** via the `FeeRecord` PDA (`run_id`) |
| no on-chain cap | `max_fee_per_run` enforced on-chain |
| funds custodial | owner can `withdraw` anytime (self-custody) |

`run_id` = the settlement id (or task run id). The existing Convex CAS lock stays as
the off-chain guard; the on-chain `FeeRecord` is the authoritative anti-double-charge.

## 3. Flag-gated rollout (additive — DO NOT remove the custodial path)
1. **Deploy** the program to devnet; set `NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID`.
2. **Schema (deferred, needs SCHEMA LOCK):** add to the agent record a
   `vaultEnabled: boolean` flag + optional `vaultAgentId`/`vaultPda`. New agents that
   opt in mint with `init_vault`; existing agents keep the keypair path untouched.
3. **Mint hook:** when `vaultEnabled`, after creating the agent call `init_vault`
   (authority = platform settle key, treasury = `NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET`,
   cap = a sane per-run ceiling).
4. **Settle hook (LAST step, coordinate w/ mainnet-gate):** in `settleAgentEconomics`,
   branch on `vaultEnabled`: vault agents call `debit_fee(amount, settlementId)` via
   `lib/agentVault.ts` instead of `transferUsdc`; keypair agents unchanged.
5. **Deposits/onramp:** vault agents fund via `deposit` (the onramp session can target
   the vault PDA ATA later — noted as a follow-up, not a blocker).

## 4. Boundary with other workstreams
- **INVEST session** owns `convex/shares.ts`/`earnings.ts` + the NAV/share ledger.
  The vault is the agent's *treasury*; whether investor funds live in the vault PDA is
  a later decision (§3.5). Keep the boundary: vault = program + debit; invest =
  shares/earnings/NAV.
- **Onramp** deposits could route into the vault PDA ATA (follow-up).
- Schema additions are **coordinated** via the COORDINATION.md schema lock.

## 5. Audit-prep / hardening backlog (before mainnet)
*(An adversarial self-audit ran on this branch — no CRITICAL/exploitable findings;
the items below are the design-concerns it surfaced. Money-flow invariants
[authority-gated capped debit, vault-namespaced idempotency with no close/reinit,
treasury pinned by owner+mint, owner-only withdraw/admin, checked arithmetic] are
enforced and tested.)*
- **Pin the USDC mint at `init_vault` (H1):** the program accepts any `Mint` and
  stores it; all later ix use `vault.usdc_mint` self-consistently (so no cross-mint
  theft), but a squatter/buggy client could init a vault on a worthless mint. Pin a
  per-cluster canonical USDC mint (constant/config) at init; UNTIL then the platform
  funding path MUST verify on-chain `vault.usdc_mint == expected USDC` before any
  `deposit`.
- **Seed squatting:** `seeds=["vault", agent_id]` lets anyone `init_vault` for an
  `agent_id` first, becoming its owner/authority. The platform must verify on-chain
  `vault.owner`/`vault.authority` before funding (client check), or a future version
  should bind the owner into the seed (`["vault", owner, agent_id]`). Not exploitable
  in the platform flow (platform initializes its own vaults).
- **Fee-evasion ordering (M1):** owner `withdraw` has no lien for accrued-but-unsettled
  fees, so an owner can drain the vault before a pending `debit_fee` lands. Inherent to
  "self-custody anytime"; the off-chain CAS still records the debt. Accept as a known
  risk or add a settle-before-withdraw / reserve-hold before mainnet.
- **Events (M2): DONE** — `init_vault`/`deposit`/`debit_fee`/`withdraw`/`set_authority`/
  `set_cap` now `emit!` events for off-chain monitoring.
- **`transfer` → `transfer_checked`:** `debit_fee`/`withdraw`/`deposit` use the
  (deprecated) SPL `transfer`. Switch to `transfer_checked` (mint + decimals) for
  defense-in-depth.
- **No pause / global freeze.** Consider an admin pause for incident response.
- **Authority key custody:** the platform `authority` is still a hot key; custody it
  in a KMS/HSM (same mainnet-gate as the treasury/fee-payer secrets).
- Independent audit of the program before any mainnet deploy.

## 6. Mainnet deploy runbook (USER-run, post-audit — NOT done here)
1. Audit the program; address findings.
2. `anchor keys sync` (or set a vanity id); update `declare_id!` + `Anchor.toml`.
3. Fund a mainnet deploy keypair (~few SOL).
4. `anchor build && anchor deploy --provider.cluster mainnet`.
5. Set `NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID` (prod) + the platform authority secret.
6. Enable `vaultEnabled` for new agents behind the flag; monitor; ramp.

## 7. Build/toolchain notes (this environment)
- anchor-cli 0.31.1 / solana(Agave) 3.1.12 / rustc 1.85. The program pins
  `anchor-lang`/`anchor-spl` 0.31.1, `solana-program "=2.1.0"` (forced by
  `spl-token-2022 6.0.0` → `solana-zk-sdk 2.1.0`), and the workspace patches
  `curve25519-dalek` to anza's `3.2.1-unpin-zeroize` fork (zeroize conflict).
- Build/test need `CARGO_NET_GIT_FETCH_WITH_CLI=true` (libgit2 can't fetch the git
  patch in this env; system `git` can) and network for the git dep.
- The cargo workspace + `Anchor.toml` are scoped to `programs/agent-vault`;
  `programs/vello-escrow` (anchor 0.30.1) is excluded — its IDL gen is incompatible
  with this toolchain (`Span::source_file` removed in rustc 1.85). Its source is
  retained, untouched.

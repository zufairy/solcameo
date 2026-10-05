# On-Chain Agent Economy Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the full on-chain money flywheel on devnet, in the live app — brands fund per-view campaigns, agents clip + auto-post, the oracle attests views on-chain, agents are paid USDC into a program-owned vault, per-run compute is debited from that same vault, and both fees flow to one treasury.

**Architecture:** Two Anchor programs — `vello-escrow` (deployed `Gztj63kcdst6YrdyCGPoWAgLqDGJZAG43UQqtDY8HVxx`, the reward escrow) and `agent-vault` (to deploy, the per-agent compute vault). The agent-vault vault PDA is the agent's single wallet: `claim_payout` pays rewards INTO it, `debit_fee` charges compute FROM it. Off-chain settlement moments are re-pointed at these two contracts; the oracle + fraud + economy logic already exists and is reused, not rebuilt.

**Tech Stack:** Anchor 0.31.1 (Solana), Convex (backend, deployment `bold-ram-39`), Next.js (App Router, Node runtime routes), TypeScript, `@coral-xyz/anchor` 0.31.1, `@solana/web3.js`, `@solana/spl-token`.

**Base:** branch `feat/onchain-agent-economy` off `origin/main @ 6af23ef`. Build home: `/Users/ongeeshen/Project/vello-agent-economy`.

## Global Constraints

- **Anchor 0.31.1** across Cargo + anchor-cli + JS `@coral-xyz/anchor` (0.30.1 IDL-gen breaks on rustc ≥ 1.85). Program Cargo pins `solana-program = "=2.1.0"`; root Cargo needs `[patch.crates-io] curve25519-dalek = { git = "https://github.com/anza-xyz/curve25519-dalek.git", rev = "b500cdc2a920cd5bff9e2dd974d7b97349d61464" }` + `[profile.dev] debug = false`. Builds run with `CARGO_NET_GIT_FETCH_WITH_CLI=true` (sandbox off).
- **Devnet only.** `NEXT_PUBLIC_SOLANA_NETWORK=devnet`; `getUsdcMint()` → Circle devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. NO real money. Mainnet = a later, separately-gated effort (audit, custody, multisig, init upgrade-authority gate, RPC fix — see `docs/campaign-treasury/ORACLE-RESULT.md §7`).
- **On-chain replaces off-chain:** new campaigns are `onchainVersion:2` (on-chain rail); pre-existing v1 campaigns finish off-chain. `dueForVerification`/`dueForClaim` already gate `onchainVersion >= 2` (rail-XOR). No live users → no fund migration.
- **Platform-owned vaults:** the server signs `init_vault` at mint → `owner = platform authority key`. (Self-custody deferred.)
- **W7 link = auto-match at create** (reuse the sourceKey→contentRewardId reverse-match).
- **Balance truth = the on-chain vault;** Convex `escrowUsdc` is a mirror = `onchainVaultUsdc + adminAdjustmentUsdc − unpaidSettledUsdc`.
- **Keep the async book→sweep pattern;** swap ONLY the on-chain transfer. `debit_fee` idempotency key = the `feeSettlements` `settlementId` (per-batch).
- `max_fee_per_run` default = **$5** (5_000_000 base units), owner-adjustable.
- Prod Convex deployment: **`bold-ram-39`**. Deploy to prod only on the user's green-light per phase.
- Every task: `git commit` at the end. Two Anchor test suites must stay green: `vello-escrow` (22/22), `agent-vault` (bring its tests; keep green).

---

# PHASE 0 — Foundation: escrow in, IDL live, deploy + init, agent-vault vendored

Goal: the deployed `vello-escrow` program is callable from the app (fresh IDL), PlatformConfig is initialized, keeper keys funded, and `agent-vault` source + client + a fresh devnet deploy exist in the repo. Deliverable: `getPlatformConfig(program)` resolves on-chain and `agent-vault` `anchor test` is green in-repo.

### Task 0.1: Bring the fixed escrow program + fresh IDL into the branch

**Files (copy from `/Users/ongeeshen/Project/vello-oracle-build/apps/web` → this branch):**
- Modify: `programs/vello-escrow/src/lib.rs` (fixed program: id `Gztj63k…`, `update_campaign_rate`, `InvalidDeadline`+`CampaignExpired`, deadline guards, boxed ClaimPayout, `padding` rename)
- Modify: `programs/vello-escrow/Cargo.toml` (anchor 0.31.1 + `solana-program = "=2.1.0"`)
- Modify: `Cargo.toml` (root — curve25519 patch + `[profile.dev] debug = false`)
- Modify: `Anchor.toml` (program id `Gztj63k…`, `[toolchain]`, test script `tests/vello-escrow.ts`)
- Modify: `lib/vello-escrow-idl.json` (REPLACE the stale 5819B file with the fresh 54315B IDL = `docs/campaign-treasury/vello_escrow.oracle-idl.json`)
- Modify: `scripts/check-escrow-idl.mjs` (hardened guard)
- Modify: `package.json` (`@coral-xyz/anchor` `^0.32.1` → `0.31.1`)
- Modify: `tests/vello-escrow.ts`, `tests/tsconfig.json`, `tests/e2e-oracle-devnet.ts` (bring the suites)
- Copy (gitignored, hand-carry): `target/deploy/vello_escrow-keypair.json` (pubkey `Gztj63k…`, needed only to UPGRADE the deployed program)

- [ ] **Step 1: Copy the 7 tracked files + test files** from the oracle-build worktree to the same paths here.
- [ ] **Step 2: Verify the IDL is fresh**

Run: `cd apps/web && node scripts/check-escrow-idl.mjs lib/vello-escrow-idl.json`
Expected: `up to date + valid 0.30+ format ✓` (has `record_performance`, `claim_payout`, `update_campaign_rate`, `address: Gztj63k…`).

- [ ] **Step 3: Typecheck the escrow client compiles against the fresh IDL**

Run: `cd apps/web && npx tsc --noEmit lib/escrow.ts` (or the project's typecheck)
Expected: no errors on `program.account.campaign/.claimRecord/.platformConfig` (these existed only in the stale IDL as undefined before).

- [ ] **Step 4: Commit**

```bash
git add apps/web/programs/vello-escrow apps/web/Cargo.toml apps/web/Anchor.toml apps/web/lib/vello-escrow-idl.json apps/web/scripts/check-escrow-idl.mjs apps/web/package.json apps/web/tests
git commit -m "feat(escrow): bring fixed+deployed vello-escrow program + fresh IDL onto the integration branch"
```

### Task 0.2: Set escrow env + verify the deployed program answers

**Files:** Modify: `apps/web/.env.local` (local) + the prod env (Vercel/host) + Convex env (`bold-ram-39`).

Env to set (all deployments):
```
NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID=Gztj63kcdst6YrdyCGPoWAgLqDGJZAG43UQqtDY8HVxx
NEXT_PUBLIC_SOLANA_NETWORK=devnet
VELLO_ORACLE_SECRET=<base64 64-byte oracle keypair>
VELLO_CRANK_SECRET=<base64 64-byte crank keypair>   # may equal oracle
INTERNAL_CRON_SECRET=<existing>
NEXT_PUBLIC_APP_URL=<public https url the crons POST to>
NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET=<treasury owner pubkey with a devnet-USDC ATA>
```

- [ ] **Step 1:** Generate oracle + crank keypairs; base64-encode the 64-byte secret; set `VELLO_ORACLE_SECRET`/`VELLO_CRANK_SECRET` in Next + Convex env.
- [ ] **Step 2: Fund the keys** — `solana airdrop 2 <oraclePubkey> --url devnet` and same for crank; airdrop the treasury owner + create its USDC ATA (`spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --owner <treasury> --url devnet`).
- [ ] **Step 3: Confirm the program is live** — `solana program show Gztj63kcdst6YrdyCGPoWAgLqDGJZAG43UQqtDY8HVxx --url https://api.devnet.solana.com` → prints an upgradeable program.
- [ ] **Step 4: Commit** (env templates only, never secrets):

```bash
git add apps/web/.env.example
git commit -m "chore(escrow): document devnet escrow + keeper env vars"
```

### Task 0.3: Initialize PlatformConfig on devnet (one-time)

**Files:** Create: `apps/web/scripts/init-platform-config.ts` (a one-shot admin script calling `initPlatformConfigTx`, run via `tsx`).

**Interfaces:** Consumes `initPlatformConfigTx(program, oracle, treasury, feeBps, disputeWindowSlots, maxStalenessSlots)` (`lib/escrow.ts:550`). Windows: `disputeWindowSlots` small on devnet (e.g. 8), `maxStalenessSlots` large (e.g. 200000); `feeBps = 1000` (10%, capped at 2000). The fee is re-settable on-chain later (authority `update_config`), so this is not one-way.

- [ ] **Step 1: Write the script** — load the admin keypair (= the program upgrade authority), build the escrow `Program`, call `initPlatformConfigTx(program, oraclePubkey, treasuryOwnerPubkey, 1000, 8, 200000)`. Print the tx sig + PlatformConfig PDA.
- [ ] **Step 2: Run it once** — `npx tsx apps/web/scripts/init-platform-config.ts`. Expected: a tx sig; `getPlatformConfig(program)` now resolves `{ oracle, treasury, protocolFeeBps: 1000, … }`.
- [ ] **Step 3: Verify from the app path** — a tiny script calling `getPlatformConfig(buildEscrowProgram(dummyWallet))` returns the config (proves the crank's `oracle/claim:96` read works).
- [ ] **Step 4: Commit**

```bash
git add apps/web/scripts/init-platform-config.mjs
git commit -m "feat(escrow): one-time init_platform_config devnet script + run"
```

### Task 0.4: Vendor + deploy agent-vault (fresh devnet id)

**Files (copy from `/Users/ongeeshen/Project/VELLO-agent-vault/apps/web`):**
- Create: `apps/web/programs/agent-vault/` (the whole program dir)
- Create: `apps/web/lib/agentVault.ts` (the client)
- Create: `apps/web/lib/agent-vault-idl.json` (fresh IDL after build)
- Create: `apps/web/tests/agent-vault.ts` (the suite)
- Modify: `apps/web/Anchor.toml` (add `agent_vault` to `[programs.devnet]` + workspace members)

**Interfaces (produced for later tasks):** `getVaultPda(agentId: Buffer): [PublicKey, number]`, `agentIdFromSessionId(sessionId: string): Buffer`, `getVaultUsdcAta(usdcMint, vault): Promise<PublicKey>`, `initVaultTx({program, agentId, usdcMint, authority, treasury, maxFeePerRunUsdc})`, `depositTx({...})`, `debitFeeTx({program, agentId, usdcMint, treasuryUsdcAta, amountUsdc, runId})`, `withdrawTx({...})`, `fetchVault(program, agentId)` — all in `lib/agentVault.ts` (signatures verified in the map).

- [ ] **Step 1: Copy the program + client + tests.** Add `agent-vault` to `Anchor.toml` workspace + `[programs.devnet]`.
- [ ] **Step 2: Harden the vault seed to kill seed-squat (program change).** In `programs/agent-vault/src/lib.rs`, change the vault PDA seed from `[VAULT_SEED, agent_id]` to `[VAULT_SEED, owner, agent_id]` (bind the owner). Update `InitVault`, `Deposit`, `DebitFee`, `Withdraw`, `AdminUpdate` account seeds + the client `getVaultPda(owner, agentId)` accordingly.

```rust
// programs/agent-vault/src/lib.rs — InitVault (was seeds = [VAULT_SEED, agent_id.as_ref()])
#[account(
    init, payer = owner, space = Vault::SPACE,
    seeds = [VAULT_SEED, owner.key().as_ref(), agent_id.as_ref()],
    bump
)]
pub vault: Account<'info, Vault>,
```

- [ ] **Step 3: Pin the USDC mint at init (hardening H1).** In `init_vault`, store `vault.usdc_mint = ctx.accounts.usdc_mint.key()` and in `deposit`/`debit_fee` add `constraint = <ata>.mint == vault.usdc_mint`. Write a failing test first (deposit with a foreign mint reverts), then implement.
- [ ] **Step 4: `anchor build` + `anchor test`** (localnet) with a fresh keypair:

Run: `cd apps/web && CARGO_NET_GIT_FETCH_WITH_CLI=true anchor build && anchor test --skip-build --provider.cluster localnet`
Expected: agent-vault suite green (adjust tests for the new owner-bound seed).

- [ ] **Step 5: Generate a fresh program id + deploy to devnet.**

```bash
cd apps/web && solana-keygen new --no-bip39-passphrase --force -o target/deploy/agent_vault-keypair.json
anchor keys sync && anchor build
solana program deploy target/deploy/agent_vault-keypair.json --url "$HELIUS_DEVNET" --with-compute-unit-price 60000 --max-sign-attempts 200
```
Set `NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID=<new id>` in all envs. `cp target/idl/agent_vault.json lib/agent-vault-idl.json`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/programs/agent-vault apps/web/lib/agentVault.ts apps/web/lib/agent-vault-idl.json apps/web/tests/agent-vault.ts apps/web/Anchor.toml
git commit -m "feat(agent-vault): vendor + owner-bound seed + mint-pin + fresh devnet deploy"
```

---

# PHASE 1 — Reward loop live (custodial beneficiary) + injector

Goal: brand funds a v2 campaign → auto-match to a content-reward → a clip on that reward creates a v2 submission → oracle attests → crank pays the clipper on-chain. Prove it end-to-end with the injector, using the EXISTING custodial `agentWallet` as beneficiary (swap to vault in Phase 3). Deliverable: an admin injects views on a real submission and watches USDC land in the clipper wallet + fee in treasury, on devnet.

### Task 1.1: Campaign create funds a v2 vault + passes contentRewardId

**Files:** Modify: `apps/web/components/campaign/campaign-form.tsx:716-777`; Modify: `apps/web/convex/campaigns.ts` `create` mutation (`:225-293`) to accept `onchainVersion`.

**Interfaces:** Consumes `createCampaignTx(program, convexId, budgetUsdc, ratePer1kUsdc, deadlineUnix)` (`lib/escrow.ts:111`), `campaigns.updateCampaignPda({id, pdaAddress, callerWallet, onchainVersion})` (`campaigns.ts:295`).

- [ ] **Step 1: Deadline ≥ 6h.** In `campaign-form.tsx` where `deadlineUnix` is computed for `createCampaignTx`, ensure `deadline ≥ now + 6h` (the program's `MIN_CAMPAIGN_DURATION_SECS`); the form's deadline picker must enforce this (min = now+6h). Write the guard + a user-facing validation message.
- [ ] **Step 2: Turn the soft-fail into a real state.** Replace the `catch → setEscrowWarning → redirect` (`campaign-form.tsx:773-776`) with: on escrow failure, do NOT set `onchainVersion:2`; surface a blocking "vault not funded — try again" error; only call `updateCampaignPda({..., onchainVersion:2})` after `createCampaignTx` succeeds (already at `:772`, but gate the redirect on success).
- [ ] **Step 3: Verify** — create a campaign in the app (devnet wallet with Circle devnet USDC); confirm the `campaigns` row has `pdaAddress` + `onchainVersion:2` and USDC left the funder's ATA into the campaign PDA vault (`getEscrowBalance`).
- [ ] **Step 4: Commit**

```bash
git add apps/web/components/campaign/campaign-form.tsx apps/web/convex/campaigns.ts
git commit -m "feat(campaign): fund a real v2 on-chain vault at create; block on escrow failure"
```

### Task 1.2: Auto-match a v2 campaign to a contentRewardId (the W7 link)

**Files:** Modify: `apps/web/convex/campaigns.ts` (`create` or `updateCampaignPda`) to set `contentRewardId` via the reverse-match; reuse the existing sourceKey→contentRewardId matcher (grep `getFundedByContentRewardId` consumers + the cloud-path reverse-match in `run-task`/`clipJobs`).

**Interfaces:** Consumes the existing reverse-match (find it: the shipped `sourceKey → contentRewardId` logic per memory). Produces: a `campaigns` row where `contentRewardId` is set alongside `pdaAddress` + `onchainVersion:2` — so `getFundedByContentRewardId(contentRewardId)` (`campaigns.ts:123`) matches.

- [ ] **Step 1: Write the failing test** — a Convex test: create a v2 campaign whose source maps to content-reward `R`; assert `getFundedByContentRewardId("R")` returns it (today: returns null).
- [ ] **Step 2: Implement the auto-match** — in the campaign create/update path, resolve the campaign's `sourceKey` → `contentRewardId` (reverse-match) and persist `contentRewardId` on the row. If no match, leave null (off-chain).
- [ ] **Step 3: Run the test → passes.**
- [ ] **Step 4: Verify the bridge fires** — a cloud clip on reward `R` (`clipJobs.ts:1743-1764`) now finds the funded v2 campaign and inserts a money-rail submission (`submitClipToCampaign`). Confirm a `submissions` row (status submitted, `onchainVersion` via campaign join).
- [ ] **Step 5: Commit**

```bash
git add apps/web/convex/campaigns.ts apps/web/convex/campaigns.test.ts
git commit -m "feat(campaign): auto-match funded v2 campaign to contentRewardId (W7 link)"
```

### Task 1.3: Admin view-injector route (drives on-chain attest → crank)

**Files:** Create: `apps/web/app/api/admin/inject-views/route.ts`; Create: `apps/web/convex/submissions.ts` internal query `onchainJoinById` (resolve `campaignId`, `creatorWallet`, `agentWallet`, `onchainVersion` for a submission `_id`); Modify: `apps/web/components/admin/submissions-section.tsx` (an "Inject views" per-row action gated on the on-chain map).

**Interfaces:** Consumes `recordPerformanceTx` (`lib/escrow.ts:231`), `api.oracle.settleFromOracle` (`convex/oracle.ts:14`), `buildServerEscrowProgram`/`loadKeypair` (`lib/server/escrowServer.ts`), `getNetwork()` (`lib/solana/network.ts:12`), the `recalc-payout` auth block (`app/api/admin/recalc-payout/route.ts:50-60`).

- [ ] **Step 1: Write the route with the exact auth + devnet gates** (copy verbatim from the map):

```ts
// app/api/admin/inject-views/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { PublicKey } from "@solana/web3.js";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { getNetwork } from "@/lib/solana/network";
import { buildServerEscrowProgram, loadKeypair } from "@/lib/server/escrowServer";
import { recordPerformanceTx } from "@/lib/escrow";
import { api } from "@/convex/_generated/api";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const CHECK_ADMIN = makeFunctionReference<"action">("submissions:checkAdminToken");
const ONCHAIN_JOIN = makeFunctionReference<"query">("submissions:onchainJoinById");

export async function POST(req: NextRequest) {
  if (getNetwork() !== "devnet")
    return NextResponse.json({ ok: false, error: "Injector disabled off devnet" }, { status: 403 });
  const body = await req.json();
  // dual gate — internal secret OR admin Supabase token
  if (!checkInternalSecret(req)) {
    const convex = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null;
    if (!body.accessToken || !convex) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const chk = (await convex.action(CHECK_ADMIN, { accessToken: body.accessToken }).catch(() => null)) as { admin: boolean } | null;
    if (!chk?.admin) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const secret = process.env.INTERNAL_CRON_SECRET!;
  const convex = new ConvexHttpClient(CONVEX_URL);
  const j = (await convex.query(ONCHAIN_JOIN, { authSecret: secret, submissionId: body.submissionId })) as
    | { campaignId: string; creatorWallet: string; agentWallet: string; onchainVersion: number } | null;
  if (!j || j.onchainVersion < 2 || !j.creatorWallet || !j.agentWallet)
    return NextResponse.json({ ok: false, error: "submission not on the on-chain rail (needs v2 + creator + agent wallet)" }, { status: 400 });

  const program = buildServerEscrowProgram(loadKeypair(process.env.VELLO_ORACLE_SECRET!));
  const { txSignature } = await recordPerformanceTx(
    program, j.campaignId, body.submissionId, j.creatorWallet,
    new PublicKey(j.agentWallet), Number(body.views),
    Buffer.alloc(32), Buffer.alloc(64),
  );
  await convex.mutation(api.oracle.settleFromOracle, {
    authSecret: secret, submissionId: body.submissionId,
    decision: "approved", viewCount: Number(body.views), attestationTx: txSignature,
  });
  return NextResponse.json({ ok: true, txSignature });
}
```

- [ ] **Step 2: Add the Convex join query** `onchainJoinById({ authSecret, submissionId })` in `convex/submissions.ts` — internal-secret gated, joins `campaigns.creatorWallet`/`onchainVersion` + `influencers.by_mint → agentWallet` (reuse the `dueForVerification` joins at `:402-420`).
- [ ] **Step 3: Add the admin button** in `submissions-section.tsx` (per-row, gated on the `onchain` map so only injectable rows show it; a prompt for the view count; POST with `accessToken` from `useSupabaseAuth()`). Also add a resolver `contentRewardSubmissionId → submissions._id` (the dashboard rows are Supabase ids).
- [ ] **Step 4: Manual E2E** — fund a v2 campaign, get a clip submission, click "Inject 100000 views". Expected: `recordPerformanceTx` sig; the row becomes `verified`/`approved` with `payoutAmountUsdc = floor(100000 × ratePer1k / 1000)`; `POST /api/oracle/claim` (or the 10-min cron) pays the clipper's custodial `agentWallet` + 5% to treasury. Verify balances.
- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/admin/inject-views apps/web/convex/submissions.ts apps/web/components/admin/submissions-section.tsx
git commit -m "feat(admin): devnet view-injector (attest+settle) to drive on-chain payouts on demand"
```

**PHASE 1 DELIVERABLE / CHECKPOINT:** brand → funded v2 vault → clip → inject views → clipper paid on-chain + treasury fee. The reward rail is live (custodial beneficiary). Get user sign-off before Phase 2.

---

# PHASE 2 — Agent vault at mint (platform-owned) + persist on the agent row

Goal: every newly-minted agent gets a program-owned `agent-vault` vault (owner = platform authority), and the agent row stores its vault address so the oracle can target it. Deliverable: minting an agent creates a funded-capable vault; `agentAccount.vaultAddress` is set.

### Task 2.1: Schema — add vault fields to the agent row

**Files:** Modify: `apps/web/convex/schema.ts` `agentAccount` (`:711`) — add `vaultAddress: v.optional(v.string())`, `vaultAgentId: v.optional(v.string())` (hex sha256 sessionId), `vaultEnabled: v.optional(v.boolean())`.

> Convex schema change → use the **convex-migration-helper** skill (widen → migrate → narrow). These are optional fields, so additive/safe.

- [ ] **Step 1:** Add the optional fields; `npx convex dev` (or deploy to `bold-ram-39` on green-light) picks up the schema.
- [ ] **Step 2: Commit**

```bash
git add apps/web/convex/schema.ts
git commit -m "feat(schema): agentAccount vault fields (vaultAddress/vaultAgentId/vaultEnabled)"
```

### Task 2.2: init_vault at mint (server-signed, platform-owned)

**Files:** Modify: `apps/web/app/api/nft/mint/route.ts` (insert after L283, after `saveInfluencer`); Create/Modify: a Convex mutation to persist `vaultAddress` on `agentAccount`.

**Interfaces:** Consumes `initVaultTx({program, agentId, usdcMint, authority, treasury, maxFeePerRunUsdc})`, `getVaultPda(owner, agentId)`, `agentIdFromSessionId(sessionId)` (`lib/agentVault.ts`). `owner`/`authority` = the platform vault-signer keypair (a new env `PLATFORM_VAULT_AUTHORITY_SECRET`); `treasury` = `NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET`; `maxFeePerRunUsdc = 5`.

- [ ] **Step 1: Write the mint hook** — after the agent row is created (`mint/route.ts:283`), with `sessionId` (L127) in scope:

```ts
// after saveInfluencer (mint/route.ts:283)
try {
  const vaultSigner = loadKeypair(process.env.PLATFORM_VAULT_AUTHORITY_SECRET!);
  const program = buildAgentVaultProgram(vaultSigner);
  const agentId = agentIdFromSessionId(sessionId);
  const usdcMint = getUsdcMint();
  await initVaultTx({
    program, agentId, usdcMint,
    authority: vaultSigner.publicKey,     // platform-owned
    treasury: new PublicKey(process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET!),
    maxFeePerRunUsdc: 5,
  });
  const [vaultPda] = getVaultPda(vaultSigner.publicKey, agentId);
  await convex.mutation(api.agentAccount.setVault, {
    authSecret: process.env.INTERNAL_CRON_SECRET!, mintAddress,
    vaultAddress: vaultPda.toBase58(), vaultAgentId: agentId.toString("hex"), vaultEnabled: true,
  });
} catch (e) { console.warn("[mint] init_vault failed (agent minted without vault):", e); }
```

- [ ] **Step 2: Add `agentAccount.setVault` mutation** (internal-secret gated) writing the three fields via the `by_mint` index.
- [ ] **Step 3: Manual verify** — mint an agent; confirm the vault PDA exists on devnet (`fetchVault`) with `owner = platform`, `treasury`, `max_fee_per_run = 5e6`, and `agentAccount.vaultAddress` is set.
- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/nft/mint/route.ts apps/web/convex/agentAccount.ts
git commit -m "feat(mint): create a platform-owned agent-vault + persist vaultAddress at mint"
```

### Task 2.3: Deposit funding path (owner seeds the vault)

**Files:** Create: `apps/web/app/api/agents/fund-vault/route.ts` (owner deposits USDC into their agent's vault).

**Interfaces:** Consumes `depositTx({program, agentId, usdcMint, funderUsdcAta, amountUsdc})`. Auth: SIWS owner of the agent (reuse `requireOwnerWithSiws`).

- [ ] **Step 1:** Route: verify the caller owns the agent (SIWS), build the deposit tx (funder = caller's wallet, or platform for house agents), call `depositTx`. Return the sig.
- [ ] **Step 2: Verify** — deposit 5 devnet USDC into an agent vault; `fetchVault` / vault ATA balance = 5 USDC.
- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/agents/fund-vault
git commit -m "feat(agents): fund an agent's compute vault (deposit USDC)"
```

---

# PHASE 3 — Point the reward beneficiary at the vault

Goal: the oracle records the reward beneficiary as the agent's vault PDA, so rewards land in the compute vault. NOTE: `claim.beneficiary` locks at first attestation — this must land before the first record for any NEW submission.

### Task 3.1: Beneficiary resolver → vault PDA

**Files:** Modify: `apps/web/convex/submissions.ts` `resolveAgentWallet` (3 copies: `:411-420`, `:515-524`, `:628-637`) — return the agent's `vaultAddress` when `vaultEnabled`, else fall back to `agentWallet`.

**Interfaces:** Produces: `dueForVerification`/`dueForClaim`/`dueForReattest` now project `agentWallet = vaultAddress ?? influencers.agentWallet`. The oracle (`run:207`) + crank (`claim:142`) already read `s.agentWallet` — no route change needed.

- [ ] **Step 1: Write the failing test** — a submission whose agent has `vaultAddress = V`; assert `dueForVerification` projects `agentWallet = V` (today: the custodial keypair).
- [ ] **Step 2: Implement** — factor `resolveAgentWallet` into ONE helper (DRY the 3 copies): `const acct = agentAccount.by_mint; return acct?.vaultEnabled && acct.vaultAddress ? acct.vaultAddress : influencers.agentWallet`.
- [ ] **Step 3: Run test → passes.**
- [ ] **Step 4: Verify on devnet** — inject views on a FRESH v2 submission (agent has a vault). Expected: `recordPerformanceTx` sets `claim.beneficiary = vaultPda`; the crank pays into the vault's USDC ATA; `fetchVault` balance grew. (Old Phase-1 submissions keep the custodial beneficiary — fine.)
- [ ] **Step 5: Commit**

```bash
git add apps/web/convex/submissions.ts apps/web/convex/submissions.test.ts
git commit -m "feat(oracle): reward beneficiary = agent-vault vault PDA when enabled (unified wallet)"
```

---

# PHASE 4 — Compute settlement swap (transfer → debit_fee) + balance = vault

Goal: replace the off-chain USDC sweep with `agent-vault.debit_fee` from the vault, and make the spend-gate read the vault. Preserve the async book→sweep pattern; fix the double-debit seam.

### Task 4.1: A shared `sweepAgentTabOnchain` that calls debit_fee

**Files:** Create: `apps/web/lib/economy/vaultSweep.ts`; Modify the 3 sweep sites to call it: `lib/economy/settleAgent.ts:80`, `app/api/economy/settle-tab/route.ts:55`, `app/api/economy/recover-settlements/route.ts:177`.

**Interfaces:** Consumes `debitFeeTx({program, agentId, usdcMint, treasuryUsdcAta, amountUsdc, runId})` (`lib/agentVault.ts:138`) — `program` signs with `PLATFORM_VAULT_AUTHORITY_SECRET` (the vault authority) + a `payer` for FeeRecord rent; `runId = settlementId` (the `feeSettlements._id`, per-batch idempotency). Produces: `sweepAgentTabOnchain({ mintAddress, settlementId, amountUsdc }): Promise<{ ok, txSignature? }>`.

- [ ] **Step 1: Write the failing test** — mock the vault program; assert `sweepAgentTabOnchain` calls `debit_fee(amountUsdc, runId=settlementId)` with `treasury_usdc_ata` = the platform treasury ATA.
- [ ] **Step 2: Implement `vaultSweep.ts`** — resolve the agent's `vaultAgentId` (from `agentAccount`), build the vault `Program` with the authority keypair, call `debitFeeTx`. Idempotent: if the FeeRecord for `settlementId` already exists on-chain, treat as already-paid (catch the replay-abort → `ok:true`).
- [ ] **Step 3: Swap the 3 sites** — replace each `transferUsdc(from=agent.agentWallet, to=TREASURY, amountUsdc=claim.amountUsdc, feePayer=…)` with `sweepAgentTabOnchain({ mintAddress, settlementId: claim.settlementId, amountUsdc: claim.amountUsdc })`. Keep the surrounding `claimSettlement`/`markSettlementPaid` flow (the INFLIGHT lock + sig stamp) intact — pass the `debit_fee` sig to `markSettlementPaid`.
- [ ] **Step 4: Run tests → pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/economy/vaultSweep.ts apps/web/lib/economy/settleAgent.ts apps/web/app/api/economy/settle-tab apps/web/app/api/economy/recover-settlements apps/web/lib/economy/vaultSweep.test.ts
git commit -m "feat(economy): settle compute tabs via agent-vault debit_fee (idempotent per settlementId)"
```

### Task 4.2: Fix the double-debit seam

**Files:** Modify: `apps/web/convex/usage.ts` `settleTab` (`:243-284`); Modify: `apps/web/convex/agentAccount.ts` `reconcileImpl` (`:52-92`).

**Problem:** `settleTab` debits `escrowUsdc/liquidUsdc` in Convex (`:275-280`) AND `debit_fee` now debits the on-chain vault → double count.

- [ ] **Step 1: Write the failing test** — book a $1 tab, settle it (debit_fee moves $1 on-chain), reconcile; assert `escrowUsdc` dropped by exactly $1 (not $2).
- [ ] **Step 2: Implement — `settleTab` stops debiting escrow.** Change `settleTab` to only: mark the usage rows `settledBatchId`, insert the `feeSettlements` row, and zero the covered portion of `unsettledTabUsdc`. Do NOT touch `escrowUsdc`/`liquidUsdc` (the on-chain vault + reconcile own those now).
- [ ] **Step 3: Simplify the reconcile re-credit guard.** In `reconcileImpl`, `escrowUsdc = onchainVaultUsdc + adminAdjustmentUsdc` (drop the `− unpaidSettledUsdc` term, which existed to mask the book-vs-chain lag — now the chain IS the truth). Keep `adminAdjustmentUsdc`.
- [ ] **Step 4: Run tests → pass.** Add a test that a booked-but-unpaid settlement (debit_fee not yet landed) does NOT double-count.
- [ ] **Step 5: Commit**

```bash
git add apps/web/convex/usage.ts apps/web/convex/agentAccount.ts apps/web/convex/usage.test.ts
git commit -m "fix(economy): chain-truth balances — settleTab stops debiting the mirror; reconcile reads the vault"
```

### Task 4.3: Spend-gate + reconcile read the vault balance

**Files:** Modify: `apps/web/lib/economy/usdcTransfer.ts` `getUsdcBalance` callers to read the vault; the 3 spend gates (`convex/usage.ts:217`, `app/api/economy/clip-precheck/route.ts:129`, `convex/clipJobs.ts:1085`) via the reconcile mirror; the reconcile driver `settleAgent.ts:40` / `/api/economy/reconcile` to pass `onchainUsdc = getUsdcBalance(vaultAta)`.

**Interfaces:** Consumes `getVaultUsdcAta(usdcMint, vaultPda)` + `getUsdcBalance(ata)`. The spend gates keep using `spendableUsdc(account)` (the mirror), which now reflects the vault after reconcile.

- [ ] **Step 1: Write the failing test** — an agent with a vault holding $3; after reconcile, `agentAccount.escrowUsdc = 3`; `canSpend(account, 4) = false`, `canSpend(account, 2) = true`.
- [ ] **Step 2: Implement** — in the reconcile caller path, compute `onchainUsdc` from the VAULT ATA (not the custodial `agentWallet`): `const [vaultPda] = getVaultPda(authority, agentIdFromHex(acct.vaultAgentId)); const bal = await getUsdcBalance(await getVaultUsdcAta(usdcMint, vaultPda))`. Pass to `reconcileEscrowToOnchainServer`.
- [ ] **Step 3: Run test → passes.** Verify the 3 inline `spendableUsdc(...) < cost` gates now gate on the vault-backed mirror.
- [ ] **Step 4: Manual devnet** — an agent with a $1 vault + a run costing $0.75 → allowed; a $0.40 vault + $0.75 run → `needs_funding`.
- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/economy apps/web/convex/usage.ts apps/web/convex/clipJobs.ts apps/web/app/api/economy
git commit -m "feat(economy): spend-gate + reconcile read the on-chain vault balance (chain = truth)"
```

---

# PHASE 5 — Withdraw + hardening + config-for-flip

### Task 5.1: Owner withdraw route

**Files:** Create: `apps/web/app/api/agents/withdraw-vault/route.ts`.

**Interfaces:** Consumes `withdrawTx({program, agentId, usdcMint, ownerUsdcAta, amountUsdc})`. Since vaults are platform-owned this push, the owner = the platform authority; the route lets the platform withdraw a house/user agent's earnings to a destination ATA (SIWS-gated for user agents; the platform authority signs). (True user self-custody is deferred — noted in the spec.)

- [ ] **Step 1:** Route: authorize (SIWS owner or admin), sign `withdraw` with the vault authority, transfer to the destination ATA.
- [ ] **Step 2: Verify** — withdraw 1 USDC from an agent vault to a wallet; balances move.
- [ ] **Step 3: Commit** — `git commit -m "feat(agents): withdraw earnings from an agent vault"`.

### Task 5.2: Mainnet-flip config audit

**Files:** Modify: reconcile the TWO USDC-mint sources (`lib/solana/network.ts:29` constant vs `NEXT_PUBLIC_USDC_MINT` override at `escrow.ts:29`, `usdc-balance.ts:12`, `solanaVerify.ts:26`, admin comps) — ensure both resolve to Circle devnet USDC now, and to the same mainnet mint under the flip.

- [ ] **Step 1:** Ensure `NEXT_PUBLIC_USDC_MINT` is unset (so both paths fall to `getUsdcMint()` = Circle devnet) OR set to the devnet mint everywhere consistently. Document the flip: mainnet = set `NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta` + the mainnet program ids + the Phase-7 gates.
- [ ] **Step 2: Commit** — `git commit -m "chore(config): single-source the USDC mint for the network flip"`.

---

# PHASE 6 — Full-loop E2E + app clickthrough

### Task 6.1: Extend the devnet E2E to the full loop

**Files:** Modify: `apps/web/tests/e2e-oracle-devnet.ts` — add: `init_vault` + `deposit` (seed a vault) → simulate a run charge → `debit_fee` (vault → treasury) → `record_performance` (beneficiary = vault) → `claim_payout` (net → vault, fee → treasury) → assert the vault balance = deposit − compute_fee + reward_net, and treasury = compute_fee + reward_fee.

- [ ] **Step 1: Write the E2E additions** (real devnet sigs, per the existing script's pattern).
- [ ] **Step 2: Run** — `ANCHOR_PROVIDER_URL=<devnet> ANCHOR_WALLET=~/.config/solana/id.json npx ts-node -P tests/tsconfig.json tests/e2e-oracle-devnet.ts`. Expected: every path records a sig; the vault + treasury deltas match.
- [ ] **Step 3: Commit** — `git commit -m "test(e2e): full devnet loop — deposit → debit_fee → attest → claim into vault"`.

### Task 6.2: App clickthrough proof

- [ ] **Step 1:** In the live app (devnet): (a) fund a v2 campaign as a brand; (b) mint + fund an agent (vault seeded $5); (c) run the pipeline for that agent (debit_fee charges the vault); (d) admin-inject views on the clip; (e) watch the reward land in the vault + the 10% fee + the compute fee in treasury; (f) confirm the vault balance reflects reward-in minus compute-out.
- [ ] **Step 2:** Record the tx sigs into `docs/campaign-treasury/AGENT-ECONOMY-DEVNET-RESULT.md`.
- [ ] **Step 3: Commit** — `git commit -m "docs: full on-chain agent-economy loop proven on devnet (tx sigs)"`.

---

## Self-Review (spec coverage)

- Unit A (config/deploy) → Phase 0 ✅ · Unit B (campaign v2) → 1.1 ✅ · W7 link → 1.2 ✅ · Unit C (vault @ mint) → 2.2 ✅ · Unit D (oracle attest) → already wired + 3.1 (beneficiary) ✅ · Unit E (crank) → already wired ✅ · Unit F (compute swap) → 4.1–4.3 ✅ · Unit G (balance mirror) → 4.2–4.3 ✅ · Unit H (rail-XOR) → already wired (onchainVersion gate) ✅ · Unit I (crons/windows) → already wired + 0.3 (windows) ✅ · Unit J (injector) → 1.3 ✅.
- Locked decisions covered: platform-owned vaults (2.2), auto-match W7 (1.2), chain-truth balances (4.2–4.3), $5 cap (2.2), owner withdraw (5.1), devnet-only + flip (5.2, global), linear/pro-rata payout (native — no task), fraud-gate-only (no extra work), one treasury (0.3 + 2.2 both point at `JOBTEPI_TREASURY_WALLET`).
- Deferred (spec §15, out of scope): self-custody init, auto campaign-selection, mainnet gates, agent-vault mainnet backlog (§13).

## Risks carried into execution

- **Beneficiary lock-in** — Phase 3 must land before any NEW submission's first attestation; Phase-1 submissions keep custodial (acceptable).
- **Double-debit** — Task 4.2 is the delicate one; test that a booked-unpaid settlement never double-counts.
- **3 sweep sites** — Task 4.1 must swap all three or an off-chain leak survives.
- **Keeper SOL** — oracle + crank + vault-authority keys must stay funded (add a low-balance check).
- **Convex `bold-ram-39` quota** — confirm plan headroom before load.

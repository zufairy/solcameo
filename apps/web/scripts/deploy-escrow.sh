#!/usr/bin/env bash
#
# One-shot vello-escrow deploy: build → sync program id → build → deploy → copy IDL
# → init/update PlatformConfig (with the widened dispute window) → verify oracle keys.
#
# ⚠️ REVIEW BEFORE RUNNING — this deploys a money contract. Run on your Mac/Linux
# with the Solana + Anchor (>=0.31.1) toolchain, from apps/web.
#
# The classic footgun this kills: the program id must agree across declare_id!,
# Anchor.toml, the built IDL `address`, and NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID (a
# stale id — e.g. the dead 4qyfe9ph… — silently breaks the on-chain rail). We run
# `anchor keys sync` so declare_id!/Anchor.toml match the real keypair, then assert
# the env var matches before deploying.
#
# Usage:
#   CLUSTER=devnet ./scripts/deploy-escrow.sh          # dry-ish run on devnet first
#   CLUSTER=mainnet CONFIRM_MAINNET=yes ./scripts/deploy-escrow.sh   # the real thing
#
# Required env (the deployer wallet MUST be the program's upgrade authority AND the
# config authority — init is gated to the upgrade authority, finding #1):
#   DEPLOYER_WALLET=~/.config/solana/id.json   # deployer = upgrade authority = config authority
#   VELLO_ORACLE_SECRET=<base64|json|path>     # becomes PlatformConfig.oracle
#   NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET=<pubkey>
#   NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID=<pubkey>   # must equal the built program id (REQUIRED on mainnet)
# Optional:
#   DISPUTE_WINDOW_SLOTS=9000   (~1h @ ~400ms; default 8 — SET THIS for mainnet)
#   MAX_STALENESS_SLOTS=200000
#   RPC_URL=<custom rpc for THIS cluster>   (e.g. Helius mainnet — guards stay keyed to CLUSTER)
#
# MAINNET KEYPAIR: the program id comes from target/deploy/vello_escrow-keypair.json.
# For mainnet you need a FRESH keypair (the devnet one identifies the devnet deploy):
#   cp target/deploy/vello_escrow-keypair.json ~/keys/vello_escrow-devnet-keypair.json  # back up
#   solana-keygen new --no-bip39-passphrase -o target/deploy/vello_escrow-keypair.json
# and back the NEW one up somewhere safe too — it IS the mainnet program identity.
set -euo pipefail

CLUSTER="${CLUSTER:-devnet}"
DISPUTE_WINDOW_SLOTS="${DISPUTE_WINDOW_SLOTS:-8}"
MAX_STALENESS_SLOTS="${MAX_STALENESS_SLOTS:-200000}"
PROGRAM_NAME="vello_escrow"
IDL_SRC="target/idl/${PROGRAM_NAME}.json"
IDL_DST="lib/vello-escrow-idl.json"
DEVNET_ESCROW_ID="Gztj63kcdst6YrdyCGPoWAgLqDGJZAG43UQqtDY8HVxx"
DEPLOYER_WALLET="${DEPLOYER_WALLET:-${ANCHOR_WALLET:-$HOME/.config/solana/id.json}}"
DEPLOYER_WALLET="${DEPLOYER_WALLET/#\~/$HOME}"   # expand a literal ~ (quoted env vars don't)

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v anchor >/dev/null || die "anchor not found — install the Anchor toolchain (>=0.31.1)"
command -v solana >/dev/null || die "solana CLI not found"

# CLUSTER must be a literal cluster name so every mainnet guard below stays armed.
# For a custom endpoint (e.g. Helius — recommended for the mainnet deploy; the public
# endpoint is flaky for large program writes) keep CLUSTER=mainnet and set RPC_URL.
case "${CLUSTER}" in
  devnet)  NETWORK="devnet";       DEFAULT_RPC="https://api.devnet.solana.com" ;;
  mainnet) NETWORK="mainnet-beta"; DEFAULT_RPC="https://api.mainnet-beta.solana.com" ;;
  *) die "CLUSTER must be 'devnet' or 'mainnet' (got '${CLUSTER}'). Use RPC_URL=<url> for a custom endpoint." ;;
esac
RPC_URL="${RPC_URL:-${DEFAULT_RPC}}"
# anchor accepts a URL as --provider.cluster; using RPC_URL here keeps deploy, config
# init (step 6) and verification (step 7) all pointed at the SAME cluster.
ANCHOR_CLUSTER="${RPC_URL}"

[ -f "${DEPLOYER_WALLET}" ] || die "deployer wallet not found at ${DEPLOYER_WALLET} (set DEPLOYER_WALLET=)"

if [ "${CLUSTER}" = "mainnet" ]; then
  [ "${CONFIRM_MAINNET:-}" = "yes" ] || die "mainnet deploy requires CONFIRM_MAINNET=yes (this spends real SOL and creates the permanent program identity)"
  # ~150 slots ≈ 1 min at ~400ms/slot. Runbook target is 9000 (~1h).
  [ "${DISPUTE_WINDOW_SLOTS}" -lt 150 ] && \
    die "refusing mainnet deploy with DISPUTE_WINDOW_SLOTS=${DISPUTE_WINDOW_SLOTS} (<~1min). Set DISPUTE_WINDOW_SLOTS=9000 (~1h)."
fi
[ "${DISPUTE_WINDOW_SLOTS}" -lt "${MAX_STALENESS_SLOTS}" ] || \
  die "DISPUTE_WINDOW_SLOTS (${DISPUTE_WINDOW_SLOTS}) must be < MAX_STALENESS_SLOTS (${MAX_STALENESS_SLOTS})"
: "${VELLO_ORACLE_SECRET:?set VELLO_ORACLE_SECRET}"
: "${NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET:?set NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET}"
# Pre-flight the crank key too — step 7 verifies it, and a mainnet run must not
# discover a missing env var AFTER the deploy spend.
[ "${CLUSTER}" = "mainnet" ] && : "${VELLO_CRANK_SECRET:?set VELLO_CRANK_SECRET (verified in step 7; required for mainnet)}"

# The mainnet program identity must not be the devnet keypair (see header).
if [ "${CLUSTER}" = "mainnet" ] && [ -f "target/deploy/${PROGRAM_NAME}-keypair.json" ]; then
  KP_PUB="$(solana-keygen pubkey "target/deploy/${PROGRAM_NAME}-keypair.json")"
  [ "${KP_PUB}" = "${DEVNET_ESCROW_ID}" ] && \
    die "target/deploy/${PROGRAM_NAME}-keypair.json is the DEVNET keypair (${DEVNET_ESCROW_ID}). Generate a fresh mainnet keypair first — see the MAINNET KEYPAIR note in this script's header."
fi

say "1/7 anchor build -p ${PROGRAM_NAME} (generate program keypair if missing)"
anchor build -p "${PROGRAM_NAME}"

say "2/7 anchor keys sync -p ${PROGRAM_NAME} (write the real program id into declare_id! + Anchor.toml)"
anchor keys sync -p "${PROGRAM_NAME}"
warn "keys sync rewrites EVERY [programs.*] entry for ${PROGRAM_NAME} in Anchor.toml AND declare_id!."
warn "After a MAINNET run: restore the devnet id in [programs.devnet] + [[test.genesis]] if you keep devnet active (git diff Anchor.toml programs/)."

say "3/7 anchor build -p ${PROGRAM_NAME} (rebuild with the synced declare_id!)"
anchor build -p "${PROGRAM_NAME}"

PROG_ID="$(anchor keys list | awk -v p="${PROGRAM_NAME}:" '$1 == p {print $NF}')"
[ -n "${PROG_ID}" ] || die "could not resolve program id from 'anchor keys list'"
say "program id = ${PROG_ID}  (deployer wallet = ${DEPLOYER_WALLET}, cluster = ${CLUSTER} via ${RPC_URL%%\?*})"

if [ -n "${NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID:-}" ] && [ "${NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID}" != "${PROG_ID}" ]; then
  die "NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID (${NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID}) != built id (${PROG_ID}). Update it (build-baked → Railway rebuild) and re-run."
fi
if [ -z "${NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID:-}" ]; then
  # On mainnet, dying AFTER anchor deploy would strand a program with no config —
  # the init front-run race the gate exists for. Fail BEFORE spending SOL.
  [ "${CLUSTER}" = "mainnet" ] && die "NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID must be set (=${PROG_ID}) for a mainnet run — step 6 hard-requires it."
  warn "NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID unset — set it to ${PROG_ID} (build-baked; Railway rebuild required)"
  export NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID="${PROG_ID}"
fi

say "4/7 anchor deploy -p ${PROGRAM_NAME} --provider.cluster ${CLUSTER} (mainnet: fund deployer ~8 SOL — ~6.9 SOL rent at default 2x headroom + fees)"
anchor deploy -p "${PROGRAM_NAME}" \
  --provider.cluster "${ANCHOR_CLUSTER}" \
  --provider.wallet "${DEPLOYER_WALLET}"

say "5/7 copy the regenerated IDL → ${IDL_DST} (with address = ${PROG_ID})"
[ -f "${IDL_SRC}" ] || die "built IDL ${IDL_SRC} not found"
if command -v jq >/dev/null; then
  jq --arg a "${PROG_ID}" '.address = $a' "${IDL_SRC}" > "${IDL_DST}"
else
  cp "${IDL_SRC}" "${IDL_DST}"
  warn "jq not found — confirm ${IDL_DST} \"address\" == ${PROG_ID} by hand"
fi

say "6/7 init/update PlatformConfig on ${CLUSTER} (dispute=${DISPUTE_WINDOW_SLOTS}, staleness=${MAX_STALENESS_SLOTS}) as the upgrade authority"
# init-platform-config.ts resolves its cluster via NEXT_PUBLIC_SOLANA_NETWORK (tsx
# loads no .env.local) and its signer via ADMIN_KEYPAIR_PATH — export BOTH so step 6
# hits the SAME cluster and wallet as the deploy above. EXPECTED_CLUSTER makes the
# script hard-verify the genesis hash before sending anything.
NEXT_PUBLIC_SOLANA_NETWORK="${NETWORK}" \
RPC_URL="${RPC_URL}" \
ADMIN_KEYPAIR_PATH="${DEPLOYER_WALLET}" \
EXPECTED_CLUSTER="${NETWORK}" \
DISPUTE_WINDOW_SLOTS="${DISPUTE_WINDOW_SLOTS}" MAX_STALENESS_SLOTS="${MAX_STALENESS_SLOTS}" \
  npx tsx scripts/init-platform-config.ts

say "7/7 verify oracle/crank keys against the on-chain config (cluster = ${CLUSTER})"
if [ "${CLUSTER}" = "mainnet" ]; then
  RPC_URL="${RPC_URL}" NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID="${PROG_ID}" node scripts/verify-oracle-keys.mjs || \
    die "verify-oracle-keys FAILED on mainnet — fund/rotate the keys before opening traffic (config is live; do not skip this)"
else
  RPC_URL="${RPC_URL}" NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID="${PROG_ID}" node scripts/verify-oracle-keys.mjs || \
    warn "verify-oracle-keys reported an issue — fund/rotate before opening traffic"
fi

say "done. Next: confirm via 'RPC_URL=${RPC_URL%%\?*}… node scripts/read-platform-config.mjs', run the §F smoke test, then Railway rebuild if NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID changed."

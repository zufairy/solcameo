#!/usr/bin/env bash
#
# One-shot agent-vault deploy: build → sync program id → build → deploy → copy IDL.
#
# ⚠️ REVIEW BEFORE RUNNING — this deploys a money contract. Run from apps/web.
# Unlike the escrow there is NO singleton config to init: vaults are created
# per-agent at mint time (init_vault). Deploying the program is the whole job.
#
# Usage:
#   CLUSTER=devnet ./scripts/deploy-agent-vault.sh
#   CLUSTER=mainnet CONFIRM_MAINNET=yes ./scripts/deploy-agent-vault.sh
#
# Required env:
#   DEPLOYER_WALLET=~/.config/solana/id.json    # deployer = upgrade authority
#   NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID=<pubkey> # must equal the built id (REQUIRED on mainnet)
# Optional:
#   RPC_URL=<custom rpc for THIS cluster>       # e.g. Helius mainnet
#
# MAINNET KEYPAIR: the program id comes from target/deploy/agent_vault-keypair.json.
# For mainnet generate a FRESH keypair (back up the devnet one first):
#   cp target/deploy/agent_vault-keypair.json ~/keys/agent_vault-devnet-keypair.json
#   solana-keygen new --no-bip39-passphrase -o target/deploy/agent_vault-keypair.json
#
# AFTER a mainnet deploy, propagate the new id IN LOCKSTEP to:
#   - NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID in Railway (build arg — rebuild required) + Convex + .env.local
#   - lib/agent-vault-idl.json `address` (this script writes it)
#   - restore the devnet id in Anchor.toml [programs.devnet] if you keep devnet active
set -euo pipefail

CLUSTER="${CLUSTER:-devnet}"
PROGRAM_NAME="agent_vault"
IDL_SRC="target/idl/${PROGRAM_NAME}.json"
IDL_DST="lib/agent-vault-idl.json"
DEVNET_VAULT_ID="93RLwdPcyuNFFougLvRLe7912oJBfq77Y8ZNYXQZD6CP"
DEPLOYER_WALLET="${DEPLOYER_WALLET:-${ANCHOR_WALLET:-$HOME/.config/solana/id.json}}"
DEPLOYER_WALLET="${DEPLOYER_WALLET/#\~/$HOME}"   # expand a literal ~ (quoted env vars don't)

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v anchor >/dev/null || die "anchor not found — install the Anchor toolchain (>=0.31.1)"
command -v solana >/dev/null || die "solana CLI not found"

case "${CLUSTER}" in
  devnet)  DEFAULT_RPC="https://api.devnet.solana.com" ;;
  mainnet) DEFAULT_RPC="https://api.mainnet-beta.solana.com" ;;
  *) die "CLUSTER must be 'devnet' or 'mainnet' (got '${CLUSTER}'). Use RPC_URL=<url> for a custom endpoint." ;;
esac
RPC_URL="${RPC_URL:-${DEFAULT_RPC}}"

[ -f "${DEPLOYER_WALLET}" ] || die "deployer wallet not found at ${DEPLOYER_WALLET} (set DEPLOYER_WALLET=)"

if [ "${CLUSTER}" = "mainnet" ]; then
  [ "${CONFIRM_MAINNET:-}" = "yes" ] || die "mainnet deploy requires CONFIRM_MAINNET=yes (this spends real SOL and creates the permanent program identity)"
  if [ -f "target/deploy/${PROGRAM_NAME}-keypair.json" ]; then
    KP_PUB="$(solana-keygen pubkey "target/deploy/${PROGRAM_NAME}-keypair.json")"
    [ "${KP_PUB}" = "${DEVNET_VAULT_ID}" ] && \
      die "target/deploy/${PROGRAM_NAME}-keypair.json is the DEVNET keypair (${DEVNET_VAULT_ID}). Generate a fresh mainnet keypair first — see this script's header."
  fi
fi

say "1/5 anchor build -p ${PROGRAM_NAME}"
anchor build -p "${PROGRAM_NAME}"

say "2/5 anchor keys sync -p ${PROGRAM_NAME}"
anchor keys sync -p "${PROGRAM_NAME}"
warn "keys sync rewrites Anchor.toml [programs.*] + declare_id! for ${PROGRAM_NAME} — git diff after a mainnet run."

say "3/5 anchor build -p ${PROGRAM_NAME} (rebuild with the synced declare_id!)"
anchor build -p "${PROGRAM_NAME}"

PROG_ID="$(anchor keys list | awk -v p="${PROGRAM_NAME}:" '$1 == p {print $NF}')"
[ -n "${PROG_ID}" ] || die "could not resolve program id from 'anchor keys list'"
say "program id = ${PROG_ID}  (deployer wallet = ${DEPLOYER_WALLET}, cluster = ${CLUSTER} via ${RPC_URL%%\?*})"

if [ -n "${NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID:-}" ] && [ "${NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID}" != "${PROG_ID}" ]; then
  die "NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID (${NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID}) != built id (${PROG_ID}). Update it (build-baked → Railway rebuild) and re-run."
fi
if [ -z "${NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID:-}" ]; then
  [ "${CLUSTER}" = "mainnet" ] && die "NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID must be set (=${PROG_ID}) for a mainnet run — the client falls back to the DEVNET id without it."
  warn "NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID unset — set it to ${PROG_ID} (build-baked; Railway rebuild required)"
fi

say "4/5 anchor deploy -p ${PROGRAM_NAME} --provider.cluster ${RPC_URL%%\?*} (mainnet: fund deployer ~5 SOL — ~4.1 SOL rent at default 2x headroom + fees)"
anchor deploy -p "${PROGRAM_NAME}" \
  --provider.cluster "${RPC_URL}" \
  --provider.wallet "${DEPLOYER_WALLET}"

say "5/5 copy the regenerated IDL → ${IDL_DST} (with address = ${PROG_ID})"
[ -f "${IDL_SRC}" ] || die "built IDL ${IDL_SRC} not found"
if command -v jq >/dev/null; then
  jq --arg a "${PROG_ID}" '.address = $a' "${IDL_SRC}" > "${IDL_DST}"
else
  cp "${IDL_SRC}" "${IDL_DST}"
  warn "jq not found — confirm ${IDL_DST} \"address\" == ${PROG_ID} by hand"
fi

say "verify: program live + upgrade authority"
solana program show "${PROG_ID}" --url "${RPC_URL}" || die "program ${PROG_ID} not visible on ${CLUSTER} — deploy did not complete"

say "done. Vaults init per-agent at mint — verify the FIRST mainnet mint creates its vault under ${PROG_ID}, then Railway rebuild if NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID changed."

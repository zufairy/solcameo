#!/usr/bin/env node
/**
 * Stale / FORMAT IDL guard for the campaign-treasury (oracle) escrow program.
 *
 * Validates an Anchor 0.30/0.31 IDL for the NEW oracle program shape AND the
 * 0.30+ on-chain IDL FORMAT (a name-only check would green-light a *format*-stale
 * IDL the JS client mis-reads). Checks:
 *   - required instructions  (recordPerformance, claimPayout, updateCampaignRate)
 *   - required accounts       (Campaign, ClaimRecord, PlatformConfig)
 *   - 0.30+ FORMAT: top-level `address`, per-instruction + per-account
 *     `discriminator` arrays, and the ABSENCE of legacy 0.29 keys
 *     (isMut / isSigner on accounts; the "publicKey" type — 0.30+ uses "pubkey").
 *
 * Usage:
 *   node scripts/check-escrow-idl.mjs [path-to-idl.json]
 *
 * Defaults to ../lib/vello-escrow-idl.json. NOTE: the oracle bake-off keeps its
 * freshly-built IDL ISOLATED (target/idl/vello_escrow.json) instead of clobbering
 * the shared committed IDL, so validate the fresh one explicitly:
 *   node scripts/check-escrow-idl.mjs target/idl/vello_escrow.json
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IDL_PATH = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(__dirname, "../lib/vello-escrow-idl.json");

// Instructions the new program must expose (Anchor emits camelCase names).
const REQUIRED_INSTRUCTIONS = ["recordPerformance", "claimPayout", "updateCampaignRate"];
// Accounts the new program must expose (Anchor emits PascalCase struct names).
const REQUIRED_ACCOUNTS = ["Campaign", "ClaimRecord", "PlatformConfig"];

let idl;
try {
  idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
} catch (err) {
  console.error(`✗ Could not read/parse IDL at ${IDL_PATH}: ${err.message}`);
  process.exit(2);
}

const errors = [];

// --- name freshness ---
// Normalize by stripping case AND separators: Anchor 0.30+ emits snake_case IDL
// names (record_performance) while the JS client + this list use camelCase
// (recordPerformance). Compare on the alphanumeric core so both match.
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const haveInstructions = new Set((idl.instructions ?? []).map((i) => norm(i.name)));
const haveAccounts = new Set((idl.accounts ?? []).map((a) => norm(a.name)));
const missingInstructions = REQUIRED_INSTRUCTIONS.filter(
  (n) => !haveInstructions.has(norm(n)),
);
const missingAccounts = REQUIRED_ACCOUNTS.filter(
  (n) => !haveAccounts.has(norm(n)),
);
if (missingInstructions.length > 0) {
  errors.push(`Missing instructions: ${missingInstructions.join(", ")}`);
}
if (missingAccounts.length > 0) {
  errors.push(`Missing accounts: ${missingAccounts.join(", ")}`);
}

// --- 0.30+ FORMAT assertions ---
if (typeof idl.address !== "string" || idl.address.length === 0) {
  errors.push("Top-level `address` (program id) missing — not a 0.30+ IDL.");
}
for (const ix of idl.instructions ?? []) {
  if (!Array.isArray(ix.discriminator) || ix.discriminator.length === 0) {
    errors.push(`Instruction "${ix.name}" has no discriminator array (stale 0.29 format).`);
  }
}
for (const acc of idl.accounts ?? []) {
  if (!Array.isArray(acc.discriminator) || acc.discriminator.length === 0) {
    errors.push(`Account "${acc.name}" has no discriminator array (stale 0.29 format).`);
  }
}

// --- ABSENCE of legacy 0.29 keys (deep scan of the serialized IDL) ---
const serialized = JSON.stringify(idl);
if (/"isMut"\s*:/.test(serialized)) {
  errors.push('Legacy key "isMut" present — 0.29-format IDL (0.30+ drops it).');
}
if (/"isSigner"\s*:/.test(serialized)) {
  errors.push('Legacy key "isSigner" present — 0.29-format IDL (0.30+ uses "signer").');
}
if (/"publicKey"/.test(serialized)) {
  errors.push('Legacy type "publicKey" present — 0.30+ uses "pubkey".');
}

if (errors.length === 0) {
  console.log(`[check-escrow-idl] ${IDL_PATH} is up to date + valid 0.30+ format ✓`);
  process.exit(0);
}

console.error(`\n✗ IDL CHECK FAILED for ${IDL_PATH}:\n`);
for (const e of errors) console.error(`  - ${e}`);
console.error(
  "\nRebuild the program and re-validate the freshly built IDL:\n\n" +
    "    anchor build\n" +
    "    node scripts/check-escrow-idl.mjs target/idl/vello_escrow.json\n",
);
process.exit(1);

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getNetwork, getRpcUrl, getUsdcMint, USDC_MINT_BY_NETWORK } from "@/lib/solana/network";
import { loadMasterKey } from "@/lib/server/walletCrypto";

export type CheckLevel = "ok" | "warn" | "fail";
export interface ReadinessCheck { id: string; level: CheckLevel; detail: string }

const GENESIS_MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const MIN_SIGNER_SOL = Number(process.env.VELLO_MIN_SETTLEMENT_SIGNER_SOL ?? process.env.VELLO_MIN_SIGNER_SOL ?? 0.05);

const add = (out: ReadinessCheck[], id: string, level: CheckLevel, detail: string) => { out.push({ id, level, detail }); };

function parseSecret(raw: string | undefined): Keypair | null {
  if (!raw) return null;
  try {
    const t = raw.trim();
    if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
    try { const b = bs58.decode(t); if (b.length === 64) return Keypair.fromSecretKey(b); } catch { /* try base64 */ }
    const b = Buffer.from(t, "base64");
    return b.length === 64 ? Keypair.fromSecretKey(b) : null;
  } catch { return null; }
}

/**
 * Everything that must be true before real money moves. Reports values it can show safely (public addresses,
 * balances) and only ever "set / not set / invalid" for secrets. Never throws.
 */
export async function mainnetReadiness(): Promise<{ ready: boolean; network: string; checks: ReadinessCheck[] }> {
  const checks: ReadinessCheck[] = [];
  const network = getNetwork();
  const mainnet = network === "mainnet-beta";
  add(checks, "network", mainnet ? "ok" : "fail", mainnet ? "NEXT_PUBLIC_SOLANA_NETWORK is mainnet-beta" : `NEXT_PUBLIC_SOLANA_NETWORK resolves to ${network}; set it to mainnet-beta and rebuild (it is inlined at build time)`);

  // RPC: reachable, really mainnet, and not the throttled public endpoint.
  const rpcUrl = process.env.SOLCAMEO_DBC_RPC_URL || getRpcUrl("mainnet-beta");
  let connection: Connection | null = null;
  try {
    connection = new Connection(rpcUrl, "confirmed");
    const genesis = await connection.getGenesisHash();
    add(checks, "rpc.chain", genesis === GENESIS_MAINNET ? "ok" : "fail", genesis === GENESIS_MAINNET ? "RPC reports Solana mainnet genesis" : "RPC is NOT Solana mainnet; no transaction should be sent");
  } catch { add(checks, "rpc.chain", "fail", "RPC unreachable"); }
  add(checks, "rpc.provider", /api\.mainnet-beta\.solana\.com/.test(rpcUrl) ? "warn" : "ok", /api\.mainnet-beta\.solana\.com/.test(rpcUrl) ? "Using the rate-limited public RPC; set NEXT_PUBLIC_HELIUS_API_KEY (or SOLCAMEO_DBC_RPC_URL) for production" : "Dedicated RPC provider configured");

  // USDC: every balance/transfer path resolves its mint from here.
  const usdc = getUsdcMint("mainnet-beta");
  const override = process.env.NEXT_PUBLIC_USDC_MINT?.trim();
  const usdcOk = usdc === USDC_MINT_BY_NETWORK["mainnet-beta"] && (!override || override === USDC_MINT_BY_NETWORK["mainnet-beta"]);
  add(checks, "usdc.mint", usdcOk ? "ok" : "fail", usdcOk ? "Canonical mainnet USDC mint" : `USDC mint override ${override} is not the canonical mainnet mint`);
  if (connection && usdcOk) {
    try {
      const info = await connection.getAccountInfo(new PublicKey(usdc), "confirmed");
      add(checks, "usdc.onchain", info ? "ok" : "fail", info ? "USDC mint exists on this RPC" : "USDC mint account not found on this RPC");
    } catch { add(checks, "usdc.onchain", "warn", "Could not read the USDC mint account"); }
  }

  // Custody: agent keys are encrypted at rest, and plaintext fallbacks are off.
  let keyOk = false;
  try { keyOk = loadMasterKey() !== null; } catch { keyOk = false; }
  add(checks, "wallets.encryption", keyOk ? "ok" : "fail", keyOk ? "WALLET_ENCRYPTION_KEY is set and valid" : "WALLET_ENCRYPTION_KEY missing or malformed: agent wallet keys would be stored unencrypted");
  add(checks, "wallets.plaintext", process.env.ALLOW_PLAINTEXT_WALLET_SECRETS === "true" ? "fail" : "ok", process.env.ALLOW_PLAINTEXT_WALLET_SECRETS === "true" ? "ALLOW_PLAINTEXT_WALLET_SECRETS=true must not be set on mainnet" : "Plaintext wallet secrets are disallowed");
  const cron = process.env.INTERNAL_CRON_SECRET ?? "";
  add(checks, "secret.internal", cron.length >= 32 ? "ok" : "fail", cron.length >= 32 ? "INTERNAL_CRON_SECRET is set (32+ chars)" : "INTERNAL_CRON_SECRET missing or shorter than 32 characters");

  // Signers must be valid and funded; they pay network fees for every settlement and launch operation.
  for (const [id, name] of [["signer.feePayer", "PLATFORM_FEE_PAYER_SECRET"], ["signer.dbcTreasury", "SOLCAMEO_DBC_TREASURY_SECRET"]] as const) {
    const kp = parseSecret(process.env[name]);
    if (!kp) { add(checks, id, "fail", `${name} missing or not a valid 64-byte keypair`); continue; }
    if (!connection) { add(checks, id, "warn", `${name} valid (${kp.publicKey.toBase58()}); balance not checked`); continue; }
    try {
      const sol = (await connection.getBalance(kp.publicKey, "confirmed")) / 1e9;
      add(checks, id, sol >= MIN_SIGNER_SOL ? "ok" : "fail", `${kp.publicKey.toBase58()} holds ${sol.toFixed(4)} SOL${sol >= MIN_SIGNER_SOL ? "" : `; needs at least ${MIN_SIGNER_SOL} SOL`}`);
    } catch { add(checks, id, "warn", `${name} valid (${kp.publicKey.toBase58()}); balance unreadable`); }
  }
  const treasury = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET?.trim();
  let treasuryOk = false;
  try { treasuryOk = !!treasury && !!new PublicKey(treasury); } catch { treasuryOk = false; }
  add(checks, "treasury.wallet", treasuryOk ? "ok" : "fail", treasuryOk ? `Treasury ${treasury}` : "NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET missing or invalid: settlements have no destination");

  let platformOk = false;
  try { platformOk = !!new PublicKey(process.env.SOLCAMEO_PLATFORM_WALLET ?? ""); } catch { platformOk = false; }
  add(checks, "platform.wallet", platformOk ? "ok" : "fail", platformOk ? "SOLCAMEO_PLATFORM_WALLET (launch fee recipient) is set" : "SOLCAMEO_PLATFORM_WALLET missing or invalid: launch fees have no recipient");

  // Token launches run on Meteora's own programs; custom programs are optional for this launch.
  add(checks, "dbc.enabled", process.env.SOLCAMEO_DBC_LIVE_ENABLED === "true" ? "ok" : "fail", process.env.SOLCAMEO_DBC_LIVE_ENABLED === "true" ? "Mainnet token launches enabled" : "Set SOLCAMEO_DBC_LIVE_ENABLED=true to allow mainnet launches");
  const vaultOn = process.env.SOLCAMEO_AGENT_VAULT_ENABLED === "true";
  if (!vaultOn) add(checks, "vault", "ok", "Agent vault contract disabled: agents use custodial wallets with backend spend caps");
  else if (!process.env.NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID) add(checks, "vault", "fail", "SOLCAMEO_AGENT_VAULT_ENABLED=true but NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID is unset");
  else if (connection) {
    try {
      const info = await connection.getAccountInfo(new PublicKey(process.env.NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID), "confirmed");
      add(checks, "vault", info?.executable ? "ok" : "fail", info?.executable ? "Agent vault program is deployed on mainnet" : "Agent vault program is NOT deployed on this network");
    } catch { add(checks, "vault", "warn", "Could not verify the agent vault program"); }
  }
  if (process.env.X402_ENABLED === "true" && process.env.X402_NETWORK && !process.env.X402_NETWORK.includes("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d")) add(checks, "x402", "fail", "X402 is enabled on a non-mainnet network");

  return { ready: !checks.some((c) => c.level === "fail"), network, checks };
}

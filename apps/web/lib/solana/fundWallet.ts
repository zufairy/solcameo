// Shared agent-wallet funding helpers — used by the trader deposit modal AND the
// influencer chat funding card so the transfer logic lives in one place.
//
// A funding transfer ALWAYS moves the operator's own USDC/SOL to the agent's
// on-chain wallet and REQUIRES the operator to sign in their wallet — an agent
// can never move funds without that signature. The "agentic" part is that the
// agent prepares the transfer (recipient + recommended amount); the operator
// just approves it.

import {
  Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL,
  Transaction, TransactionInstruction, VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import { getNetwork, getUsdcMint } from "./network";
import { rpcTry, rpcCandidates } from "./rpc";
import { splitFundingAmount } from "./fundingFee";
import { computeBudgetInstructions, estimatePriorityPrice, landTransaction } from "./landTransaction";

const USDC_DECIMALS = 6;
// Failover over public devnet → Helius. The devnet Helius key is suspended
// (403 "subscription suspended") so a single hardcoded Helius connection made
// every deposit fail before broadcast — the "money doesn't land" report.
const RPC_CANDIDATES = rpcCandidates();

export type FundToken = "USDC" | "SOL";

/**
 * Decide whether to block a funding transfer for lack of SOL.
 *
 * A `null` balance means the RPC read FAILED (rate-limited / flaky devnet
 * endpoint) — it is NOT the same as a real 0. We must never treat a failed read
 * as "0 SOL" and false-block a wallet that actually has SOL (the devnet-RPC-read
 * gotcha). Block ONLY when we actually read a balance that's genuinely below the
 * fee floor; if the read failed, let the transfer proceed — a real no-SOL wallet
 * still gets a clear error downstream (pre-simulation / send).
 */
export function shouldBlockForSol(balanceOrNull: number | null, floor: number): boolean {
  return balanceOrNull !== null && balanceOrNull < floor;
}

/**
 * Read an owner's SOL balance, returning `null` (never a fabricated 0) when the
 * read fails. Retries once against a reliable READ RPC (Helius when configured)
 * so a single flaky devnet read can't produce a false "you need SOL" block.
 */
async function readSolBalanceOrNull(owner: PublicKey): Promise<number | null> {
  try {
    return await rpcTry(RPC_CANDIDATES, async (conn) => {
      const lamports = await conn.getBalance(owner, "confirmed");
      return lamports / LAMPORTS_PER_SOL;
    });
  } catch {
    return null; // read genuinely failed — caller must NOT treat this as 0
  }
}

/**
 * Confirm a transaction by POLLING its signature status over HTTP — robust where
 * connection.confirmTransaction() hangs forever waiting on a flaky RPC websocket
 * subscription (the usual cause of a stuck "Confirming…" after the user approves).
 * Resolves "confirmed" once on-chain, throws on an on-chain error, and returns
 * "pending" (never hangs) if it's submitted but not yet visible within the window.
 */
/** Transfers this tab just sent, so confirming one also keeps re-broadcasting it and knows when it can no longer land. */
const sentTransfers = new Map<string, { raw: Uint8Array; lastValidBlockHeight: number }>();

export async function confirmSignature(
  connection: Connection,
  signature: string,
  timeoutMs = 60_000,
): Promise<"confirmed" | "pending"> {
  const sent = sentTransfers.get(signature);
  if (sent) {
    const result = await landTransaction({ ...sent, signature, urls: RPC_CANDIDATES, maxMs: timeoutMs });
    if (result !== "pending") sentTransfers.delete(signature);
    if (result === "expired") throw new Error("The network didn't include this transfer in time, so nothing was deducted. Please try again.");
    return result;
  }
  // `connection` kept for call-site compatibility; we poll via the failover
  // candidates since the primary (Helius) may be suspended/rate-limited.
  void connection;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { value } = await rpcTry(RPC_CANDIDATES, async (conn) =>
        conn.getSignatureStatus(signature, { searchTransactionHistory: true }), 4000,
      );
      if (value?.err) throw new Error(`The transaction failed on-chain: ${JSON.stringify(value.err)}`);
      if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") return "confirmed";
    } catch {
      // Single candidate sweep failed (429/suspended/timeout) — ignore and retry;
      // "pending" is returned only after the whole window elapses with no success.
    }
    await new Promise((r) => setTimeout(r, 450));
  }
  return "pending";
}

/** Reject with a clear message if a wallet call never resolves (silent hang). */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Platform fee recipient. Fails closed: a deposit never goes out without its 3% fee leg. */
function platformFeeRecipient(): PublicKey {
  const raw = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET?.trim();
  try { if (raw) return new PublicKey(raw); } catch { /* fall through */ }
  throw new Error("Platform fee wallet is not configured, so deposits are paused. Please try again later.");
}

/**
 * Build + send a funding transfer from the operator's wallet to the agent wallet.
 * Returns the signature + the blockhash window so the caller can confirm it.
 * Throws with a human-readable message on any failure.
 */
export async function sendFundingTransfer(params: {
  connection: Connection;
  publicKey: PublicKey;
  // Just SIGN in the wallet — signTransaction reliably prompts Phantom. We build a
  // VERSIONED (v0) transaction: modern Phantom signs v0 reliably and throws an
  // opaque "Unexpected error" on legacy Transactions. We broadcast the signed tx
  // ourselves via OUR devnet RPC so the send lands on devnet under our control.
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  agentWallet: string;
  token: FundToken;
  amount: number;
}): Promise<{ sig: string; blockhash: string; lastValidBlockHeight: number; raw: Uint8Array }> {
  const { publicKey, signTransaction, agentWallet, token, amount } = params;
  const mainnet = getNetwork() === "mainnet-beta";
  if (!(amount > 0)) throw new Error("Enter a positive amount");
  // 3% platform fee: one transaction, two transfers (agent gets 97%, treasury 3%), so both succeed or neither does.
  const feeRecipient = platformFeeRecipient();
  const baseUnits = (decimals: number) => BigInt(Math.floor(amount * Math.pow(10, decimals)));

  let recipient: PublicKey;
  try { recipient = new PublicKey(agentWallet); }
  catch { throw new Error("The agent wallet address is invalid — re-mint or refresh the agent."); }

  // The operator pays network fees (and ATA rent for a first USDC transfer) in
  // SOL. Without a little devnet SOL the transfer fails with an opaque wallet
  // error, so check up front. CRUCIAL: a FAILED balance read (flaky/rate-limited
  // devnet RPC) returns null — NOT 0 — so we never false-block a wallet that
  // actually has SOL. If the read failed we skip this pre-check and let the real
  // send surface the genuine reason (see the pre-simulation + downstream error).
  // The reads below are independent, so start them together instead of one after another: the wallet prompt
  // only waits for the slowest single round trip rather than the sum of all of them.
  const usdcMintKey = token === "USDC" ? new PublicKey(getUsdcMint()) : null;
  const solBalP = readSolBalanceOrNull(publicKey);
  // Priority fee at the going rate for these accounts, fetched alongside the other reads (never blocks for long).
  const computeUnits = token === "USDC" ? 90_000 : 30_000;
  const priorityP = estimatePriorityPrice([publicKey.toBase58(), agentWallet, feeRecipient.toBase58()], computeUnits);
  const senderAccountP = usdcMintKey
    ? getAssociatedTokenAddress(usdcMintKey, publicKey).then((ata) => rpcTry(RPC_CANDIDATES, async (conn) => getAccount(conn, ata, "confirmed")).then(() => null, (e: unknown) => e))
    : Promise.resolve(null);
  const blockhashP = rpcTry(RPC_CANDIDATES, async (conn) => {
    const [genesis, latest] = await Promise.all([mainnet ? conn.getGenesisHash() : Promise.resolve(""), conn.getLatestBlockhash("confirmed")]);
    if (mainnet && genesis !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error("RPC network mismatch. Deposit was not started.");
    return latest;
  });
  blockhashP.catch(() => undefined); // surfaced when awaited below; never an unhandled rejection
  const solBal = await solBalP;
  const feeHeadroom = token === "USDC" ? 0.005 : 0.001; // USDC: network fee + two token-account rents (agent, platform fee)
  if (shouldBlockForSol(solBal, feeHeadroom)) {
    throw new Error(mainnet ? "Your connected wallet needs SOL for network fees and the first USDC account. Deposit a little SOL, then retry." : `You need a little devnet SOL to cover network fees (you have ${(solBal ?? 0).toFixed(4)} SOL). Get some free at faucet.solana.com, then try again.`);
  }

  const instructions: TransactionInstruction[] = [];

  if (token === "USDC") {
    const usdcMint = new PublicKey(getUsdcMint());
    const fromAta = await getAssociatedTokenAddress(usdcMint, publicKey);
    const toAta = await getAssociatedTokenAddress(usdcMint, recipient);

    // The operator must actually hold devnet USDC (their token account must exist).
    {
      const e = await senderAccountP;
      if (e instanceof TokenAccountNotFoundError) {
        if (mainnet) throw new Error("Your connected wallet has no Solana USDC. Add USDC, then retry.");
        throw new Error("Your wallet has no devnet USDC yet. Get some free at faucet.circle.com (Solana Devnet), then try again — or fund with SOL instead.");
      }
    }

    // Ensure the recipient's USDC token account exists. The IDEMPOTENT variant is
    // a no-op if the account already exists and creates it otherwise — so it can
    // never fail with "account already in use" on a first-time USDC transfer.
    const feeAta = await getAssociatedTokenAddress(usdcMint, feeRecipient, true);
    const { fee, net } = splitFundingAmount(baseUnits(USDC_DECIMALS));
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(publicKey, toAta, recipient, usdcMint));
    instructions.push(createTransferInstruction(fromAta, toAta, publicKey, net, [], TOKEN_PROGRAM_ID));
    if (fee > 0n) {
      instructions.push(createAssociatedTokenAccountIdempotentInstruction(publicKey, feeAta, feeRecipient, usdcMint));
      instructions.push(createTransferInstruction(fromAta, feeAta, publicKey, fee, [], TOKEN_PROGRAM_ID));
    }
  } else {
    const { fee, net } = splitFundingAmount(baseUnits(9));
    instructions.push(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: recipient, lamports: net }));
    if (fee > 0n) instructions.push(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: fee }));
  }

  // "confirmed" is the freshest blockhash with the full ~60-90s validity window.
  // "finalized" is ~30s stale and can EXPIRE while the user reads the wallet
  // prompt — the signed tx then silently fails to land (no deduction).
  const { blockhash, lastValidBlockHeight } = await blockhashP;

  // Build a LEGACY transaction — the SAME format the app's working invest flow
  // (InvestPanel / share-purchase-dialog) uses. A v0 VersionedTransaction here
  // triggered the wallet's opaque "Unexpected error" on some Phantom builds.
  const tx = new Transaction();
  tx.add(...computeBudgetInstructions(computeUnits, await priorityP), ...instructions);
  tx.feePayer = publicKey;
  tx.recentBlockhash = blockhash;

  // PRE-SIMULATE against OUR devnet RPC BEFORE asking the wallet to sign. This
  // surfaces the REAL failure reason — a missing/invalid agent wallet, a not-yet-
  // provisioned account, or no SOL for fees/rent — with on-chain logs, instead of
  // Phantom's opaque "Unexpected error". Crucially: if this PASSES, the tx is valid
  // on devnet, so any subsequent Phantom "Unexpected error" is conclusively Phantom
  // being on the wrong network (Mainnet) — not the transaction or the agent.
  try {
    // Bounded: a slow simulation must never hold up the wallet prompt (it only exists to explain failures).
    const sim = await rpcTry(RPC_CANDIDATES, async (conn) => conn.simulateTransaction(tx), 3500);
    if (sim.value.err) {
      const logs = sim.value.logs ?? [];
      const tail = logs.length ? ` — ${logs.slice(-3).join(" | ").slice(0, 220)}` : "";
      throw new Error(
        `This transfer would fail on devnet (so it is NOT a wallet-network issue): ${JSON.stringify(sim.value.err)}${tail}. ` +
        `Most common cause: the operator wallet needs a little devnet SOL for the network fee + the agent's first USDC-account rent (~0.003 SOL). Airdrop some at faucet.solana.com and retry.`,
      );
    }
    if (typeof console !== "undefined") console.info("[fund] devnet pre-simulation OK — tx is valid on devnet");
  } catch (e) {
    // Re-throw our own clear simulation verdict; swallow infra hiccups in the
    // simulate RPC call itself so a flaky sim never blocks a legitimate transfer.
    if (e instanceof Error && /would fail on devnet/.test(e.message)) throw e;
  }

  // ALGORITHM: the wallet's ONLY job is to produce a signature. We then broadcast
  // and confirm ourselves through our own devnet RPC, so every step after signing
  // is fully under our control and observable (no reliance on the wallet's send,
  // its RPC, or its websocket). This is what makes the transfer reliable.
  let sig: string;
  let raw: Uint8Array;
  try {
    // Sign via the WALLET ADAPTER — the supported path, bound to this app's devnet
    // ConnectionProvider, and the SAME mechanism the app's working invest flow
    // uses. We deliberately no longer bypass to the raw window.phantom.solana
    // provider: that path threw an opaque "Unexpected error" on some Phantom
    // builds even for a tx that's valid on devnet. We still broadcast + confirm
    // ourselves over our devnet RPC for reliability.
    const signed = await withTimeout<Transaction>(
      Promise.resolve(signTransaction(tx)),
      90_000,
      "The wallet didn't open an approval prompt — open your wallet extension (there may be a pending request) and approve it, or reconnect and retry.",
    );
    // (Legacy .serialize() throws if the wallet returned it unsigned, so no
    // separate all-zero-signature check is needed.)

    // Broadcast through OUR RPC with preflight ON so it surfaces the real reason
    // instead of silently dropping a tx that can't land.
    raw = signed.serialize();
    sig = await rpcTry(RPC_CANDIDATES, async (conn) =>
      conn.sendRawTransaction(raw, {
        skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5,
      }),
    );
    if (typeof console !== "undefined") console.info("[fund] broadcast signature:", sig);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/user rejected|user denied|rejected the request|request.*reject/i.test(msg)) throw e; // operator said no
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logs: string[] | undefined = (e as any)?.logs;
    const detail = logs?.length ? ` — ${logs.slice(-2).join(" | ").slice(0, 160)}` : "";
    // The tx already PASSED our devnet pre-simulation above, so it is valid on
    // devnet. An opaque "Unexpected error" at signing therefore means the WALLET
    // can't sign for this network — i.e. the wallet isn't on Solana Devnet.
    const hint = /unexpected error/i.test(msg)
      ? " — The transaction is valid on devnet (it passed pre-simulation), so this is your WALLET's network: switch your wallet to Solana Devnet (Phantom → Settings → Developer Settings → Testnet Mode ON → select 'Solana Devnet'), then retry. If your wallet is already on Devnet and it still fails, tell me and I'll switch the app to mainnet to match your wallet instead."
      : "";
    throw new Error(`Transfer failed: ${msg.slice(0, 160)}${detail}${hint}`);
  }
  sentTransfers.set(sig, { raw, lastValidBlockHeight });
  if (sentTransfers.size > 20) sentTransfers.delete(sentTransfers.keys().next().value!);
  return { sig, blockhash, lastValidBlockHeight, raw };
}

/**
 * Read the SOL + USDC balance of any wallet owner.
 *
 * REJECTS on a genuine RPC read failure rather than reporting a fabricated $0 —
 * callers gate on these numbers (insufficient-USDC / need-faucet in the builder
 * deposit card), so a swallowed 0 would false-block a funded wallet. A truly
 * missing USDC token account is still a real $0 (returned, not thrown); only an
 * actual read failure propagates, letting the UI keep the last-known balance.
 */
export async function fetchWalletBalances(connection: Connection, owner: PublicKey): Promise<{ sol: number; usdc: number }> {
  // `connection` kept for call-site compatibility. Every candidate RPC is queried at once and the first good
  // answer wins, each with a short timeout, so a suspended or rate-limited endpoint can't slow the read down.
  void connection;
  const read = async (url: string) => {
    const conn = new Connection(url, {
      commitment: "confirmed",
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
    });
    const [sol, usdc] = await Promise.all([
      conn.getBalance(owner, "confirmed").then((l) => l / LAMPORTS_PER_SOL),
      (async () => {
        try {
          const ata = await getAssociatedTokenAddress(new PublicKey(getUsdcMint()), owner);
          const acc = await getAccount(conn, ata, "confirmed");
          return Number(acc.amount) / Math.pow(10, USDC_DECIMALS);
        } catch (e) {
          // No token account = a genuine $0 balance. Any OTHER error (RPC failure /
          // rate limit / suspension) must NOT be reported as $0, so it rejects this
          // candidate and another one answers.
          if (e instanceof TokenAccountNotFoundError) return 0;
          throw e;
        }
      })(),
    ]);
    return { sol, usdc };
  };
  try {
    return await Promise.any(RPC_CANDIDATES.map(read));
  } catch (e) {
    const first = e instanceof AggregateError ? e.errors[0] : e;
    throw first instanceof Error ? first : new Error("Could not read the wallet balance");
  }
}

// The agentic funding algorithm lives in a web3-free module so it's unit-testable.
export { recommendFundingUsdc } from "./fundingMath";

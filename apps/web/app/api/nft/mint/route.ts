import { NextRequest, NextResponse } from "next/server";
import { getAgentQuotaIdentity } from "@/lib/server/agentQuota";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { formatAgentDescription } from "@/lib/agentDescription";
import { normalizeClipConfig } from "@/lib/builder/clipConfig";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { encryptWalletSecret } from "@/lib/server/walletCrypto";
import { verifyUsdcDeposit } from "@/lib/trader/verifyUsdcDeposit";
import { MINT_FEE_USDC, isMintFeeDisabled, mintProofSignatureFor } from "@/lib/server/mintFee";
import { getNetwork, getUsdcMint } from "@/lib/solana/network";
import { loadKeypair } from "@/lib/server/escrowServer";
import { buildAgentVaultProgram, agentIdFromSessionId, getVaultPda, initVaultTx } from "@/lib/agentVault";

export const maxDuration = 60;

const CONVEX_URL      = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const TREASURY        = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET ?? "";
const USDC_MINT       = process.env.NEXT_PUBLIC_USDC_MINT ?? "";

const SECRET = process.env.INTERNAL_CRON_SECRET ?? "";

/**
 * Fee quote for the connected user's NEXT mint. The mint card renders FREE vs
 * $10 from this and only builds the USDC transfer when feeUsdc > 0. Display +
 * payment routing only — POST re-derives + atomically reserves the fee, so a
 * stale quote can never mint for free.
 */
export async function GET(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 503 });
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim() || undefined;
  const convex = new ConvexHttpClient(CONVEX_URL);
  if (auth.internal) {
    return NextResponse.json({ feeUsdc: 0, reason: "internal", treasury: TREASURY, usdcMint: USDC_MINT || getUsdcMint(), network: getNetwork() });
  }
  const identity = await getAgentQuotaIdentity(convex, auth.user, auth.provenWallet);
  if (wallet && !identity.creatorWallets.includes(wallet)) return NextResponse.json({ error: "Wallet does not belong to this account" }, { status: 403 });
  const { creatorWallets, creatorDid, agentLimit } = identity;
  const quote = await convex.query(api.mintFee.quoteMintFee, {
    sessionId,
    creatorWallet: wallet || creatorWallets[0] || "",
    creatorWallets,
    creatorDid,
    standardFeeUsdc: MINT_FEE_USDC,
    forceFree: isMintFeeDisabled(),
    agentLimit,
  });
  return NextResponse.json({
    feeUsdc: quote.feeUsdc,
    reason: quote.reason,
    priorMints: quote.priorMints,
    // Agent quota for the confirm card's realtime slots meter — creation is
    // free, capped at agentLimit per account.
    agentCount: Math.max(0, quote.priorMints ?? 0),
    agentLimit: (quote as { agentLimit?: number }).agentLimit ?? 1,
    treasury: TREASURY,
    usdcMint: USDC_MINT || getUsdcMint(),
    network: getNetwork(),
  });
}

// Map agent-builder type → marketplace-display type stored in DB
function normalizeAgentType(raw: string | undefined, niche: string | undefined): "influencer" | "trader" | "worker" | "clipping" {
  const v = (raw ?? "").toLowerCase();
  if (v === "influencer" || v === "trader" || v === "worker" || v === "clipping") return v;
  // Fallback: derive from niche
  const n = (niche ?? "").toLowerCase();
  if (n === "finance" || n === "crypto" || n === "trading") return "trader";
  if (n === "support" || n === "sales" || n === "operations") return "worker";
  return "influencer";
}

// Build a clean social handle from a name when the user hasn't picked one yet
function deriveHandle(name: string | undefined, sessionId: string): string {
  const cleaned = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 18);
  if (cleaned.length >= 3) return `${cleaned}_vello`;
  return `agent_${sessionId.slice(0, 6)}`;
}

export async function POST(req: NextRequest) {
  // Mint spends real (mint-authority) SOL and writes DB rows — once an anonymous
  // spam-mint / SOL-drain vector. Now gated: a user caller must present a valid
  // Privy Bearer AND prove (via SIWS, below) that they control body.creatorWallet —
  // they can only mint an agent OWNED by their own Ed25519-proven wallet. Internal
  // cron callers (X-Internal-Secret) skip the SIWS check.
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  try {
    const body = await req.json() as {
      sessionId: string;
      txSignature: string;
      creatorWallet: string;
      agentBlueprint?: {
        agentType?: string;
        persona?: {
          name?: string; handle?: string; niche?: string; audience?: string;
          language?: string; voiceArchetype?: string;
          backstory?: string; catchphrase?: string;
          contentPillars?: string[];
        };
        trader?: {
          name?: string;
          summary?: string;
          aesthetic?: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          strategy?: any;
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clipConfig?: any;
      };
      avatarUrls?: string[];
    };

    const { sessionId, txSignature, creatorWallet, agentBlueprint } = body;
    // Strip any base64 data URIs — Convex rejects fields > 1 MiB.
    // Only persist publicly addressable http(s) URLs.
    const avatarUrls = (body.avatarUrls ?? []).filter((u) => /^https?:\/\//i.test(u));

    if (!sessionId || !txSignature || !creatorWallet) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Ownership = the SIWS-proven wallet must equal the agent's creatorWallet (and
    // be linked to this Privy account). This route CREATES the agent, so there is
    // no prior owner record — we bind the new agent's owner to the proven wallet,
    // preventing a caller from minting an agent under a wallet they don't control.
    // Internal cron callers skip. requireOwnerWithSiws here treats creatorWallet as
    // the required owner: it 401s (siws_required) with no session, 403s on mismatch.
    if (!auth.internal) {
      const ownershipError = requireOwnerWithSiws(auth, creatorWallet);
      if (ownershipError) return ownershipError;
    }

    const convex = new ConvexHttpClient(CONVEX_URL);

    // ── Mint fee: a wallet's first TWO agents are free (platform-sponsored); every
    // later agent from the SAME wallet costs $10, paid as a user-signed USDC
    // transfer to the platform treasury (the user is the tx fee payer, so the
    // user pays gas; the platform still pays the NFT mint rent below). The
    // free-vs-$50 decision + the freebie claim happen ATOMICALLY and idempotently
    // per session in Convex (mintFee.reserveMintFee) against an append-only,
    // internal-only ledger keyed on the connected wallet (see mintIdentity), so:
    //   - concurrent first-mints can't all read zero (Convex OCC serializes them);
    //   - a retry / duplicate tab reuses the SAME decision (never a fresh charge);
    //   - a fully-minted session short-circuits to a resume (no duplicate agent).
    // Applies on every network (devnet charges devnet USDC); MINT_FEE_DISABLED=1
    // restores the everything-free promo. Internal callers never pay.
    // Proof of payment forwarded to completeMint. Default = the request's own
    // signature (internal callers + the free_promo_ path). The PAID branch re-pins
    // it below to the signature actually VERIFIED for this reservation, so a
    // "paid" resume can't substitute an arbitrary unverified string (H03).
    let mintProofSignature = txSignature;
    if (!auth.internal) {
      const { creatorWallets, creatorDid, agentLimit } = await getAgentQuotaIdentity(convex, auth.user, auth.provenWallet);
      const reservation = await convex.mutation(api.mintFee.reserveMintFee, {
        authSecret: SECRET,
        sessionId,
        creatorWallet,
        creatorWallets,
        creatorDid,
        standardFeeUsdc: MINT_FEE_USDC,
        forceFree: isMintFeeDisabled(),
      });

      // Idempotent resume: this session already produced an agent — return it
      // rather than minting a duplicate or re-charging.
      if (reservation.alreadyMinted && reservation.mintAddress) {
        return NextResponse.json({ ok: true, mintAddress: reservation.mintAddress, resumed: true });
      }

      if (reservation.feeUsdc > 0) {
        // PAID path. Reject the free placeholder so a $50 mint can't slip through
        // free, and verify+record the deposit only ONCE — a resumed "paid"
        // reservation skips re-verification so a post-mint retry never re-charges.
        if (reservation.status !== "paid") {
          if (/^free_promo_/.test(txSignature)) {
            return NextResponse.json({ error: "Payment required for this mint", feeUsdc: reservation.feeUsdc }, { status: 402 });
          }
          if (!TREASURY) {
            return NextResponse.json({ error: "Mint service not configured" }, { status: 503 });
          }
          try {
            await verifyUsdcDeposit({
              txSignature,
              escrowOwner: TREASURY,
              usdcMint: USDC_MINT || getUsdcMint(),
              minAmountUsdc: reservation.feeUsdc,
              expectedSender: creatorWallet,
            });
          } catch (e) {
            return NextResponse.json(
              { error: `mint fee not verified: ${(e as Error).message}`, feeUsdc: reservation.feeUsdc },
              { status: 402 },
            );
          }
          try {
            await convex.mutation(api.mintFee.markMintPaid, { authSecret: SECRET, sessionId, txSignature });
          } catch (e) {
            // markMintPaid is single-use per wallet: this wallet's ONE real $50
            // payment can fund AT MOST one reservation's paid transition (H03). A
            // replayed signature is CORRECTLY blocked there — but the throw was
            // surfacing as a generic 500 (BUG-027). Return a clean 409 so the
            // client shows "already used", not "Mint failed".
            const msg = (e as Error).message ?? "";
            if (/already used/i.test(msg)) {
              return NextResponse.json(
                { error: "This $50 mint-fee payment was already used for another agent. Each payment mints one agent — pay again to mint another.", feeUsdc: reservation.feeUsdc },
                { status: 409 },
              );
            }
            throw e; // unexpected errors keep the existing 500 handling
          }
        }
      } else {
        // FREE path. Require the placeholder format: an attacker must NOT be able
        // to pass a REAL on-chain signature here and have completeMint consume it
        // into the shared processedSignatures ledger, which would strand a legit
        // deposit (campaign top-up / share buy / paid mint) that reuses that sig.
        if (!/^free_promo_/.test(txSignature)) {
          return NextResponse.json({ error: "Invalid mint signature" }, { status: 400 });
        }
      }

      // Atomically claim the freebie right before creating the agent. This is the
      // authoritative gate (reserve was only a quote): it counts the account's
      // COMMITTED prior mints and, for a free mint, grants at most one — so a
      // concurrent second tab, or a stockpile of "banked" free reservations,
      // comes back ok:false and must pay $50. Paid reservations always pass.
      const claim = await convex.mutation(api.mintFee.claimMint, {
        authSecret: SECRET,
        sessionId,
        creatorWallet,
        creatorWallets,
        creatorDid,
        standardFeeUsdc: MINT_FEE_USDC,
        forceFree: isMintFeeDisabled(),
        agentLimit,
      });
      if (!claim.ok) {
        const c = claim as { limitReached?: boolean; agentCount?: number; agentLimit?: number; feeUsdc: number };
        if (c.limitReached) {
          return NextResponse.json(
            {
              error: `Agent limit reached — your account already has ${c.agentCount ?? c.agentLimit ?? 1} of ${c.agentLimit ?? 1} agents. Delete an agent to free a slot.`,
              limitReached: true,
              agentCount: c.agentCount,
              agentLimit: c.agentLimit ?? 1,
            },
            { status: 403 },
          );
        }
        return NextResponse.json(
          { error: "This agent couldn't be created. Please try again.", feeUsdc: claim.feeUsdc },
          { status: 402 },
        );
      }

      // A PAID resume must complete against the signature actually VERIFIED for
      // this reservation (reservation.txSignature), NOT the current request's raw,
      // client-supplied txSignature — otherwise a "paid" session could be resumed
      // with a throwaway string that completeMint would consume, minting for free
      // (H03). The first-paid pass (row still "reserved") and the free_promo_ path
      // are unchanged: they keep using the request signature.
      mintProofSignature = mintProofSignatureFor(reservation, txSignature);
    }

    // Resume idempotency at the agent level: if this builder session already
    // minted (draft marked minted after a prior attempt died mid-flight, or a
    // second tab), reuse the SAME on-chain mint address instead of minting a
    // second NFT + inserting a duplicate influencer. saveInfluencer upserts by
    // mintAddress, so re-running it with the same address just completes the row.
    const priorDraft = await convex.query(api.nftAgents.getBySession, { sessionId });
    const reuseMintAddress =
      priorDraft?.mintStatus === "minted" && priorDraft.mintAddress ? priorDraft.mintAddress : undefined;

    // Generate a dedicated Solana keypair for this agent's treasury wallet
    const agentKeypair = Keypair.generate();
    const agentWallet = agentKeypair.publicKey.toBase58();
    const agentWalletSecret = Buffer.from(agentKeypair.secretKey).toString("base64");
    const persona = agentBlueprint?.persona ?? {};
    const trader = agentBlueprint?.trader ?? {};
    const agentType = normalizeAgentType(agentBlueprint?.agentType, persona.niche);
    const isTrader = agentType === "trader";

    // Sensible defaults — pull from trader block when relevant, persona block otherwise
    const rawName = isTrader ? trader.name : persona.name;
    const name = (rawName && rawName.trim()) ? rawName.trim() : "New AI Agent";
    const handle = (persona.handle && persona.handle.trim().length >= 3)
      ? persona.handle.trim().replace(/^@/, "")
      : deriveHandle(rawName, sessionId);
    const niche = isTrader
      ? (trader.strategy?.assetUniverse?.[0] ?? "trading")
      : (persona.niche?.trim() || "lifestyle");

    // One deterministic description contract powers mint, builder, and marketplace.
    const personaForDescription = isTrader
      ? {
          name,
          niche: trader.strategy?.assetUniverse?.join(", ") ?? "Solana spot",
          audience: "crypto investors",
          voiceArchetype: trader.strategy?.autonomy ?? "expert",
          contentPillars: trader.strategy?.dataSources?.map((d: { type: string }) => d.type) ?? [],
          backstory: trader.summary ?? trader.aesthetic,
          catchphrase: undefined,
        }
      : persona;
    const description = formatAgentDescription({
      name,
      niche: personaForDescription.niche ?? niche,
      archetype: personaForDescription.voiceArchetype,
      agentType,
      audience: personaForDescription.audience,
      contentPillars: personaForDescription.contentPillars,
    });

    // ── REAL on-chain NFT (Metaplex Token Metadata, owned by the creator's
    // wallet, rent paid by the platform mint authority). Chain failure is
    // non-fatal: fall back to the legacy synthetic id so onboarding never
    // dies on an RPC hiccup — but record which one we got. On a resume
    // (reuseMintAddress set) skip minting entirely so we never create a second
    // NFT for the same session.
    let mintAddress = reuseMintAddress ?? `vello_${sessionId.slice(0, 8)}_${Date.now()}`;
    let mintTxSignature: string | undefined;
    let explorerUrl: string | undefined;
    if (!reuseMintAddress) {
      try {
        const { mintAgentNft } = await import("@/lib/server/nftMint");
        const minted = await mintAgentNft({
          name,
          description,
          imageUrl: avatarUrls[0],
          ownerWallet: creatorWallet,
        });
        mintAddress = minted.mintAddress;
        mintTxSignature = minted.txSignature;
        explorerUrl = minted.explorerUrl;
        console.log(`[nft/mint] on-chain mint ${mintAddress} tx=${minted.txSignature}`);
      } catch (e) {
        console.warn(`[nft/mint] on-chain mint failed (falling back to synthetic id): ${e instanceof Error ? e.message : e}`);
      }
    }

    // If the request didn't include http(s) avatarUrls, recover from the existing draft.
    // This way the influencer record NEVER has an empty avatarUrl — no broken images on /agents.
    let finalAvatarUrls = avatarUrls;
    if (finalAvatarUrls.length === 0) {
      try {
        const draft = await convex.query(api.nftAgents.getDraftByMint, { mintAddress: "" });
        // No mint yet — fall back to the session draft already loaded above (no
        // nftDrafts write happens between that read and here).
        const fromDraft = (draft?.avatarUrls ?? priorDraft?.avatarUrls ?? [])
          .filter((u: string) => /^https?:\/\//i.test(u));
        if (fromDraft.length > 0) finalAvatarUrls = fromDraft;
      } catch { /* non-blocking */ }
    }

    await convex.mutation(api.nftAgents.completeMint, {
      authSecret: SECRET,
      sessionId,
      mintTxSignature: mintProofSignature,
      mintAddress,
      creatorWallet,
      name,
      handle,
      niche,
      avatarUrls: finalAvatarUrls,
    });

    await convex.mutation(api.nftAgents.saveInfluencer, {
      authSecret: SECRET,
      sessionId,
      mintAddress,
      creatorWallet,
      name,
      handle,
      // NEVER persist "" — when the avatar upload failed (no http URL survived
      // the http(s)-only filter above), fall back to a deterministic identicon so
      // every surface (workspace header, /agents grid, NFT metadata) shows a real
      // image instead of a broken/empty one. Stable per mint.
      avatarUrl: finalAvatarUrls[0] || `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(mintAddress)}`,
      // The individual still frames (no GIF) — the agent's video reference set.
      avatarStills: finalAvatarUrls.filter((u) => /^https?:\/\//i.test(u) && !/\.gif(\?|#|$)/i.test(u)),
      niche,
      language: persona.language ?? "English",
      archetype: persona.voiceArchetype ?? (isTrader ? "expert" : "friend"),
      description,
      agentType,
      agentWallet,
      agentWalletSecret: encryptWalletSecret(agentWalletSecret),
      clipConfig: agentBlueprint?.clipConfig
        ? normalizeClipConfig(agentBlueprint.clipConfig)
        : undefined,
    });

    // Agent fully created — mark the fee reservation minted so it counts as a
    // prior mint for this account's NEXT agent (idempotent; internal callers
    // have no reservation to close).
    if (!auth.internal) {
      try {
        await convex.mutation(api.mintFee.markMintCharged, { authSecret: SECRET, sessionId, mintAddress });
      } catch (e) {
        console.warn(`[nft/mint] markMintCharged failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      }
    }

    // Init on-chain vault for this agent (best-effort, non-fatal — devnet only)
    try {
      if (!process.env.PLATFORM_VAULT_AUTHORITY_SECRET) {
        console.warn("[nft/mint] PLATFORM_VAULT_AUTHORITY_SECRET not set — skipping vault init");
      } else {
        const vaultSigner = loadKeypair(process.env.PLATFORM_VAULT_AUTHORITY_SECRET);
        const program = buildAgentVaultProgram(vaultSigner);
        const agentId = agentIdFromSessionId(sessionId);
        const usdcMint = new PublicKey(getUsdcMint());
        if (!TREASURY) throw new Error("NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET not set");
        await initVaultTx({
          program,
          agentId,
          usdcMint,
          owner: vaultSigner.publicKey,
          authority: vaultSigner.publicKey,
          treasury: new PublicKey(TREASURY),
          maxFeePerRunUsdc: 5,
        });
        const [vaultPda] = getVaultPda(vaultSigner.publicKey, agentId);
        const vaultAgentId = agentId.toString("hex");
        await convex.mutation(api.agentAccount.setVault, {
          authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
          mintAddress,
          vaultAddress: vaultPda.toBase58(),
          vaultAgentId,
          vaultEnabled: true,
        });
        console.log(`[nft/mint] vault init ${vaultPda.toBase58()} for ${mintAddress}`);
      }
    } catch (vaultErr) {
      console.warn(`[nft/mint] vault init failed (non-fatal): ${vaultErr instanceof Error ? vaultErr.message : vaultErr}`);
    }

    // (Trader strategy-spec locking removed with the trader vertical.)
    const strategyWarning: string | undefined = undefined;

    return NextResponse.json({ ok: true, mintAddress, name, handle, description, agentType, agentWallet, ...(mintTxSignature ? { mintTxSignature, explorerUrl, onchain: true } : { onchain: false }), ...(strategyWarning ? { warning: strategyWarning } : {}) });
  } catch (err) {
    console.error("[nft/mint]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mint failed" },
      { status: 500 },
    );
  }
}

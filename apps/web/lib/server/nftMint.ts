import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getNetwork, getRpcUrl } from "@/lib/solana/network";
import { rpcTry } from "@/lib/solana/rpc";

/**
 * Real on-chain agent NFT (Metaplex Token Metadata standard) on the active
 * cluster. Replaces the old synthetic `vello_<session>_<ts>` mint id with an
 * actual asset every wallet/explorer understands.
 *
 * - Owner: the creator's wallet (tokenOwner) — the builder holds the NFT.
 * - Payer/authority: a platform keypair (NFT_MINT_AUTHORITY_SECRET, base64
 *   64-byte secret) holding a little SOL for rent + fees per mint. **We
 *   pre-flight this wallet on every mint and AUTO-AIRDROP SOL on devnet/testnet
 *   when it runs low**, so a drained authority can never silently fail the mint
 *   with a cryptic System `0x1` "insufficient lamports" error.
 * - Metadata JSON is hosted on Convex storage (same public-URL store the clip
 *   pipeline uses) — no external uploader/funding needed.
 */
export interface MintedNft {
  /** The NFT's mint address (base58) — used as the agent's identity. */
  mintAddress: string;
  txSignature: string;
  metadataUrl: string;
  explorerUrl: string;
}

export async function mintAgentNft(args: {
  name: string;
  description: string;
  imageUrl?: string;
  ownerWallet: string;
}): Promise<MintedNft> {
  const secretB64 = (process.env.NFT_MINT_AUTHORITY_SECRET ?? "").trim();
  if (!secretB64) throw new Error("NFT_MINT_AUTHORITY_SECRET not set");
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

  // Lazy imports: umi + mpl-token-metadata are heavy and this path is rare.
  const { createUmi } = await import("@metaplex-foundation/umi-bundle-defaults");
  const { keypairIdentity, generateSigner, percentAmount, publicKey } = await import("@metaplex-foundation/umi");
  const { mplTokenMetadata, createNft } = await import("@metaplex-foundation/mpl-token-metadata");
  const { base58 } = await import("@metaplex-foundation/umi/serializers");

  // 1) Host the metadata JSON on Convex storage (public URL).
  const convex = new ConvexHttpClient(convexUrl);
  const metadata = {
    name: args.name.slice(0, 32),
    symbol: "VELLO",
    description: args.description,
    image: args.imageUrl ?? "",
    attributes: [{ trait_type: "platform", value: "vello" }],
    properties: {
      category: "image",
      files: args.imageUrl ? [{ uri: args.imageUrl, type: "image/png" }] : [],
    },
  };
  const uploadUrl = await convex.mutation(api.clipStorage.generateUploadUrl, {});
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  if (!up.ok) throw new Error(`metadata upload failed: HTTP ${up.status}`);
  const { storageId } = (await up.json()) as { storageId: string };
  const metadataUrl = (await convex.mutation(api.clipStorage.resolveStorageUrl, {
    storageId: storageId as unknown as never,
  })) as string;

  // 2) Mint the NFT to the creator's wallet.
  const umi = createUmi(getRpcUrl()).use(mplTokenMetadata());
  const secret = Uint8Array.from(Buffer.from(secretB64, "base64"));
  const authority = umi.eddsa.createKeypairFromSecretKey(secret);
  umi.use(keypairIdentity(authority));

  // PRE-FLIGHT: the authority wallet pays rent + fees (~0.006 SOL/mint). If it's
  // too low the mint dies with System "insufficient lamports" (custom 0x1). Top
  // it up automatically on devnet/testnet so a drained wallet can't break mints.
  await ensureAuthorityFunded(authority);

  const mint = generateSigner(umi);
  const result = await createNft(umi, {
    mint,
    name: metadata.name,
    symbol: "VELLO",
    uri: metadataUrl,
    sellerFeeBasisPoints: percentAmount(0),
    tokenOwner: publicKey(args.ownerWallet),
  }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });

  const txSignature = base58.deserialize(result.signature)[0];
  const cluster = getNetwork() === "mainnet-beta" ? "" : `?cluster=${getNetwork()}`;
  return {
    mintAddress: mint.publicKey.toString(),
    txSignature,
    metadataUrl,
    explorerUrl: `https://explorer.solana.com/address/${mint.publicKey.toString()}${cluster}`,
  };
}

/**
 * Keep the NFT-mint authority wallet funded so rent + fees never fail.
 *
 * A single mint costs roughly 0.006–0.011 SOL (mint account ~0.00103, ATA
 * ~0.00204, metadata + master edition ~0.0015, plus fee). We target a floor of
 * 0.05 SOL: comfortable for several mints and safely under the ~0.5 SOL/req
 * devnet airdrop cap.
 *
 * - devnet/testnet: auto-requestAirdrop (public RPC, no key needed) until the
 *   floor is met, with a couple of retries for the devnet faucet's rate limits.
 * - mainnet: never auto-fund — throw a clear "fund the authority" error instead
 *   of letting the mint die deep inside mpl-token-metadata.
 */
async function ensureAuthorityFunded(authority: {
  publicKey: { toString(): string };
}): Promise<void> {
  const { LAMPORTS_PER_SOL, PublicKey } = await import("@solana/web3.js");
  const { getRpcCandidates } = await import("@/lib/solana/network");

  const network = getNetwork();
  const candidates = getRpcCandidates();
  const pubkey = new PublicKey(authority.publicKey.toString());

  const SOL_PER_AIRDROP = 0.5;
  const MIN_SOL = 0.05;
  const RENT_BUDGET_SOL = 0.012; // safety margin above the ~0.011 SOL/mint cost

  const getBalance = () =>
    rpcTry(candidates, (conn) => conn.getBalance(pubkey)).then(
      (lamports) => lamports / LAMPORTS_PER_SOL,
    );

  let balance = await getBalance();

  // Already funded past the rent budget → no action.
  if (balance >= RENT_BUDGET_SOL) return;

  if (network === "mainnet-beta") {
    throw new Error(
      `NFT mint authority wallet is low on SOL (${balance.toFixed(4)} SOL, needs ~${RENT_BUDGET_SOL}). Fund ${pubkey.toBase58()} to unblock on-chain agent mints.`,
    );
  }

  // devnet/testnet — top up to the floor. The public devnet faucet rate-limits
  // (~0.5 SOL/req, a few per hour), so try multiple small airdrops.
  for (let attempt = 0; attempt < 5 && balance < MIN_SOL; attempt++) {
    try {
      await rpcTry(candidates, (conn) =>
        conn.requestAirdrop(pubkey, Math.round(SOL_PER_AIRDROP * LAMPORTS_PER_SOL)),
      );
    } catch {
      // rate-limited / transient — retry below
    }
    balance = await getBalance();
  }

  if (balance < RENT_BUDGET_SOL) {
    throw new Error(
      `Could not auto-fund NFT mint authority (balance ${balance.toFixed(4)} SOL). Devnet faucet may be rate-limited — try again in a few minutes or fund ${pubkey.toBase58()}.`,
    );
  }
}

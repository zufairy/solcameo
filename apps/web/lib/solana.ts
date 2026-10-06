import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  walletAdapterIdentity,
  type WalletAdapter,
} from "@metaplex-foundation/umi-signer-wallet-adapters";
import {
  createNft,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import {
  generateSigner,
  percentAmount,
  type Umi,
} from "@metaplex-foundation/umi";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { WizardState } from "@/store/wizard";
import { getNetwork, getRpcUrl } from "@/lib/solana/network";

// Single source of truth via lib/solana/network — devnet returns the PUBLIC
// endpoint (the configured Helius devnet key is suspended → 403).
const RPC = getRpcUrl(getNetwork());
const IRYS = getNetwork() === "mainnet-beta" ? "https://node1.irys.xyz" : "https://devnet.irys.xyz";

export function buildUmi(wallet: WalletContextState): Umi {
  // WalletContextState is structurally compatible with WalletAdapter
  return createUmi(RPC)
    .use(walletAdapterIdentity(wallet as unknown as WalletAdapter))
    .use(mplTokenMetadata())
    .use(
      irysUploader({
        address: IRYS,
        timeout: 60000,
        providerUrl: RPC,
      })
    );
}

export interface NftMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string;
  attributes: { trait_type: string; value: string }[];
  properties: {
    category: string;
    files: { uri: string; type: string }[];
  };
}

export function buildMetadata(state: WizardState): NftMetadata {
  const imageUrl = `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(state.identity.name)}`;

  return {
    name: state.identity.name,
    symbol: "VELLO",
    description: `AI Influencer on the Vello Protocol. ${state.personality.niche} creator. Handle: @${state.identity.handle}`,
    image: imageUrl,
    attributes: [
      { trait_type: "handle", value: `@${state.identity.handle}` },
      { trait_type: "niche", value: state.personality.niche },
      { trait_type: "language", value: state.voice.language },
      { trait_type: "archetype", value: state.identity.archetype },
      { trait_type: "warmth", value: String(state.personality.warmth) },
      { trait_type: "humor", value: String(state.personality.humor) },
      { trait_type: "authority", value: String(state.personality.authority) },
      { trait_type: "boldness", value: String(state.personality.boldness) },
      {
        trait_type: "categories",
        value: state.brand.categories.join(", "),
      },
    ],
    properties: {
      category: "image",
      files: [{ uri: imageUrl, type: "image/svg+xml" }],
    },
  };
}

export interface MintResult {
  mintAddress: string;
  txSignature: string;
  explorerUrl: string;
}

export async function mintInfluencerNft(
  umi: Umi,
  metadata: NftMetadata
): Promise<MintResult> {
  // Upload metadata JSON to Irys (Arweave devnet)
  const metadataUri = await umi.uploader.uploadJson(metadata);

  // Generate a new keypair for this NFT's mint account
  const mint = generateSigner(umi);

  // Mint the NFT via Metaplex Token Metadata program
  const tx = await createNft(umi, {
    mint,
    name: metadata.name,
    symbol: metadata.symbol,
    uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(5), // 5% royalty
    isMutable: true,
  }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });

  const mintAddress = mint.publicKey.toString();
  const txSignature = Buffer.from(tx.signature).toString("base64");

  return {
    mintAddress,
    txSignature,
    explorerUrl: `https://explorer.solana.com/address/${mintAddress}?cluster=devnet`,
  };
}

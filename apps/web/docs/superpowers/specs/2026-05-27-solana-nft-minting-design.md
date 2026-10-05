# Vello 2.0 — Solana NFT Minting & Real Market Design

## Goal

Replace all mock stubs with real Solana devnet integration: live wallet connection, NFT minting from the Studio wizard, and a Market grid that fetches real on-chain AI Influencer NFTs via Helius DAS API.

## Architecture

```
User fills wizard → clicks Launch
  → wallet connected? (prompt if not)
  → build metadata JSON from wizard state
  → upload metadata to Irys (Arweave, devnet, free for small files)
  → createNft() via Metaplex UMI on devnet
  → on success: store mint address, redirect to /market

/market page loads
  → call Helius DAS getAssetsByCreator(VELLO_CREATOR_PUBKEY)
  → parse each asset's metadata JSON
  → render real AIInfluencer cards
```

## Key Decisions

- **Network**: Solana devnet (Helius devnet RPC)
- **NFT standard**: Metaplex Token Metadata (traditional NFTs, each AI Influencer = 1 NFT)
- **Metadata storage**: Irys (Arweave) devnet uploader via UMI — free for files <100KB using devnet SOL
- **Market indexing**: Helius DAS API `getAssetsByCreator` — creator = user's wallet pubkey; all mints by any Vello user are discoverable if they share the same app (devnet)
- **Creator authority**: Each user's wallet is the creator. Helius query fetches by a shared Vello "verified creator" concept — for devnet, we query by each connected wallet's address OR store all mint addresses in a shared Zustand store persisted to localStorage (bridging gap before indexing)
- **Share purchase**: UI stays as-is (dialog remains, "requires smart contracts" message) — smart contract plan is separate

## NFT Metadata Schema

```json
{
  "name": "Aisha Rahman",
  "symbol": "VELLO",
  "description": "...",
  "image": "https://api.dicebear.com/9.x/personas/svg?seed=aisha",
  "attributes": [
    { "trait_type": "niche", "value": "lifestyle" },
    { "trait_type": "language", "value": "ms" },
    { "trait_type": "halal", "value": "true" },
    { "trait_type": "warmth", "value": "85" },
    { "trait_type": "humor", "value": "60" },
    { "trait_type": "authority", "value": "40" },
    { "trait_type": "boldness", "value": "55" },
    { "trait_type": "handle", "value": "@aisha.rahman.ai" }
  ],
  "properties": {
    "category": "image",
    "files": [{ "uri": "...", "type": "image/svg+xml" }]
  }
}
```

## Market Indexing Strategy

Since this is devnet and we don't have a shared backend:
1. After minting, store the mint address in Zustand + localStorage
2. On /market load: fetch metadata for all stored mint addresses via Helius `getAsset`
3. Also call Helius `getAssetsByCreator` for the connected wallet to pick up mints from other sessions/devices
4. Parse metadata back into AIInfluencer shape for rendering

This means the Market shows real on-chain NFTs for anyone who has minted from this browser. No central server required.

## Environment Variables Required

```
NEXT_PUBLIC_HELIUS_API_KEY=    # free at helius.dev, devnet plan
NEXT_PUBLIC_SOLANA_NETWORK=devnet
```

## Components Changed

| File | Change |
|------|--------|
| `app/layout.tsx` | Add WalletProvider + ConnectionProvider wrapping |
| `components/layout/top-bar.tsx` | Replace static button with real WalletMultiButton (custom styled) |
| `components/studio/step-launch.tsx` | Real minting flow with loading/success/error states |
| `app/market/page.tsx` | Fetch real NFTs, fall back to mock if none found |
| `store/wallet.ts` (new) | Zustand store for minted NFT addresses + parsed influencer data |
| `lib/solana.ts` (new) | UMI setup, createNft helper, metadata builder |
| `lib/helius.ts` (new) | Helius DAS API helpers: getAsset, getAssetsByCreator, parseToInfluencer |

## New Packages

```
@solana/wallet-adapter-react
@solana/wallet-adapter-wallets
@solana/wallet-adapter-base
@solana/web3.js
@metaplex-foundation/umi
@metaplex-foundation/umi-bundle-defaults
@metaplex-foundation/mpl-token-metadata
@metaplex-foundation/umi-uploader-irys
```

## Success Criteria

- [ ] Connect Phantom wallet on devnet — button shows address when connected
- [ ] Complete wizard → click Launch → NFT mints on Solana devnet (visible in Phantom + explorer.solana.com)
- [ ] After mint → redirected to /market → see the new AI Influencer card
- [ ] Refresh /market → card is still there (fetched from chain, not just memory)
- [ ] TypeScript clean, build passes

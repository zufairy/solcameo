# Solana NFT Minting — Real Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all mock stubs with real Solana devnet — wallet connection, NFT minting from the Studio wizard, and a Market grid that reads live on-chain AI Influencer NFTs.

**Architecture:** `@solana/wallet-adapter-react` wraps the app for wallet access. On Launch, Metaplex UMI builds and uploads metadata to Irys (Arweave devnet), then calls `createNft()`. Minted addresses are persisted in Zustand+localStorage. The Market page reads those addresses via Helius DAS API and renders real influencer cards with no mock data.

**Tech Stack:** `@solana/wallet-adapter-react`, `@solana/wallet-adapter-wallets`, `@metaplex-foundation/umi`, `@metaplex-foundation/umi-bundle-defaults`, `@metaplex-foundation/mpl-token-metadata`, `@metaplex-foundation/umi-uploader-irys`, `@metaplex-foundation/umi-signer-wallet-adapters`, `@solana/wallet-adapter-react-ui`, Helius DAS API

---

## Prerequisites (human steps before running tasks)

1. **Get a free Helius API key**: sign up at https://helius.dev → Dashboard → create devnet API key
2. **Create `.env.local`** at `/Users/along/Documents/vello/.env.local`:
   ```
   NEXT_PUBLIC_HELIUS_API_KEY=your_key_here
   NEXT_PUBLIC_SOLANA_NETWORK=devnet
   ```
3. **Get devnet SOL**: open Phantom → switch to devnet → Settings → Airdrop SOL (or use https://faucet.solana.com)
4. Vello mints will appear at https://explorer.solana.com/?cluster=devnet

---

## File Structure

```
app/
  layout.tsx                            MODIFY — wrap with SolanaWalletProvider
providers/
  wallet-provider.tsx                   CREATE — ConnectionProvider + WalletProvider + WalletModalProvider
components/
  layout/
    top-bar.tsx                         MODIFY — replace static button with real WalletButton
    wallet-button.tsx                   CREATE — custom styled wallet connect/disconnect button
lib/
  solana.ts                             CREATE — UMI factory, metadata builder, mintInfluencerNft()
  helius.ts                             CREATE — fetchAsset(), fetchAssetsByCreator(), parseAssetToInfluencer()
store/
  nft.ts                                CREATE — Zustand persisted store: minted addresses + parsed influencers
components/
  studio/
    step-launch.tsx                     MODIFY — real mint flow with idle/uploading/minting/success/error states
app/
  market/
    page.tsx                            MODIFY — client component, reads from nft store + Helius DAS, no mock data
```

---

## Task 1: Install Packages + Configure Next.js for Solana

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `next.config.ts`

- [ ] **Step 1: Install all Solana + Metaplex packages**

```bash
cd /Users/along/Documents/vello && npm install \
  @solana/wallet-adapter-base \
  @solana/wallet-adapter-react \
  @solana/wallet-adapter-react-ui \
  @solana/wallet-adapter-wallets \
  @solana/web3.js \
  @metaplex-foundation/umi \
  @metaplex-foundation/umi-bundle-defaults \
  @metaplex-foundation/mpl-token-metadata \
  @metaplex-foundation/umi-uploader-irys \
  @metaplex-foundation/umi-signer-wallet-adapters
```

Expected: packages installed, no peer dep errors (warnings about react version are OK).

- [ ] **Step 2: Add webpack fallbacks to `next.config.ts`**

`@solana/web3.js` uses Node.js built-ins that need browser shims. Read current `next.config.ts`, then replace with:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
```

- [ ] **Step 3: Verify TypeScript still compiles**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/along/Documents/vello && git add -A && git commit -m "chore: install Solana + Metaplex packages, add webpack fallbacks"
```

---

## Task 2: Wallet Provider

**Files:**
- Create: `providers/wallet-provider.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Create `providers/wallet-provider.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

const RPC_URL = process.env.NEXT_PUBLIC_HELIUS_API_KEY
  ? `https://devnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
  : "https://api.devnet.solana.com";

export function SolanaWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

- [ ] **Step 2: Read `app/layout.tsx` then wrap with SolanaWalletProvider**

Read the current `app/layout.tsx`, then update the body content to wrap with `SolanaWalletProvider`:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { SolanaWalletProvider } from "@/providers/wallet-provider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vello — AI Influencer Protocol",
  description: "Launch, fund, and earn from autonomous AI Influencers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SolanaWalletProvider>
          <SidebarProvider>
            <AppSidebar />
            <div className="flex flex-1 flex-col min-h-screen">
              <TopBar />
              <main className="flex-1 overflow-auto">{children}</main>
            </div>
          </SidebarProvider>
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/along/Documents/vello && git add -A && git commit -m "feat: add Solana wallet provider to app layout"
```

---

## Task 3: Custom Wallet Button in TopBar

**Files:**
- Create: `components/layout/wallet-button.tsx`
- Modify: `components/layout/top-bar.tsx`

- [ ] **Step 1: Create `components/layout/wallet-button.tsx`**

```tsx
"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { Wallet, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WalletButton() {
  const { connected, publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  if (connecting) {
    return (
      <Button size="sm" disabled className="gap-2">
        <Wallet className="size-4 animate-pulse" />
        Connecting...
      </Button>
    );
  }

  if (connected && publicKey) {
    const address = publicKey.toBase58();
    const short = `${address.slice(0, 4)}...${address.slice(-4)}`;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild={false}>
          <Button size="sm" variant="secondary" className="gap-2 font-mono">
            <Wallet className="size-4" />
            {short}
            <ChevronDown className="size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => navigator.clipboard.writeText(address)}
          >
            Copy address
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              window.open(
                `https://explorer.solana.com/address/${address}?cluster=devnet`,
                "_blank"
              )
            }
          >
            View on Explorer
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => disconnect()}
          >
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button size="sm" onClick={() => setVisible(true)} className="gap-2">
      <Wallet className="size-4" />
      Connect Wallet
    </Button>
  );
}
```

Note: `DropdownMenuTrigger` in this project uses `render` prop, not `asChild`. Check `components/ui/dropdown-menu.tsx` to confirm the API and adjust if needed.

- [ ] **Step 2: Read `components/ui/dropdown-menu.tsx` to verify trigger API**

Check whether `DropdownMenuTrigger` uses `render` prop or `asChild`. Adjust `wallet-button.tsx` accordingly before continuing.

- [ ] **Step 3: Update `components/layout/top-bar.tsx`**

Replace the static Connect Wallet button with the real `WalletButton`:

```tsx
"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { WalletButton } from "./wallet-button";

export function TopBar() {
  return (
    <header className="flex h-14 items-center gap-4 border-b border-border px-4">
      <SidebarTrigger />
      <div className="flex-1" />
      <Badge variant="secondary" className="text-xs font-mono">
        Devnet
      </Badge>
      <WalletButton />
    </header>
  );
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/along/Documents/vello && git add -A && git commit -m "feat: real wallet connect button with address display and disconnect"
```

---

## Task 4: Solana Utilities — UMI + Mint Function

**Files:**
- Create: `lib/solana.ts`

- [ ] **Step 1: Create `lib/solana.ts`**

```typescript
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
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

const DEVNET_RPC = process.env.NEXT_PUBLIC_HELIUS_API_KEY
  ? `https://devnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
  : "https://api.devnet.solana.com";

export function buildUmi(wallet: WalletContextState): Umi {
  return createUmi(DEVNET_RPC)
    .use(walletAdapterIdentity(wallet as Parameters<typeof walletAdapterIdentity>[0]))
    .use(mplTokenMetadata())
    .use(
      irysUploader({
        address: "https://devnet.irys.xyz",
        timeout: 60000,
        providerUrl: DEVNET_RPC,
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
      { trait_type: "halal", value: String(state.brand.isHalal) },
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
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit
```

If there are type errors with `walletAdapterIdentity`, the wallet context type may need casting. Fix by adding `as any` only on that one line if necessary, and add a comment explaining the type incompatibility between `@solana/wallet-adapter-react` and `@metaplex-foundation/umi-signer-wallet-adapters`.

- [ ] **Step 3: Commit**

```bash
cd /Users/along/Documents/vello && git add lib/solana.ts && git commit -m "feat: Solana UMI utilities — metadata builder and NFT mint function"
```

---

## Task 5: Helius DAS Utilities

**Files:**
- Create: `lib/helius.ts`

- [ ] **Step 1: Create `lib/helius.ts`**

```typescript
import type { AIInfluencer, Niche, Language } from "@/lib/types";

const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY ?? "";
const HELIUS_RPC = `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

interface HeliusAttribute {
  trait_type: string;
  value: string;
}

interface HeliusAsset {
  id: string;
  content: {
    metadata: {
      name: string;
      description?: string;
      attributes?: HeliusAttribute[];
    };
    links?: {
      image?: string;
    };
    json_uri?: string;
  };
  authorities: { address: string; scopes: string[] }[];
  creators: { address: string; verified: boolean; share: number }[];
}

interface HeliusDasResponse {
  result: {
    items: HeliusAsset[];
    total: number;
  };
}

interface HeliusSingleAssetResponse {
  result: HeliusAsset;
}

async function dasRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(HELIUS_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "vello",
      method,
      params,
    }),
  });
  if (!res.ok) throw new Error(`Helius DAS error: ${res.status}`);
  return res.json() as Promise<T>;
}

function getAttribute(attrs: HeliusAttribute[] | undefined, key: string): string {
  return attrs?.find((a) => a.trait_type === key)?.value ?? "";
}

export function parseAssetToInfluencer(asset: HeliusAsset): AIInfluencer {
  const attrs = asset.content.metadata.attributes;
  const name = asset.content.metadata.name || "Unknown";
  const handle = getAttribute(attrs, "handle") || `@${name.toLowerCase().replace(/\s/g, ".")}`;

  const niche = (getAttribute(attrs, "niche") || "lifestyle") as Niche;
  const language = (getAttribute(attrs, "language") || "en") as Language;

  return {
    id: asset.id,
    name,
    handle,
    avatarUrl:
      asset.content.links?.image ||
      `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(name)}`,
    niche,
    language,
    isHalal: getAttribute(attrs, "halal") === "true",
    tvl: 0,
    monthlyEarnings: 0,
    sharePrice: 10,
    totalShares: 1000,
    availableShares: 1000,
    description: asset.content.metadata.description || "",
    personality: {
      warmth: Number(getAttribute(attrs, "warmth")) || 50,
      humor: Number(getAttribute(attrs, "humor")) || 50,
      authority: Number(getAttribute(attrs, "authority")) || 50,
      boldness: Number(getAttribute(attrs, "boldness")) || 50,
    },
    contentHistory: [],
    earningsHistory: [],
    shareholders: [],
    createdAt: new Date().toISOString(),
  };
}

export async function fetchAsset(mintAddress: string): Promise<AIInfluencer | null> {
  try {
    const data = await dasRequest<HeliusSingleAssetResponse>("getAsset", {
      id: mintAddress,
    });
    return parseAssetToInfluencer(data.result);
  } catch {
    return null;
  }
}

export async function fetchAssetsByCreator(
  creatorAddress: string
): Promise<AIInfluencer[]> {
  try {
    const data = await dasRequest<HeliusDasResponse>("getAssetsByCreator", {
      creatorAddress,
      onlyVerified: false,
      page: 1,
      limit: 100,
    });
    return data.result.items
      .filter(
        (a) =>
          a.content.metadata.attributes?.some(
            (attr) => attr.trait_type === "niche"
          ) ?? false
      )
      .map(parseAssetToInfluencer);
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/along/Documents/vello && git add lib/helius.ts && git commit -m "feat: Helius DAS API helpers — fetch and parse on-chain AI Influencer NFTs"
```

---

## Task 6: NFT Store (Zustand + localStorage)

**Files:**
- Create: `store/nft.ts`

- [ ] **Step 1: Install zustand persist middleware (already included in zustand)**

Confirm zustand version supports `persist`:

```bash
cd /Users/along/Documents/vello && node -e "const z = require('zustand/middleware'); console.log('persist' in z ? 'ok' : 'missing')"
```

Expected: `ok`

- [ ] **Step 2: Create `store/nft.ts`**

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AIInfluencer } from "@/lib/types";

interface NftStore {
  mintAddresses: string[];
  influencers: AIInfluencer[];
  addInfluencer: (mintAddress: string, influencer: AIInfluencer) => void;
  setInfluencers: (influencers: AIInfluencer[]) => void;
  reset: () => void;
}

export const useNftStore = create<NftStore>()(
  persist(
    (set) => ({
      mintAddresses: [],
      influencers: [],

      addInfluencer: (mintAddress, influencer) =>
        set((state) => ({
          mintAddresses: state.mintAddresses.includes(mintAddress)
            ? state.mintAddresses
            : [...state.mintAddresses, mintAddress],
          influencers: state.influencers.some((i) => i.id === mintAddress)
            ? state.influencers
            : [...state.influencers, influencer],
        })),

      setInfluencers: (influencers) => set({ influencers }),

      reset: () => set({ mintAddresses: [], influencers: [] }),
    }),
    { name: "vello-nfts" }
  )
);
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /Users/along/Documents/vello && git add store/nft.ts && git commit -m "feat: Zustand NFT store persisted to localStorage"
```

---

## Task 7: Launch Step — Real Minting UI

**Files:**
- Modify: `components/studio/step-launch.tsx`

- [ ] **Step 1: Read `components/studio/step-launch.tsx`** to understand current structure before replacing.

- [ ] **Step 2: Replace `components/studio/step-launch.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWizardStore } from "@/store/wizard";
import { useNftStore } from "@/store/nft";
import { buildUmi, buildMetadata, mintInfluencerNft } from "@/lib/solana";
import { parseAssetToInfluencer } from "@/lib/helius";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  Rocket,
  Loader2,
  AlertCircle,
  ExternalLink,
  Wallet,
} from "lucide-react";

type MintStatus =
  | "idle"
  | "connecting"
  | "uploading"
  | "minting"
  | "success"
  | "error";

interface MintSuccess {
  mintAddress: string;
  explorerUrl: string;
}

export function StepLaunch() {
  const { identity, voice, personality, brand, behavior, prevStep } =
    useWizardStore();
  const addInfluencer = useNftStore((s) => s.addInfluencer);
  const router = useRouter();

  const wallet = useWallet();
  const { setVisible } = useWalletModal();

  const [status, setStatus] = useState<MintStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<MintSuccess | null>(null);

  async function handleLaunch() {
    setError(null);

    if (!wallet.connected || !wallet.publicKey) {
      setStatus("connecting");
      setVisible(true);
      return;
    }

    try {
      setStatus("uploading");
      const umi = buildUmi(wallet);
      const wizardState = useWizardStore.getState();
      const metadata = buildMetadata(wizardState);

      setStatus("minting");
      const result = await mintInfluencerNft(umi, metadata);

      // Build the influencer object from metadata and store it
      const mockAsset = {
        id: result.mintAddress,
        content: {
          metadata: {
            name: metadata.name,
            description: metadata.description,
            attributes: metadata.attributes.map((a) => ({
              trait_type: a.trait_type,
              value: a.value,
            })),
          },
          links: { image: metadata.image },
        },
        authorities: [],
        creators: [],
      };
      const influencer = parseAssetToInfluencer(mockAsset);
      addInfluencer(result.mintAddress, influencer);

      setSuccess({ mintAddress: result.mintAddress, explorerUrl: result.explorerUrl });
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Unknown error during minting"
      );
    }
  }

  const STATUS_LABEL: Record<MintStatus, string> = {
    idle: "Launch AI Influencer",
    connecting: "Waiting for wallet...",
    uploading: "Uploading metadata to Arweave...",
    minting: "Minting NFT on Solana...",
    success: "Minted!",
    error: "Retry",
  };

  const isLoading = ["uploading", "minting"].includes(status);

  if (status === "success" && success) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <div className="size-16 rounded-full bg-emerald-600/20 flex items-center justify-center">
            <CheckCircle2 className="size-8 text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold">AI Influencer Launched!</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            <span className="font-semibold text-foreground">{identity.name}</span> is
            now live on Solana devnet as an NFT.
          </p>
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Mint address</p>
              <p className="font-mono text-xs break-all">{success.mintAddress}</p>
            </div>
            <a
              href={success.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              View on Solana Explorer
              <ExternalLink className="size-3.5" />
            </a>
          </CardContent>
        </Card>

        <Button
          className="w-full"
          size="lg"
          onClick={() => router.push("/market")}
        >
          Go to Market → See your AI Influencer
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Ready to Launch</h2>
        <p className="text-sm text-muted-foreground mt-1">
          This mints your AI Influencer as an NFT on Solana devnet and adds it
          to the Market.
        </p>
      </div>

      {!wallet.connected && (
        <Card className="border-amber-600/30 bg-amber-600/10">
          <CardContent className="p-3 flex items-center gap-2 text-sm text-amber-300">
            <Wallet className="size-4 shrink-0" />
            Connect your Phantom wallet before launching. You need devnet SOL.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground">Name & Handle</p>
            <p className="font-semibold">{identity.name || "(not set)"}</p>
            <p className="text-sm text-muted-foreground">
              @{identity.handle || "(not set)"}
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Archetype</p>
              <p className="capitalize">
                {identity.archetype
                  ? identity.archetype.replace(/-/g, " ")
                  : "(not set)"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Language</p>
              <p className="uppercase">{voice.language}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Niche</p>
              <p className="capitalize">{personality.niche}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Halal</p>
              <p>{brand.isHalal ? "Yes" : "No"}</p>
            </div>
          </div>

          <Separator />

          <div>
            <p className="text-xs text-muted-foreground mb-1.5">
              Approved categories
            </p>
            {brand.categories.length === 0 ? (
              <p className="text-xs text-muted-foreground">(none selected)</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {brand.categories.map((cat) => (
                  <Badge
                    key={cat}
                    variant="secondary"
                    className="capitalize text-xs"
                  >
                    {cat}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Operational pool</p>
              <p>{behavior.operationalPoolPercent}% of earnings</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Auto-accept above</p>
              <p>${behavior.autoAcceptBelow} USDC</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-emerald-600/30 bg-emerald-600/10">
        <CardContent className="p-3 space-y-1.5">
          {[
            "NFT minted on Solana devnet",
            "Metadata stored on Arweave via Irys",
            "Appears in Market grid",
            "Visible in your Phantom wallet",
          ].map((item) => (
            <div
              key={item}
              className="flex items-center gap-2 text-sm text-emerald-300"
            >
              <CheckCircle2 className="size-3.5" />
              {item}
            </div>
          ))}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/30 bg-destructive/10">
          <CardContent className="p-3 flex items-start gap-2 text-sm text-red-300">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Minting failed</p>
              <p className="text-xs mt-0.5 opacity-80">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {status === "uploading"
            ? "Uploading metadata to Arweave..."
            : "Minting NFT on Solana devnet..."}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep} disabled={isLoading}>
          Back
        </Button>
        <Button
          onClick={handleLaunch}
          size="lg"
          className="gap-2"
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Rocket className="size-4" />
          )}
          {STATUS_LABEL[status]}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit
```

Common issues:
- `useWizardStore.getState()` — Zustand stores expose `.getState()` on the store function, this is correct
- `buildUmi(wallet)` — if type error on WalletContextState, check the import from `@solana/wallet-adapter-react`

- [ ] **Step 4: Commit**

```bash
cd /Users/along/Documents/vello && git add components/studio/step-launch.tsx && git commit -m "feat: real Solana NFT minting in Studio launch step"
```

---

## Task 8: Market Page — Real On-Chain Data

**Files:**
- Modify: `app/market/page.tsx`

- [ ] **Step 1: Read `app/market/page.tsx`** to understand the current structure.

- [ ] **Step 2: Replace `app/market/page.tsx` with client component fetching real data**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PageShell } from "@/components/layout/page-shell";
import { InfluencerCard } from "@/components/influencer/influencer-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus } from "lucide-react";
import { useNftStore } from "@/store/nft";
import { fetchAssetsByCreator } from "@/lib/helius";
import type { AIInfluencer } from "@/lib/types";
import Link from "next/link";

export default function MarketPage() {
  const { publicKey, connected } = useWallet();
  const { influencers: storedInfluencers, addInfluencer } = useNftStore();
  const [onChainInfluencers, setOnChainInfluencers] = useState<AIInfluencer[]>([]);
  const [loading, setLoading] = useState(false);
  const [nicheFilter, setNicheFilter] = useState("all");
  const [langFilter, setLangFilter] = useState("all");
  const [halalOnly, setHalalOnly] = useState(false);
  const [search, setSearch] = useState("");

  const loadFromChain = useCallback(async () => {
    if (!connected || !publicKey) return;
    setLoading(true);
    try {
      const assets = await fetchAssetsByCreator(publicKey.toBase58());
      // Merge chain data into store (deduplicates by id)
      assets.forEach((inf) => addInfluencer(inf.id, inf));
      setOnChainInfluencers(assets);
    } catch (err) {
      console.error("Failed to fetch from Helius:", err);
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, addInfluencer]);

  useEffect(() => {
    loadFromChain();
  }, [loadFromChain]);

  // Combine stored (localStorage) and on-chain, deduplicate by id
  const allInfluencers: AIInfluencer[] = [
    ...storedInfluencers,
    ...onChainInfluencers.filter(
      (oc) => !storedInfluencers.some((s) => s.id === oc.id)
    ),
  ];

  const filtered = allInfluencers.filter((inf) => {
    if (nicheFilter !== "all" && inf.niche !== nicheFilter) return false;
    if (langFilter !== "all" && inf.language !== langFilter) return false;
    if (halalOnly && !inf.isHalal) return false;
    if (
      search &&
      !inf.name.toLowerCase().includes(search.toLowerCase()) &&
      !inf.handle.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });

  const totalTvl = allInfluencers.reduce((s, i) => s + i.tvl, 0);

  return (
    <PageShell
      title="Market"
      description="Discover and invest in autonomous AI Influencers"
    >
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Search AI Influencers..."
          className="max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={nicheFilter} onValueChange={setNicheFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Niche" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All niches</SelectItem>
            <SelectItem value="lifestyle">Lifestyle</SelectItem>
            <SelectItem value="tech">Tech</SelectItem>
            <SelectItem value="fashion">Fashion</SelectItem>
            <SelectItem value="fitness">Fitness</SelectItem>
            <SelectItem value="food">Food</SelectItem>
            <SelectItem value="travel">Travel</SelectItem>
            <SelectItem value="finance">Finance</SelectItem>
            <SelectItem value="gaming">Gaming</SelectItem>
          </SelectContent>
        </Select>
        <Select value={langFilter} onValueChange={setLangFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All languages</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="ms">Malay</SelectItem>
            <SelectItem value="id">Indonesian</SelectItem>
            <SelectItem value="ar">Arabic</SelectItem>
          </SelectContent>
        </Select>
        <Badge
          variant={halalOnly ? "default" : "outline"}
          className="cursor-pointer px-3 py-1.5"
          onClick={() => setHalalOnly((v) => !v)}
        >
          Halal only
        </Badge>
        {connected && (
          <Button
            variant="ghost"
            size="sm"
            onClick={loadFromChain}
            disabled={loading}
            className="ml-auto"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Refresh"
            )}
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-6 text-sm text-muted-foreground">
        <span>
          <span className="text-foreground font-semibold">
            {allInfluencers.length}
          </span>{" "}
          AI Influencers
        </span>
        {totalTvl > 0 && (
          <span>
            <span className="text-foreground font-semibold">
              ${totalTvl.toLocaleString()}
            </span>{" "}
            TVL
          </span>
        )}
        {loading && (
          <span className="flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            Loading from chain...
          </span>
        )}
      </div>

      {/* Empty state */}
      {allInfluencers.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <p className="text-muted-foreground text-sm">
            No AI Influencers on-chain yet.
          </p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Connect your Phantom wallet (devnet), go to Studio, and launch your
            first AI Influencer to see it here.
          </p>
          <Button render={<Link href="/studio/create" />} size="sm">
            <Plus className="size-4 mr-1" />
            Create AI Influencer
          </Button>
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((influencer) => (
            <InfluencerCard key={influencer.id} influencer={influencer} />
          ))}
        </div>
      )}

      {/* Filtered empty */}
      {allInfluencers.length > 0 && filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No AI Influencers match the current filters.
        </div>
      )}
    </PageShell>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /Users/along/Documents/vello && git add app/market/page.tsx && git commit -m "feat: Market page reads real on-chain NFTs via Helius DAS and localStorage"
```

---

## Task 9: Final Verification

**Files:** None new

- [ ] **Step 1: Full TypeScript check**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2: Lint check**

```bash
cd /Users/along/Documents/vello && npm run lint 2>&1 | grep -E "error" | head -20
```

Expected: zero errors (warnings about `<img>` are acceptable).

- [ ] **Step 3: Production build**

```bash
cd /Users/along/Documents/vello && npm run build
```

Expected: clean build, all routes compile.

Common build errors and fixes:
- `"use client"` missing on a component that uses `useWallet` — add `"use client"` at top
- `window is not defined` during SSR — wrap any `window` access in `typeof window !== "undefined"` check
- Metaplex packages using Node built-ins — already handled by webpack fallbacks in Task 1

- [ ] **Step 4: Smoke test end-to-end**

```bash
cd /Users/along/Documents/vello && npm run dev
```

Manual test:
1. Open http://localhost:3001
2. Click "Connect Wallet" → Phantom opens → switch to devnet → connect
3. TopBar shows truncated address
4. Go to Studio → Create AI Influencer
5. Fill all 6 steps (identity, voice, personality, brand, behavior)
6. Step 6 (Launch): click "Launch AI Influencer"
7. Phantom prompts to approve transaction → approve
8. See "Uploading metadata..." → "Minting NFT..." → success screen
9. Click "Go to Market" → see the new AI Influencer card
10. Refresh page → card still there (from localStorage)
11. Disconnect + reconnect wallet → card still there
12. View on Solana Explorer link → see the NFT on devnet

- [ ] **Step 5: Final commit**

```bash
cd /Users/along/Documents/vello && git add -A && git commit -m "feat: complete Solana NFT minting integration — wallet, mint, market"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Wallet connection (Phantom/Solflare) | Task 2 + 3 |
| Real wallet button with address/disconnect | Task 3 |
| Metadata built from wizard state | Task 4 (`buildMetadata`) |
| Metadata uploaded to Arweave (Irys devnet) | Task 4 (`mintInfluencerNft`) |
| NFT minted via Metaplex on devnet | Task 4 + 7 |
| Minting states (idle/uploading/minting/success/error) | Task 7 |
| Explorer link after mint | Task 7 |
| Mint address persisted to localStorage | Task 6 + 7 |
| Market fetches real NFTs via Helius DAS | Task 5 + 8 |
| Market shows empty state if no NFTs | Task 8 |
| Filters work on real data | Task 8 |
| TypeScript clean + build passes | Task 9 |

**No placeholders found.**

**Type consistency:** `AIInfluencer` from `lib/types.ts` used consistently. `parseAssetToInfluencer` in `lib/helius.ts` returns `AIInfluencer`. `addInfluencer` in `store/nft.ts` accepts `AIInfluencer`. `InfluencerCard` in Market receives `AIInfluencer`. All consistent.

---

## Notes for the Engineer

- **Devnet SOL needed**: ~0.02 SOL per mint (account rent + Irys). Get free SOL from https://faucet.solana.com or Phantom's built-in airdrop.
- **Irys devnet**: on first upload, Irys auto-funds from your wallet. Approve the funding transaction in Phantom before the metadata upload.
- **Transaction approval**: minting requires TWO Phantom approvals — one for Irys funding (first time only), one for the NFT creation.
- **Helius free tier**: 100k requests/month, more than enough for devnet testing.
- **Cross-device**: mints from localStorage show immediately. Mints from other devices appear after connecting wallet (Helius `getAssetsByCreator` query runs on wallet connect).

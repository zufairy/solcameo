"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWizardStore } from "@/store/wizard";
import { useNftStore } from "@/store/nft";
import { buildMetadata } from "@/lib/solana";
import { parseAssetToInfluencer } from "@/lib/helius";
import { useCreateAgent } from "@/hooks/use-create-agent";
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
  const createInfluencer = useCreateAgent();
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
      const wizardState = useWizardStore.getState();
      const metadata = buildMetadata(wizardState);
      setStatus("minting");
      const mintAddress = await createInfluencer({
        mintAddress: "server-assigned",
        creatorWallet: wallet.publicKey!.toBase58(),
        name: wizardState.identity.name,
        handle: `@${wizardState.identity.handle}`,
        avatarUrl: metadata.image,
        niche: wizardState.personality.niche,
        language: wizardState.voice.language,
        archetype: wizardState.identity.archetype,
        description: metadata.description,
        personality: {
          warmth: wizardState.personality.warmth,
          humor: wizardState.personality.humor,
          authority: wizardState.personality.authority,
          boldness: wizardState.personality.boldness,
        },
      });

      const result = { mintAddress, explorerUrl: `https://explorer.solana.com/address/${mintAddress}?cluster=devnet` };
      const influencer = parseAssetToInfluencer({
        id: mintAddress,
        content: { metadata: { name: metadata.name, description: metadata.description, attributes: metadata.attributes }, links: { image: metadata.image } },
        authorities: [], creators: [],
      });
      addInfluencer(mintAddress, influencer);

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
            "NFT minted on Solana",
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
            : "Minting NFT on Solana..."}
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

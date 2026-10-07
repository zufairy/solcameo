"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { notFound } from "next/navigation";
import { MarketTerminal } from "@/components/solstar/MarketTerminal";
import { InfluencerProfile } from "@/components/influencer/influencer-profile";
import { AppHeaderShell } from "@/components/home/app-shell";
import { Loader2 } from "lucide-react";
import type { AIInfluencer, Niche, Language } from "@/lib/types";

interface Props {
  id: string;
}

// /market/<id> resolves `id` as a HANDLE first (the current, canonical URL —
// e.g. /market/yumelyn_vello). A raw Solana mint address only ever matches
// the legacy fallback lookup below, whose sole job is to redirect old shared
// links (/market/6Y6c...BJt) forward to the agent's real handle URL.
//
// Client component: the profile is a live Convex subscription (view counts,
// price, etc keep ticking). The server sibling (page.tsx) supplies
// generateMetadata + a not-found check from the SAME handle lookup, run
// server-side, so Googlebot's initial HTML has a real <title>/description
// and a fast 404 instead of an empty client shell (see page.tsx for why).
export default function InfluencerPageClient({ id }: Props) {
  const router = useRouter();
  const character = useQuery(api.solstarMarket.characterForRoute, { id });
  const byHandle = useQuery(api.influencers.getByHandle, character === null ? { handle: id } : "skip");
  // Only fall back to a mint-address lookup once the handle lookup has
  // definitively missed — avoids a redundant query for the common case.
  const byMint = useQuery(api.influencers.getByMint, byHandle === null ? { mintAddress: id } : "skip");

  useEffect(() => {
    if (character?.slug && character.slug !== id) {
      router.replace(`/market/${character.slug}${window.location.search}`);
    } else if (character === null && byHandle === null && byMint && byMint.handleLower) {
      router.replace(`/market/${byMint.handleLower}`);
    }
  }, [character, id, byHandle, byMint, router]);

  if (character) return <MarketTerminal characterId={character.characterId} />;

  const doc = byHandle ?? (byHandle === null ? byMint : undefined);

  if (doc === undefined) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="flex items-center gap-2 text-zinc-500">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-[13px]">Loading agent…</span>
        </div>
      </div>
    );
  }

  if (doc === null) {
    notFound();
  }

  const influencer: AIInfluencer = {
    id: doc.mintAddress,
    name: doc.name,
    handle: doc.handle,
    avatarUrl: doc.avatarUrl,
    archetype: doc.archetype,
    niche: doc.niche as Niche,
    language: doc.language as Language,
    tvl: doc.tvl,
    monthlyEarnings: doc.monthlyEarnings,
    sharePrice: doc.sharePrice,
    totalShares: doc.totalShares,
    availableShares: doc.availableShares,
    description: doc.description,
    personality: doc.personality,
    contentHistory: [],
    earningsHistory: [],
    shareholders: [],
    createdAt: new Date(doc._creationTime).toISOString(),
    creatorWallet: doc.creatorWallet,
    agentWallet: doc.agentWallet,
    agentType: (doc.agentType as "influencer" | "trader" | "worker" | undefined) ?? undefined,
  };

  // Same app header as /agents (marketing TopNav/footer hidden for /market/*
  // in their hide-lists) — the profile reads as part of the app, not a
  // marketing page.
  return (
    <AppHeaderShell>
      <InfluencerProfile influencer={influencer} />
    </AppHeaderShell>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { canonicalUrl, cleanText } from "@/lib/seo";
import { MarketTerminal } from "@/components/solstar/MarketTerminal";
import InfluencerPageClient from "./InfluencerPageClient";

/* /market/<handle> used to be a bare "use client" page: the server sent an
 * empty shell and Convex filled it in the browser, so Googlebot's initial
 * HTML had no <title>, no description and no visible text for ~1,500 agent
 * pages. Search Console flagged nearly all of them "Discovered – currently
 * not indexed" — Google saw a wall of blank, identical-looking pages and
 * stopped bothering to crawl them, which also drags down how much it bothers
 * to crawl the REST of the site.
 *
 * This server wrapper runs the same handle lookup up front (one cheap Convex
 * query) so the crawler gets a real title/description and an instant 404 for
 * missing agents, without touching the client page's live behavior. */

interface Props {
  params: Promise<{ id: string }>;
}

async function lookupCharacter(id: string) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return new ConvexHttpClient(url)
    .query(api.solstarMarket.characterForRoute, { id })
    .catch(() => null);
}

async function lookupAgent(id: string) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return undefined;
  try {
    const convex = new ConvexHttpClient(convexUrl);
    const byHandle = await convex.query(api.influencers.getByHandle, {
      handle: id,
    });
    if (byHandle) return byHandle;
    // Legacy shared links used the raw mint address — resolved so those URLs
    // still get real metadata instead of falling through to the 404 branch.
    const byMint = await convex
      .query(api.influencers.getByMint, { mintAddress: id })
      .catch(() => null);
    return byMint ?? null;
  } catch {
    // Convex hiccup — degrade to no metadata rather than 500ing the page;
    // the client component below still resolves the agent itself.
    return undefined;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const character = await lookupCharacter(id);
  if (character)
    return {
      title: `${cleanText(character.name)} AI Influencer Token | Solcameo Market`,
      description: cleanText(character.bio).slice(0, 155),
      alternates: {
        canonical: canonicalUrl(`/market/${character.characterId}`),
      },
      openGraph: {
        title: `${cleanText(character.name)} on Solcameo`,
        description: cleanText(character.bio).slice(0, 155),
        url: canonicalUrl(`/market/${character.characterId}`),
        images: ["/og-solcameo.jpg"],
      },
      twitter: { card: "summary_large_image", title: `${cleanText(character.name)} on Solcameo`, description: cleanText(character.bio).slice(0, 155) },
    };
  const agent = await lookupAgent(id);
  if (!agent) {
    return { title: "Agent Not Found | Solcameo" };
  }
  const title = `${cleanText(agent.name)} (@${agent.handle}) | Solcameo Agents`;
  const description =
    cleanText(agent.description?.trim() ?? "") ||
    `${cleanText(agent.name)} is an AI agent on Solcameo, posting ${agent.niche ?? "content"} videos automatically.`;
  const url = canonicalUrl(`/market/${agent.handleLower ?? agent.handle}`);
  return {
    title,
    description: description.slice(0, 155),
    alternates: { canonical: url },
    openGraph: {
      title,
      description: description.slice(0, 155),
      url,
      images: agent.avatarUrl
        ? [{ url: agent.avatarUrl, width: 512, height: 512, alt: agent.name }]
        : undefined,
    },
  };
}

export default async function InfluencerPage({ params }: Props) {
  const { id } = await params;
  // undefined (Convex env missing / errored) still renders — the client
  // component does its own lookup and 404s. Only a confirmed miss on BOTH
  // handle and mint (null) short-circuits to notFound() here.
  const character = await lookupCharacter(id);
  if (character) return <MarketTerminal characterId={character.characterId} />;
  const agent = await lookupAgent(id);
  if (agent === null) notFound();
  return <InfluencerPageClient id={id} />;
}

import Link from "next/link";
import { TokenBadge } from "./TokenBadge";
import type { Network, TokenState } from "@/lib/solstar/types";

export type CatalogRow = {
  character: { _id: string; name: string; bio: string; referenceImageUrl?: string; category?: string };
  token: { ticker: string; state: TokenState; network: Network };
  latestEpisode: { posterUrl?: string; videoUrl?: string; title?: string } | null;
  followers: number;
};

export function CharacterCard({ row }: { row: CatalogRow }) {
  const { character, token, latestEpisode, followers } = row;
  const poster = latestEpisode?.posterUrl ?? character.referenceImageUrl;
  return (
    <Link
      href={`/market/${character._id}`}
      className="group block overflow-hidden rounded-xl border border-border bg-card text-card-foreground transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="aspect-[4/5] w-full bg-muted">
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- seed media is static; fixed aspect box prevents layout shift
          <img
            src={poster}
            alt={character.name}
            width={400}
            height={500}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-base font-semibold">{character.name}</h3>
          <span className="shrink-0 font-mono text-sm text-muted-foreground">${token.ticker}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <TokenBadge state={token.state} network={token.network} />
          <span className="text-xs text-muted-foreground">
            {followers.toLocaleString("en-US")} {followers === 1 ? "follower" : "followers"}
          </span>
        </div>
      </div>
    </Link>
  );
}

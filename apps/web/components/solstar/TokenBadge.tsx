import { tokenBadgeLabel } from "@/lib/solstar/tokenBadge";
import type { Network, TokenState } from "@/lib/solstar/types";

export function TokenBadge({ state, network }: { state: TokenState; network: Network }) {
  const simulated = network === "paper";
  const tone = simulated
    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
    : state === "failed"
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {tokenBadgeLabel(state, network)}
    </span>
  );
}

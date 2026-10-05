"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { SearchIcon, X, Scissors, User } from "lucide-react";

type AgentRow = FunctionReturnType<typeof api.influencers.listSearchable>[number];

// ── Agent type → "Influencer" | "Clipping" (mirrors the /agents marketplace) ──
const TYPE_LABEL: Record<string, "Influencer" | "Clipping"> = {
  influencer: "Influencer",
  clipper: "Clipping",
  trader: "Clipping",
  worker: "Clipping",
};
const NICHE_TO_TYPE: Record<string, "Influencer" | "Clipping"> = {
  finance: "Clipping", crypto: "Clipping", trading: "Clipping", tech: "Clipping", gaming: "Clipping",
  lifestyle: "Influencer", fashion: "Influencer", fitness: "Influencer", food: "Influencer",
  travel: "Influencer", beauty: "Influencer", support: "Clipping", sales: "Influencer", operations: "Clipping",
};
function resolveType(a: AgentRow): "Influencer" | "Clipping" {
  const t = typeof a.agentType === "string" ? a.agentType.toLowerCase() : "";
  if (TYPE_LABEL[t]) return TYPE_LABEL[t];
  const niche = (a.niche ?? "").toLowerCase();
  return NICHE_TO_TYPE[niche] ?? "Clipping";
}

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
// Total earned: lifetime USDC when present, else the monthly figure.
const earningsOf = (a: AgentRow) =>
  num(a.lifetimeEarningsUsdc) > 0 ? num(a.lifetimeEarningsUsdc) : num(a.monthlyEarnings);
function fmtEarnings(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function AgentSearch() {
  const router = useRouter();
  // Projected query — this mounts on every route; never subscribe it to full docs.
  const agents = useQuery(api.influencers.listSearchable) ?? [];
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return agents
      .filter((a) => {
        const name = (a.name ?? "").toLowerCase();
        const niche = (a.niche ?? "").toLowerCase();
        const handle = (a.handle ?? "").toLowerCase();
        const type = resolveType(a).toLowerCase();
        return name.includes(term) || niche.includes(term) || handle.includes(term) || type.includes(term);
      })
      .slice(0, 8);
  }, [q, agents]);

  useEffect(() => { setActive(0); }, [q]);

  // Close the dropdown on any outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (mint?: string) => {
    if (!mint) return;
    setOpen(false);
    setQ("");
    router.push(`/market/${mint}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[active]?.mintAddress); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  const showDropdown = open && q.trim().length > 0;

  return (
    <div ref={ref} className="relative w-full max-w-md">
      {/* Frosted-glass search field */}
      <div className="flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-full border border-white/20 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-xl transition-all duration-200 focus-within:border-white/35 focus-within:bg-white/[0.16]">
        <SearchIcon className="size-4 text-white/60 shrink-0" strokeWidth={2.25} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search agents…"
          aria-label="Search agents"
          className="flex-1 min-w-0 bg-transparent text-[13px] text-white placeholder:text-white/45 outline-none"
        />
        {q && (
          <button type="button" onClick={() => { setQ(""); setOpen(false); }} className="grid size-5 shrink-0 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white" aria-label="Clear search">
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {showDropdown && (
        <div className="absolute left-0 right-0 mt-2 z-[60] max-h-[60vh] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/98 shadow-2xl backdrop-blur-sm">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12.5px] text-zinc-500">No agents match “{q.trim()}”.</div>
          ) : (
            results.map((a, i) => {
              const type = resolveType(a);
              const isClip = type === "Clipping";
              return (
                <button
                  key={(a._id as string) ?? a.mintAddress}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(a.mintAddress)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${i === active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"}`}
                >
                  <span className="size-7 shrink-0 overflow-hidden rounded-md bg-zinc-800 ring-1 ring-white/10">
                    {a.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.avatarUrl} alt="" className="h-full w-full object-cover object-top" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[11px] font-black text-white/40">
                        {a.name?.[0]?.toUpperCase() ?? "?"}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-white">{a.name || "Agent"}</p>
                    {a.niche && <p className="truncate text-[11px] capitalize text-zinc-500">{a.niche}</p>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 pl-2">
                    <span className="font-mono text-[12.5px] font-semibold tabular-nums text-emerald-400">
                      {fmtEarnings(earningsOf(a))}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-white/85">
                      {isClip ? <Scissors className="size-3 text-zinc-400" /> : <User className="size-3 text-zinc-400" />}
                      {type}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

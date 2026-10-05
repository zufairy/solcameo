"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { motion } from "framer-motion";
import { Info, Copy, Check } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import { ConnectedPlatformStack } from "@/components/social/platform-icons";
import { fmtCompact, fmtUsd, rankAgents, summarize, windowStart, type AgentStats, type RankedAgent, type SortKey, type WindowKey } from "@/lib/tournament/rank";

const MONO = { fontFamily: "var(--font-geist-mono)" } as const;
const SPACE = { fontFamily: "var(--font-space)" } as const;
const APPLE = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Helvetica Neue', Arial, sans-serif",
} as const;

const WINDOWS: { id: WindowKey; label: string }[] = [
  { id: "7d", label: "This week" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];
const SORTS: { id: SortKey; label: string }[] = [
  { id: "views", label: "Views" },
  { id: "posted", label: "Posted" },
  { id: "followers", label: "Followers" },
  { id: "viewsPerUsd", label: "Views per $" },
  { id: "costUsdc", label: "Spend" },
];

const AGENT_STATS = makeFunctionReference<"query">("tournament:agentStats");

export function TournamentBoard() {
  const [win, setWin] = useState<WindowKey>("7d");
  const [sort, setSort] = useState<SortKey>("views");
  const [now] = useState(() => Date.now());
  // Stable per-window start so the per-agent subscriptions don't churn each render.
  const since = useMemo(() => windowStart(win, now), [win, now]);

  const roster = useQuery(api.tournament.roster, {});
  const statQueries = useMemo(() => {
    const q: Record<string, { query: typeof AGENT_STATS; args: { mintAddress: string; since?: number } }> = {};
    for (const a of roster ?? []) q[a.mintAddress] = { query: AGENT_STATS, args: { mintAddress: a.mintAddress, ...(since !== null ? { since } : {}) } };
    return q;
  }, [roster, since]);
  const statsRaw = useQueries(statQueries) as Record<string, (AgentStats & { truncated?: boolean }) | undefined | Error>;

  const { rows, loadedCount } = useMemo(() => {
    const stats: Record<string, AgentStats | undefined> = {};
    let loadedCount = 0;
    for (const [k, v] of Object.entries(statsRaw)) {
      if (v && !(v instanceof Error)) { stats[k] = v; loadedCount++; }
    }
    return { rows: rankAgents(roster ?? [], stats, sort), loadedCount };
  }, [roster, statsRaw, sort]);
  const totals = useMemo(() => summarize(rows), [rows]);
  const loading = roster === undefined;
  const partial = !loading && rows.length > 0 && loadedCount < rows.length;
  const podium = rows.slice(0, 3);

  const sortLabel = SORTS.find((s) => s.id === sort)!.label;
  const showPodium = !loading && podium.length > 0 && podium[0].views + podium[0].generated + podium[0].followers > 0;

  return (
    <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-12 sm:px-8 sm:pt-16">
      {/* Ambient lime glow — page-level, not boxed in any panel. Two soft
          drifting blobs (CSS keyframes, GPU-cheap) instead of a static radial
          so the page reads as alive even before anything else animates. */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[640px] overflow-hidden">
        <div className="drift-blob absolute left-1/2 top-[-220px] size-[620px] -translate-x-1/2 rounded-full opacity-[0.16] blur-[110px]" style={{ background: "radial-gradient(closest-side, #a3e635, transparent)" }} />
        <div className="drift-blob-2 absolute left-[15%] top-[40px] size-[340px] rounded-full opacity-[0.1] blur-[90px]" style={{ background: "radial-gradient(closest-side, #d9f99d, transparent)" }} />
      </div>
      <style>{`
        @keyframes driftBlob { 0%,100% { transform: translate(-50%,0) scale(1); } 50% { transform: translate(-50%,24px) scale(1.06); } }
        @keyframes driftBlob2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(30px,-16px); } }
        .drift-blob { animation: driftBlob 14s ease-in-out infinite; }
        .drift-blob-2 { animation: driftBlob2 18s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .drift-blob, .drift-blob-2 { animation: none; } }
      `}</style>

      {/* Header — no panel, no illustration icon. A small tracked eyebrow,
          then a large two-weight heading (regular "Agent" + bold lime-clipped
          "Leaderboard") for an editorial, premium feel instead of a boxed
          title bar. */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] text-white sm:text-[44px]" style={APPLE}>
            Agent Leaderboard
          </h1>
          <p className="mt-2 text-[14px] tracking-[-0.01em] text-white/45" style={APPLE}>
            {loading ? "Loading agents…" : (
              <>
                {totals.agents} agents · {fmtCompact(totals.views)} views · {fmtCompact(totals.posted)} posted · {fmtUsd(totals.costUsdc)} spend
                {partial && <span aria-live="polite"> · syncing {loadedCount}/{rows.length}</span>}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="tournament-sort">Rank by</label>
          <select id="tournament-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12.5px] text-white/80 outline-none transition-colors hover:border-lime-300/30 focus-visible:ring-2 focus-visible:ring-lime-300/40">
            {SORTS.map((s) => <option key={s.id} value={s.id} className="bg-[#0b0b0d]">Rank by {s.label}</option>)}
          </select>
          <Segmented ariaLabel="Time window" value={win} onChange={setWin} options={WINDOWS} />
        </div>
      </motion.div>

      {/* Podium — 2 · 1 · 3, each card standing on a stage whose height
          matches its rank. Stages rise 3rd → 2nd → 1st, then the cards drop
          on. Re-keyed on window/sort so the ceremony replays on a switch.
          Floats directly on the page — no wrapping panel. */}
      {showPodium && (
        <div key={`${win}-${sort}`} className="relative mt-10 grid grid-cols-3 items-end gap-2 sm:mt-14 sm:gap-4">
          {[podium[1], podium[0], podium[2]].map((r, i) =>
            r ? <PodiumSlot key={r.mintAddress} r={r} sort={sort} sortLabel={sortLabel} now={now} /> : <div key={`empty-${i}`} />,
          )}
        </div>
      )}

      {/* Leaderboard table, set ON the stage: it overlaps only the stages' base
          (STAGE_OVERLAP) — every stage is taller than overlap + its number band,
          so the 1/2/3 always stay readable above the table's top edge. Solid
          black panel, neutral hairline — no green glow. */}
      <div className={`relative z-20 overflow-hidden rounded-[1.35rem] border border-white/[0.09] bg-[#050506] shadow-[0_30px_80px_-30px_rgba(0,0,0,1)] ${showPodium ? STAGE_OVERLAP : "mt-10 sm:mt-14"}`}>
        <span aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <div className="relative overflow-x-auto p-3 sm:p-5">
          <table className="w-full min-w-[880px] text-left text-[13px]">
            <thead className="bg-white/[0.03]">
              <tr className="text-[11px] uppercase tracking-[0.1em] text-white/35">
                <th scope="col" className="px-3 py-3 font-medium">Rank</th>
                <th scope="col" className="px-3 py-3 font-medium">Agent</th>
                <Th active={sort === "views"} onClick={() => setSort("views")}>Views</Th>
                <Th active={sort === "posted"} onClick={() => setSort("posted")}>Posted</Th>
                <Th active={sort === "followers"} onClick={() => setSort("followers")}>Followers</Th>
                <Th active={sort === "costUsdc"} onClick={() => setSort("costUsdc")}>Spend</Th>
                <Th active={sort === "viewsPerUsd"} onClick={() => setSort("viewsPerUsd")}>Views / $</Th>
                <th scope="col" className="px-3 py-3 font-medium">Last post</th>
                <th scope="col" className="px-3 py-3 font-medium">Agent address</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-t border-white/[0.05]">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className="px-3 py-4"><div className="h-3.5 w-full max-w-[110px] rounded bg-white/[0.06] motion-safe:animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-14 text-center text-white/50">
                  No clipping agents yet. <Link href="/builder?type=clipping" className="text-white underline underline-offset-4">Build the first one</Link>.
                </td></tr>
              ) : rows.map((r, i) => (
                <motion.tr
                  key={r.mintAddress}
                  layout="position"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 380, damping: 34, delay: Math.min(i, 15) * 0.03 }}
                  className="border-t border-white/[0.05] transition-colors hover:bg-white/[0.035]"
                >
                  <td className="px-3 py-3"><RankBadge rank={r.rank} /></td>
                  <td className="px-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Link href={`/market/${encodeURIComponent(r.handle.toLowerCase())}`} className="group flex min-w-0 items-center gap-3 rounded-md focus-visible:ring-2 focus-visible:ring-white/40">
                        <AgentAvatar url={r.avatarUrl} name={r.name} seed={r.mintAddress} className="size-9 rounded-full" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-white group-hover:underline group-hover:underline-offset-4">{r.name}</span>
                          <span className="block truncate text-[11.5px] text-white/40">@{r.handle}</span>
                        </span>
                      </Link>
                      <ConnectedPlatformStack platforms={r.platforms} accounts={r.connectedSocialAccounts} badgeClassName="size-5" ringClassName="ring-[#050506]" />
                    </div>
                  </td>
                  <Td strong={sort === "views"} accent>{fmtCompact(r.views)}</Td>
                  <Td strong={sort === "posted"}>{fmtCompact(r.posted)}</Td>
                  <Td strong={sort === "followers"}>
                    <span className="inline-flex items-center gap-1.5">
                      {fmtCompact(r.followers)}
                      {r.followerDelta !== 0 && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${r.followerDelta > 0 ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>
                          {r.followerDelta > 0 ? "+" : ""}{fmtCompact(r.followerDelta)}
                        </span>
                      )}
                    </span>
                  </Td>
                  <Td strong={sort === "costUsdc"}>
                    <span title={r.costEstimated ? "Estimated at list price (no metered spend recorded for this window)" : "Metered spend (usage ledger)"}>
                      {fmtUsd(r.costUsdc)}{r.costEstimated && r.costUsdc > 0 ? <span className="ml-1 text-[10px] text-white/35">est.</span> : null}
                    </span>
                  </Td>
                  <Td strong={sort === "viewsPerUsd"}>{r.viewsPerUsd === null ? "—" : fmtCompact(r.viewsPerUsd)}</Td>
                  <td className="px-3 py-3 text-white/50">{r.lastPostedAt ? ago(r.lastPostedAt, now) : "—"}</td>
                  <td className="px-3 py-3"><CopyAddress address={r.mintAddress} /></td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 px-1 text-[12px] text-white/40">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>Live from the agents&apos; own clip, posting, follower and spend records; views and followers sync from the platforms on a schedule, so fresh platform changes can lag by up to an hour. Spend = metered usage in USDC; &ldquo;est.&rdquo; means list price ({fmtUsd(0.4)} per render + {fmtUsd(0.05)} per post) because no metered rows exist for the window.</span>
      </p>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; ariaLabel: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="relative inline-flex h-9 items-center rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}
          className={`relative h-full rounded-md px-3 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${value === o.id ? "text-white" : "text-white/55 hover:text-white"}`}>
          {value === o.id && (
            <motion.span layoutId="tournament-window" className="absolute inset-0 rounded-md bg-white/[0.12] ring-1 ring-white/15" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Podium stage ─────────────────────────────────────────────────────────
   Storyboard (per slot, delay by rank so the order is 3rd → 2nd → 1st):
     0ms     stage block grows up from the floor to its rank height
   +350ms    card drops onto the stage (fade + fall + settle)
   1st place adds a slow light sweep across its stage and a lime glow. */
/* Stage geometry: number band = top offset + text height (mobile 6+24px,
   sm 6+36px). The table overlaps each stage by STAGE_OVERLAP (12px / 16px),
   and even the shortest stage (3rd: 44px / 62px) keeps its full number visible
   above that. Keep these three in sync if you resize. */
const STAGE_OVERLAP = "-mt-3 sm:-mt-4";
const STAGE = {
  1: { height: "h-[76px] sm:h-[104px]", delay: 0.5, face: "from-amber-200/25 via-amber-300/[0.08] to-transparent", num: "from-amber-100 to-amber-400", edge: "bg-amber-200/60" },
  2: { height: "h-[58px] sm:h-[82px]", delay: 0.25, face: "from-white/20 via-white/[0.06] to-transparent", num: "from-white to-zinc-400", edge: "bg-white/50" },
  3: { height: "h-[44px] sm:h-[62px]", delay: 0, face: "from-orange-300/20 via-orange-400/[0.06] to-transparent", num: "from-orange-200 to-orange-500", edge: "bg-orange-300/50" },
} as const;

function PodiumSlot({ r, sort, sortLabel, now }: { r: RankedAgent; sort: SortKey; sortLabel: string; now: number }) {
  const stage = STAGE[(r.rank as 1 | 2 | 3)] ?? STAGE[3];
  const first = r.rank === 1;
  return (
    <div className="flex min-w-0 flex-col">
      <motion.div
        initial={{ opacity: 0, y: -28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 22, delay: stage.delay + 0.35 }}
        className="relative z-10"
      >
        <PodiumCard r={r} sort={sort} sortLabel={sortLabel} highlight={first} now={now} />
      </motion.div>
      <motion.div
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ type: "spring", stiffness: 170, damping: 22, delay: stage.delay }}
        style={{ transformOrigin: "bottom" }}
        className={`relative mt-3 overflow-hidden rounded-t-xl border border-b-0 border-white/[0.08] bg-gradient-to-b ${stage.face} ${stage.height}`}
      >
        <span aria-hidden className={`absolute inset-x-0 top-0 h-px ${stage.edge}`} />
        {first && (
          <span aria-hidden className="podium-sweep absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" />
        )}
        <span
          className={`absolute inset-x-0 top-1.5 bg-gradient-to-b bg-clip-text text-center text-[24px] font-bold leading-none text-transparent sm:top-1.5 sm:text-[36px] ${stage.num}`}
          style={SPACE}
        >
          {r.rank}
        </span>
      </motion.div>
      <style>{`
        @keyframes podiumSweep { from { transform: translateX(0); } to { transform: translateX(400%); } }
        .podium-sweep { animation: podiumSweep 3.2s ease-in-out 1.4s infinite; }
        @media (prefers-reduced-motion: reduce) { .podium-sweep { animation: none; } }
      `}</style>
    </div>
  );
}

function PodiumCard({ r, sort, sortLabel, highlight, now }: { r: RankedAgent; sort: SortKey; sortLabel: string; highlight: boolean; now: number }) {
  const primary = sort === "viewsPerUsd" ? (r.viewsPerUsd === null ? "—" : fmtCompact(r.viewsPerUsd)) : sort === "costUsdc" ? fmtUsd(r.costUsdc) : fmtCompact(r[sort]);
  const stats = [
    { label: sortLabel, value: primary, accent: true },
    ...(sort === "posted" ? [] : [{ label: "Posted", value: fmtCompact(r.posted) }]),
    ...(sort === "followers" ? [] : [{ label: "Followers", value: fmtCompact(r.followers) }]),
    ...(sort === "costUsdc" ? [] : [{ label: "Spend", value: fmtUsd(r.costUsdc) }]),
  ].slice(0, 4);
  return (
    <div
      className={`rounded-2xl border p-3 transition-colors sm:p-4 ${
        highlight
          ? "border-lime-300/40 bg-lime-400/[0.07] shadow-[0_0_40px_-12px_rgba(163,230,53,0.5)]"
          : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <Link href={`/market/${encodeURIComponent(r.handle.toLowerCase())}`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md focus-visible:ring-2 focus-visible:ring-white/40">
          <AgentAvatar url={r.avatarUrl} name={r.name} seed={r.mintAddress} className="size-9 shrink-0 rounded-full ring-1 ring-white/15 sm:size-11" />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-white sm:text-[14.5px]">{r.name}</span>
            <span className="block truncate text-[11px] text-white/40">@{r.handle}</span>
          </span>
        </Link>
        <span className="hidden sm:block">
          <ConnectedPlatformStack platforms={r.platforms} accounts={r.connectedSocialAccounts} badgeClassName="size-5" ringClassName="ring-[#0c0c10]" />
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:mt-4 sm:grid-cols-4">
        {stats.map((s, i) => (
          <div key={s.label} className={`min-w-0 ${i > 1 ? "hidden sm:block" : ""}`}>
            <p className="truncate text-[10.5px] text-white/35">{s.label}</p>
            <p className={`truncate text-[13px] font-semibold tabular-nums sm:text-[14px] ${s.accent ? "text-lime-300" : "text-white/90"}`} style={MONO}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 hidden items-center justify-between border-t border-white/[0.06] pt-3 sm:flex">
        <span className="text-[11px] text-white/35">{r.lastPostedAt ? `Last post ${ago(r.lastPostedAt, now)}` : "No posts yet"}</span>
        <CopyAddress address={r.mintAddress} compact />
      </div>
    </div>
  );
}

const RANK_BADGE: Record<number, string> = {
  1: "bg-gradient-to-b from-amber-200 to-amber-500 text-black",
  2: "bg-gradient-to-b from-zinc-100 to-zinc-400 text-black",
  3: "bg-gradient-to-b from-orange-200 to-orange-500 text-black",
};

function RankBadge({ rank }: { rank: number }) {
  return (
    <span className={`grid size-7 place-items-center rounded-full text-[12px] font-semibold tabular-nums ${RANK_BADGE[rank] ?? "bg-white/[0.05] text-white/60"}`} style={MONO}>
      {rank}
    </span>
  );
}

function CopyAddress({ address, compact }: { address: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked — nothing to do */ }
  };
  if (compact) {
    return (
      <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white">
        {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    );
  }
  return (
    <button type="button" onClick={copy} title="Copy agent address" className="inline-flex items-center gap-1.5 text-[12px] text-white/50 transition-colors hover:text-white" style={MONO}>
      {short}
      {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Th({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <th scope="col" aria-sort={active ? "descending" : "none"} className="px-3 py-3 font-medium">
      <button type="button" onClick={onClick} className={`rounded px-1 -mx-1 uppercase tracking-[0.1em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${active ? "text-white" : "hover:text-white/70"}`}>
        {children}{active ? " ↓" : ""}
      </button>
    </th>
  );
}

function Td({ children, strong, accent }: { children: React.ReactNode; strong?: boolean; accent?: boolean }) {
  const color = accent || strong ? "text-white" : "text-white/70";
  return <td className={`px-3 py-3 tabular-nums ${strong ? "font-semibold" : ""} ${color}`} style={MONO}>{children}</td>;
}

function ago(ts: number, now: number): string {
  const d = now - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

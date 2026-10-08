"use client";
import { useCallback, useState } from "react";
import { LabTabs } from "@/components/dev-lab/lab-tabs";
import { MaterialTile, type MaterialRender } from "@/components/post-material/material-tile";
import { useMaterialData } from "@/components/post-material/use-material-data";
import { MATERIAL_DESIGNS } from "@/lib/postMaterialDesigns";
import type { WindowKey } from "@/lib/tournament/rank";
import type { MaterialData } from "@/lib/server/postMaterialRender";

export default function PostMaterialPage() {
  const [window, setWindow] = useState<WindowKey | "today">("today");
  const { base, rows, totals, week, loaded, failed } = useMaterialData(window);
  const render = useCallback<MaterialRender>(async (data: MaterialData, format) => {
    const r = await fetch("/api/dev/post-material", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data, format }) });
    if (!r.ok) throw new Error("Render failed. Please try again.");
    return r.blob();
  }, []);
  return <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-7 sm:px-8"><LabTabs active="post-material" /><header className="mb-9 flex flex-col justify-between gap-6 border-b border-white/10 pb-7 md:flex-row md:items-end"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.32em] text-lime-300">Solcameo / Social desk</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] text-white sm:text-5xl">Post Material<span className="text-lime-300">.</span></h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">Seven premium 16:9 cards built from live network data. Pick a window, review the numbers, and export an animated GIF for X. The hero card always shows the trailing 7 days and the platform card the trailing 30.</p></div><div className="flex items-center gap-1 border border-white/10 bg-white/[.025] p-1">{([["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setWindow(id)} className={`px-4 py-2 font-mono text-[11px] uppercase tracking-wide transition-colors ${window === id ? "bg-lime-300 text-black" : "text-zinc-400 hover:text-white"}`}>{label}</button>)}</div></header><div className="mb-7 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[.16em] text-zinc-500"><span className="size-1.5 animate-pulse bg-lime-300" />Live Convex data <span className="text-zinc-700">/</span> {loaded ? `${totals.agents} agents · ${week.views.toLocaleString()} views this week` : failed ? "Data unavailable" : "Syncing agent stats…"}</div>{failed ? <div role="alert" className="border border-red-400/30 p-8 text-sm text-red-200">Some agent stats could not load. Refresh the page to try again.</div> : !loaded ? <div className="grid gap-9 md:grid-cols-2">{MATERIAL_DESIGNS.map((d) => <div key={d.kind} className="aspect-video animate-pulse border border-white/10 bg-white/[.04]" />)}</div> : rows.length === 0 ? <div className="border border-lime-300/15 bg-lime-300/[.03] p-12 text-center"><h2 className="text-xl font-semibold text-white">No agents to feature yet</h2><p className="mt-2 text-sm text-zinc-400">These cards will populate as soon as agents appear on the live leaderboard.</p></div> : <div className="grid gap-x-7 gap-y-12 md:grid-cols-2">{MATERIAL_DESIGNS.map((d, i) => <MaterialTile key={`${d.kind}-${window}`} data={{ ...base, kind: d.kind }} title={d.title} description={d.description} index={i} render={render} />)}</div>}</main>;
}

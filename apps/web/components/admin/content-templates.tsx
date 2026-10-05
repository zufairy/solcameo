"use client";
/* eslint-disable @next/next/no-img-element -- previews are browser blob URLs from the exact renderers */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { MATERIAL_DESIGNS } from "@/lib/postMaterialDesigns";
import { COUNTRIES, countryFromLanguage } from "@/lib/countries";
import { useMaterialData } from "@/components/post-material/use-material-data";
import { MaterialTile, downloadBlob, renderSlot, type MaterialRender } from "@/components/post-material/material-tile";
import type { MaterialData } from "@/lib/server/postMaterialRender";

type Agent = { mintAddress: string; name: string; avatarUrl: string; handle: string; niche?: string; language?: string };
export type TemplateUse = { url: string; kind: "video"; caption: string };

const tileButton = "border border-lime-300/35 bg-lime-300/[.07] px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[.13em] text-lime-200 transition-colors hover:bg-lime-300 hover:text-black active:scale-[.98] disabled:cursor-wait disabled:opacity-40";

/** The 10k-milestone share card (the X-cards design), animated, rendered by the real share-card route. */
function MilestoneTile({ name, index }: { name: string; index: number }) {
  const [still, setStill] = useState<string>();
  const [gif, setGif] = useState<{ url: string; blob: Blob }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true; const urls: string[] = [];
    const qs = (format: string) => `/api/share/x-card/preview?${new URLSearchParams({ name: name || "Vello Agent", views: "12400", videos: "1", posted: "1", best: "12400", platforms: "tiktok,youtube,instagram,x", avatar: "sample", seed: "milestone", format })}`;
    (async () => {
      try {
        const png = await fetch(qs("png")); if (!png.ok) throw new Error("Preview unavailable");
        const sUrl = URL.createObjectURL(await png.blob()); urls.push(sUrl); if (!live) return; setStill(sUrl);
        const blob = await renderSlot(async () => { const r = await fetch(qs("gif")); if (!r.ok) throw new Error("Animation unavailable"); return r.blob(); });
        const gUrl = URL.createObjectURL(blob); urls.push(gUrl); if (live) setGif({ url: gUrl, blob });
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "Preview failed"); }
    })();
    return () => { live = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [name]);
  const shown = gif?.url ?? still;
  return (
    <article className="min-w-0">
      <div className="relative aspect-video overflow-hidden border border-lime-300/20 bg-[#090c09] shadow-[0_24px_65px_-38px_rgba(154,209,89,.25)] transition-colors hover:border-lime-300/50">
        {shown ? <img src={shown} alt="10k video milestone card" className="h-full w-full object-contain" /> : <div className="absolute inset-0 animate-pulse bg-[#152015]" />}
        {still && <span className="absolute right-2 top-2 flex items-center gap-1.5 border border-lime-300/30 bg-black/70 px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[.16em] text-lime-200"><span className={`size-1.5 ${gif ? "bg-lime-300" : "animate-pulse bg-amber-300"}`} />{gif ? "Animated" : "Rendering animation"}</span>}
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="flex gap-3"><span className="pt-1 font-mono text-[11px] text-lime-300/65">0{index + 1}</span><div><h2 className="text-lg font-semibold tracking-tight text-white">10k Video Milestone</h2><p className="mt-1 text-xs text-zinc-500">The X membership card posted automatically when a video passes 10,000 views.</p></div></div>
        <button type="button" disabled={!gif} onClick={() => gif && downloadBlob(gif.blob, "vello-milestone-card.gif")} className={`${tileButton} shrink-0`}>Export GIF</button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </article>
  );
}

export function ContentTemplates({ agents, targetMint, xConnected, getToken, onUse, onPosted }: { agents: Agent[]; targetMint: string; xConnected: boolean; getToken: () => Promise<string | null>; onUse: (use: TemplateUse) => void; onPosted: (message: string) => void }) {
  const { base, rows, loaded, failed } = useMaterialData("7d");
  const [launchMint, setLaunchMint] = useState("");
  const [countryPick, setCountryPick] = useState("");
  const [using, setUsing] = useState("");
  const [error, setError] = useState("");
  const launchAgent = agents.find((a) => a.mintAddress === (launchMint || targetMint)) ?? agents[0];
  const country = countryPick || countryFromLanguage(launchAgent?.language);
  const render = useCallback<MaterialRender>(async (data, format) => {
    const token = await getToken();
    if (!token) throw new Error("Sign in as an admin to render templates");
    const res = await fetch("/api/admin/content-control/material", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ data, format }) });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Render failed");
    return res.blob();
  }, [getToken]);
  const designs = useMemo(() => MATERIAL_DESIGNS.map((d) => {
    const data: MaterialData = { ...base, kind: d.kind };
    if (d.kind === "launch") {
      if (!launchAgent) return null;
      data.minted = [{ name: launchAgent.name, handle: launchAgent.handle, avatarUrl: launchAgent.avatarUrl, ago: "just now", niche: launchAgent.niche || undefined, country: country || undefined }];
      data.launchNo = Math.max(1, base.totalAgents);
    }
    return { ...d, data };
  }).filter((d): d is NonNullable<typeof d> => !!d), [base, launchAgent, country]);
  /** `attach`: put the looping video in the composer. `post`: render, tag the posting account and queue it to X right away. */
  /** Agents whose X accounts get @mentioned: the launched agent, or the leaderboard top three. */
  const mentionsFor = (kind: string) => kind === "launch" ? (launchAgent ? [launchAgent.mintAddress] : []) : kind === "leaderboard" ? rows.slice(0, 3).map((r) => r.mintAddress) : [];
  async function use(data: MaterialData, caption: string, kind: string, mode: "attach" | "post") {
    setUsing(`${kind}:${mode}`); setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in as an admin to continue");
      let res: Response;
      try {
        res = await fetch("/api/admin/content-control/material", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(mode === "post" ? { data, format: "post", targetMint: targetMint || undefined, key: crypto.randomUUID(), caption, mentionMints: mentionsFor(kind) } : { data, format: "mp4" }) });
      } catch { throw new Error("The server stopped responding while rendering the video. Try again in a moment."); }
      const payload = await res.json().catch(() => ({ error: `Render failed (${res.status})` }));
      if (!res.ok) throw new Error(payload.error || "Could not prepare the video");
      if (mode === "post") onPosted(`Queued to X as a looping video: "${payload.caption}". The same post is never queued twice.`);
      else onUse({ url: payload.url, kind: "video", caption });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare the video"); }
    finally { setUsing(""); }
  }
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0d0d10] p-6" aria-labelledby="templates-heading">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-400"><Sparkles className="size-5" /></div><div><h2 id="templates-heading" className="font-semibold">Animated templates</h2><p className="mt-1 text-xs text-zinc-500">Live Vello data in the 8-bit card theme. Use one to attach it as a looping video, or export the GIF.</p></div></div>
        {agents.length > 0 && <div className="flex flex-wrap gap-3">
          <div><label htmlFor="launch-agent" className="mb-1.5 block text-xs text-zinc-400">Agent for the launch card</label><select id="launch-agent" className="w-56 rounded-xl border border-white/10 bg-[#121216] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40" value={launchAgent?.mintAddress ?? ""} onChange={(e) => { setLaunchMint(e.target.value); setCountryPick(""); }}>{agents.map((a) => <option key={a.mintAddress} value={a.mintAddress}>{a.name}</option>)}</select></div>
          <div><label htmlFor="launch-country" className="mb-1.5 block text-xs text-zinc-400">Flag on the card</label><select id="launch-country" className="w-44 rounded-xl border border-white/10 bg-[#121216] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40" value={country} onChange={(e) => setCountryPick(e.target.value)}><option value="">None</option>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
        </div>}
      </div>
      {error && <p role="alert" className="mb-4 text-xs text-red-300">{error}</p>}
      {failed ? <p role="alert" className="text-sm text-red-300">Some agent stats could not load. Refresh the page to try again.</p>
        : !loaded ? <div className="flex items-center gap-2 py-10 text-sm text-zinc-400"><Loader2 className="size-4 animate-spin" />Syncing live network data</div>
        : <div className="grid gap-x-7 gap-y-12 md:grid-cols-2">
          {designs.map((d, i) => <MaterialTile key={d.kind + (d.kind === "launch" ? `${launchAgent?.mintAddress}:${country}` : "")} data={d.data} title={d.title} description={d.description} index={i} render={render} autoAnimate
            extra={<div className="flex flex-col items-end gap-2">
              <button type="button" disabled={!!using || !xConnected} title={xConnected ? "Render the video, tag the agent and post it to X" : "Connect X on the posting account first"} onClick={() => void use(d.data, d.caption(d.data), d.kind, "post")} className={`${tileButton} inline-flex items-center gap-1.5`}>{using === `${d.kind}:post` ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}{using === `${d.kind}:post` ? "Posting…" : "Post to X"}</button>
              <button type="button" disabled={!!using} onClick={() => void use(d.data, d.caption(d.data), d.kind, "attach")} className="font-mono text-[10px] uppercase tracking-[.13em] text-zinc-400 transition-colors hover:text-white disabled:opacity-40">{using === `${d.kind}:attach` ? "Preparing…" : "Edit in composer"}</button>
            </div>} />)}
          <MilestoneTile name={launchAgent?.name ?? ""} index={designs.length} />
        </div>}
    </section>
  );
}

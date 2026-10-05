"use client";

/* ════════ /dev/x-cards — VELLO MEMBERSHIP share-card lab ════════
   Every tile is the REAL render (hits /api/share/x-card/preview → the same
   renderShareCard / renderShareGif the posting flow uses) — never a CSS mockup.
   Animated tiles are the exact GIF that gets posted to X.
   Design lives in:
     lib/share/xShareCard.ts            tiers, materials, colours, timing
     lib/server/xShareCardRender.tsx    layout, textures, motion
   Edit, then refresh this page. */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { LabTabs } from "@/components/dev-lab/lab-tabs";

/* Premium staggered reveal: each tile rises + fades + un-blurs in, offset by
 * its position in the grid — the "cards materializing" feel this lab wants,
 * instead of the whole grid popping in at once. `animate` (not `whileInView`)
 * on purpose: whileInView's intersection-observer trigger went stale on this
 * page's own debounced re-renders (the 450ms preview-params sync effect),
 * occasionally leaving a section's variants stuck at "hidden" — invisible
 * cards. Every section here is short enough to already be near the
 * viewport on load anyway, so a plain mount-triggered reveal is both
 * simpler and actually reliable. */
const REVEAL_GRID = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
} as const;
const REVEAL_TILE = {
  hidden: { opacity: 0, y: 22, scale: 0.96, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
} as const;

const TIER_LADDER = [
  { label: "MEMBER", material: "Triptych · 10px mono", views: 8_400 },
  { label: "SILVER", material: "3D clip deck · cool duotone", views: 250_000 },
  { label: "GOLD", material: "Three-card hand · Member, Silver, Gold", views: 2_450_000 },
  { label: "PLATINUM", material: "First membership card · original animation", views: 20_000_000 },
  { label: "VELLO BLACK", material: "Premium black + gold foil card", views: 1_500_000_000 },
] as const;

const PLATFORM_OPTIONS = ["tiktok", "youtube", "instagram", "x", "facebook", "threads"] as const;

function cardUrl(params: Record<string, string | number>, format: "gif" | "png"): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
  sp.set("format", format);
  return `/api/share/x-card/preview?${sp.toString()}`;
}

function CardTile({ title, sub, src, gifSrc, download }: { title: string; sub?: string; src: string; gifSrc?: string; download?: string }) {
  const [animated, setAnimated] = useState(false);
  return (
    <motion.div variants={REVEAL_TILE} className="flex flex-col gap-2.5">
      <div className="group relative aspect-[1200/675] overflow-hidden rounded-xl border border-white/10 bg-[#050505] shadow-[0_20px_50px_-24px_rgba(0,0,0,0.8)] transition-transform duration-300 hover:-translate-y-0.5 hover:border-white/20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={animated && gifSrc ? gifSrc : src} alt={title} width={1200} height={675} className="block h-auto w-full" loading="lazy" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.16em] text-zinc-200">{title}</p>
          {sub ? <p className="text-[11px] text-zinc-500">{sub}</p> : null}
        </div>
        <div className="flex gap-2">
          {gifSrc ? <button type="button" onClick={() => setAnimated((value) => !value)} className="border border-white/15 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:border-white/40 hover:text-white">{animated ? "Still" : "Play"}</button> : null}
          {download ? <a href={gifSrc ?? src} download={download} className="border border-white/15 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:border-white/40 hover:text-white">Download</a> : null}
        </div>
      </div>
    </motion.div>
  );
}

const inputCls = "border border-white/15 bg-black/40 px-2.5 py-1.5 text-[13px] text-white outline-none focus:border-white/40";

export default function XCardsLabPage() {
  const [name, setName] = useState("Rainier Clips");
  const [handle, setHandle] = useState("rainierclips");
  const [views, setViews] = useState(8_400); // top card opens on the first design (Member triptych)
  const [videos, setVideos] = useState(24);
  const [posted, setPosted] = useState(19);
  const [bestViews, setBestViews] = useState(2_500);
  const [platforms, setPlatforms] = useState<string[]>(["tiktok", "youtube", "instagram", "x"]);
  const [nonce, setNonce] = useState(0);
  const [avatar, setAvatar] = useState(true);
  const [clips, setClips] = useState(true);
  const [showVariations, setShowVariations] = useState(false);

  const togglePlatform = (id: string) =>
    setPlatforms((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const baseParams = useMemo(() => ({
    name, handle, views, videos, posted, best: bestViews,
    platforms: platforms.join(","), seed: "lab", nonce, avatar: avatar ? "sample" : "none", thumbs: clips ? "sample" : "none",
  }), [name, handle, views, videos, posted, bestViews, platforms, nonce, avatar, clips]);
  const [previewParams, setPreviewParams] = useState(baseParams);
  useEffect(() => {
    const timeout = setTimeout(() => setPreviewParams(baseParams), 450);
    return () => clearTimeout(timeout);
  }, [baseParams]);

  const slug = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "vello";

  return (
    <div className="mx-auto max-w-[1400px] px-6 pb-24 pt-8">
      <LabTabs active="x-cards" />

      <header className="mx-auto mb-10 max-w-2xl text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Design lab</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-white">Vello Share Cards</h1>
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-zinc-400">
          Every tier is its own design: clip triptych, 3D clip deck, the three-card gold hand, the membership card, and the premium Vello Black card.
          Stills load first; press Play for the exact GIF posted to X.
          Edit <code className="bg-white/10 px-1.5 py-0.5 text-[12px]">lib/share/xShareCard.ts</code> and{" "}
          <code className="bg-white/10 px-1.5 py-0.5 text-[12px]">lib/server/xShareCardRender.tsx</code>, then refresh.
        </p>
      </header>

      {/* Controls */}
      <div className="mx-auto mb-12 grid max-w-3xl grid-cols-2 gap-4 border border-white/10 bg-white/[0.02] p-5 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Agent name
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Handle
          <input value={handle} onChange={(e) => setHandle(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Views
          <input type="number" value={views} onChange={(e) => setViews(Number(e.target.value) || 0)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Best clip
          <input type="number" value={bestViews} onChange={(e) => setBestViews(Number(e.target.value) || 0)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Videos
          <input type="number" value={videos} onChange={(e) => setVideos(Number(e.target.value) || 0)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Posted
          <input type="number" value={posted} onChange={(e) => setPosted(Number(e.target.value) || 0)} className={inputCls} />
        </label>
        <div className="col-span-2 flex flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Platforms
          <div className="flex flex-wrap gap-1.5">
            {PLATFORM_OPTIONS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => togglePlatform(id)}
                className={`border px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide transition-colors ${
                  platforms.includes(id) ? "border-white bg-white text-black" : "border-white/15 text-zinc-400 hover:text-white"
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAvatar((a) => !a)}
          className={`col-span-2 border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors sm:col-span-2 ${avatar ? "border-white bg-white text-black" : "border-white/20 text-white hover:bg-white/[0.1]"}`}
        >
          {avatar ? "Sample avatar · on" : "No avatar (logo fallback)"}
        </button>
        <button
          type="button"
          onClick={() => setClips((c) => !c)}
          className={`col-span-2 border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors sm:col-span-2 ${clips ? "border-white bg-white text-black" : "border-white/20 text-white hover:bg-white/[0.1]"}`}
        >
          {clips ? "Sample clips · on" : "No clips (placeholders)"}
        </button>
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="col-span-2 border border-white/20 bg-white/[0.05] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-white/[0.1] sm:col-span-2"
        >
          New design (swap sides) · {nonce}
        </button>
      </div>

      <section className="mb-14">
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Live · animated</h2>
        <motion.div variants={REVEAL_GRID} initial="hidden" animate="show" className="mx-auto max-w-4xl">
          <CardTile title={name} sub={`${views.toLocaleString()} tracked views`} src={cardUrl(previewParams, "png")} gifSrc={cardUrl(previewParams, "gif")} download={`${slug}-vello-membership.gif`} />
        </motion.div>
      </section>

      <section className="mb-14">
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Tier ladder · animated</h2>
        <motion.div variants={REVEAL_GRID} initial="hidden" animate="show" className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {TIER_LADDER.map((t) => (
            <CardTile
              key={t.label}
              title={t.label}
              sub={`${t.material} · ${t.views.toLocaleString()} views`}
              src={cardUrl({ ...previewParams, views: t.views, best: Math.round(t.views * 0.3) }, "png")}
              gifSrc={cardUrl({ ...previewParams, views: t.views, best: Math.round(t.views * 0.3) }, "gif")}
              download={`${slug}-${t.label.toLowerCase().replace(/\s+/g, "-")}.gif`}
            />
          ))}
        </motion.div>
      </section>

      <section>
        <button type="button" onClick={() => setShowVariations((value) => !value)} className="mb-4 text-[12px] font-semibold uppercase tracking-[0.2em] text-zinc-500 hover:text-white">
          Design variants · stills {showVariations ? "−" : "+"}
        </button>
        {showVariations ? (
          <motion.div variants={REVEAL_GRID} initial="hidden" animate="show" className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <CardTile key={i} title={`Nonce ${nonce + i}`} src={cardUrl({ ...previewParams, nonce: nonce + i }, "png")} />
            ))}
          </motion.div>
        ) : null}
      </section>
    </div>
  );
}

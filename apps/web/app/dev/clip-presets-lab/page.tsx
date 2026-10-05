"use client";

/* ════════ /dev/clip-presets-lab — clip template gallery ════════
   Read-only look at every saved AI-Clipper template (CLIP_TEMPLATES,
   components/builder/clipping-flow/data/templates.ts) — each one a factory
   for a pre-wired node graph (Source → skills → Publish), not a single
   visual effect like a caption preset, so this is an info gallery rather
   than an animated preview. No editor here — templates are defined in code. */

import { LabTabs } from "@/components/dev-lab/lab-tabs";
import { CLIP_TEMPLATES } from "@/components/builder/clipping-flow/data/templates";
import { ArrowRight } from "lucide-react";

export default function ClipPresetsLabPage() {
  return (
    <div className="min-h-screen bg-[#08080a] px-6 py-6 text-white">
      <LabTabs active="clips" />
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CLIP_TEMPLATES.map((tpl) => (
            <div key={tpl.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <div className="relative aspect-video w-full bg-[#111114]">
                {tpl.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tpl.image} alt="" className="size-full object-cover" />
                ) : (
                  <span className="grid size-full place-items-center text-4xl">{tpl.icon}</span>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <p className="absolute bottom-2 left-3 flex items-center gap-1.5 text-[14px] font-semibold text-white">
                  <span>{tpl.icon}</span> {tpl.name}
                </p>
              </div>
              <div className="p-4">
                <p className="text-[12.5px] leading-snug text-white/70">{tpl.tagline}</p>
                <p className="mt-2 text-[11px] leading-snug text-white/40">{tpl.useCase}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {tpl.nodeSummary.map((n, i) => (
                    <span key={n} className="flex items-center gap-1.5 text-[10.5px] text-white/45">
                      {i > 0 && <ArrowRight className="size-2.5 text-white/25" />}
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">{n}</span>
                    </span>
                  ))}
                </div>
                {tpl.skillIds.length > 0 && (
                  <p className="mt-3 text-[10px] text-white/30">{tpl.skillIds.length} skill{tpl.skillIds.length === 1 ? "" : "s"} auto-installed</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

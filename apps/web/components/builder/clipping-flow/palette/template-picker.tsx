"use client";

import { useState } from "react";
import { LayoutTemplate, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CLIP_TEMPLATES, type ClipTemplate } from "@/components/builder/clipping-flow/data/templates";

/**
 * Template thumbnail: the style-representative image, with a graceful emoji
 * fallback if it's missing / fails to load (so a broken asset never leaves an
 * empty card). `size` drives both the box and the fallback emoji scale.
 */
function TemplateThumb({ t, className = "" }: { t: ClipTemplate; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (t.image && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={t.image}
        alt={t.name}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`object-cover ${className}`}
      />
    );
  }
  return (
    <span className={`grid place-items-center bg-zinc-900/5 ${className}`}>
      <span className="leading-none">{t.icon}</span>
    </span>
  );
}

/**
 * Template picker - two surfaces, one component:
 *  - "cards": the empty-canvas hero ("pick a template and hit go"), a grid of
 *    cards centered over the blank canvas.
 *  - "menu": a compact Templates dropdown for the canvas toolbar (works on a
 *    non-empty canvas too; the apply handler confirms overwrite upstream).
 */
export function TemplatePicker({
  variant,
  onApply,
  disabled,
}: {
  variant: "cards" | "menu";
  onApply: (t: ClipTemplate) => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  if (variant === "menu") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="secondary" size="sm" disabled={disabled} title="Start from a template" />}>
          <LayoutTemplate className="size-3.5" />
          Templates
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {CLIP_TEMPLATES.map((t) => (
            <DropdownMenuItem key={t.id} onClick={() => onApply(t)} className="flex items-start gap-2.5 py-2">
              <TemplateThumb t={t} className="size-9 shrink-0 rounded-md text-lg" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{t.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{t.tagline}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    // pointer-events stays OFF on the column wrapper - only the interactive
    // cards re-enable it, so canvas clicks in the layout gaps pass through.
    <div className="pointer-events-none flex max-w-5xl flex-col items-center gap-4">
      <div className="text-center">
        <div className="text-lg font-semibold text-zinc-700">Start with a template</div>
        <div className="text-sm text-zinc-500">A pre-wired pipeline - paste your video URL and run.</div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CLIP_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => onApply(t)}
            onMouseEnter={() => setHovered(t.id)}
            onMouseLeave={() => setHovered(null)}
            className={`pointer-events-auto flex w-60 flex-col overflow-hidden rounded-xl border-2 border-[#1c1c1f] bg-[#fffdf7] text-left shadow-[3px_3px_0_rgba(28,28,31,0.35)] transition-transform disabled:cursor-not-allowed disabled:opacity-50 ${
              hovered === t.id ? "-translate-y-1" : ""
            }`}
          >
            {/* Thumbnail banner, the style image, with a subtle title overlay. */}
            <div className="relative h-24 w-full overflow-hidden border-b-2 border-[#1c1c1f]">
              <TemplateThumb t={t} className="size-full text-3xl" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-1.5 pt-6">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
                  <span className="leading-none">{t.icon}</span>
                  {t.name}
                </span>
              </span>
            </div>
            <div className="flex flex-col gap-2 p-3.5">
              <div className="text-xs leading-relaxed text-zinc-700">{t.tagline}</div>
              <div className="text-[11px] leading-relaxed text-zinc-500">
                <span className="font-semibold text-zinc-600">Best for:</span> {t.useCase}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {t.nodeSummary.map((n) => (
                  <span key={n} className="rounded-full bg-zinc-900/5 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                    {n}
                  </span>
                ))}
              </div>
              <span className="mt-1 inline-flex w-fit rounded-lg bg-[#1c1c1f] px-3 py-1.5 text-xs font-medium text-[#fffdf7]">
                Use template
              </span>
            </div>
          </button>
        ))}
      </div>
      <div className="text-xs text-zinc-400">or build from scratch - tap + to open the node palette</div>
    </div>
  );
}

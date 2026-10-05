"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Trash2, Search, X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { clipSkillPriceLabel, priceLabelFromUsdc } from "@/lib/economy/servicePrices";
import {
  MARKETPLACE_CLIP_SKILLS,
  CLIP_SKILL_CATEGORIES,
  categoryForSkill,
  isClipSkillId,
  isWipClipSkill,
} from "@/lib/builder/clipSkillsCatalog";

// Per-skill icons + the iconify URL builder live in a shared module so the App
// Store medallion and the canvas node cards render the EXACT same logo per skill.
import { SKILL_ICON, EMOJI_ICON, iconifyUrl } from "@/lib/builder/skillIcons";

// Category → header theme (soft gradient + accent) so cards read as a cohesive,
// colour-coded App-Store shelf and the operator can tell families apart at a glance.
const CATEGORY_THEME: Record<string, { from: string; to: string }> = {
  "Captions":               { from: "#dbeafe", to: "#eff6ff" }, // blue
  "Post Caption":           { from: "#cffafe", to: "#ecfeff" }, // sky
  "Hooks & Openers":        { from: "#fed7aa", to: "#fff7ed" }, // amber
  "Overlays & Emphasis":    { from: "#fbcfe8", to: "#fdf2f8" }, // pink
  "Image Overlay":          { from: "#fde68a", to: "#fffbeb" }, // gold
  "Pacing":                 { from: "#ddd6fe", to: "#f5f3ff" }, // violet
  "Framing":                { from: "#99f6e4", to: "#f0fdfa" }, // teal
  "Backgrounds & Audio":    { from: "#c7d2fe", to: "#eef2ff" }, // indigo
  "Music":                  { from: "#f5d0fe", to: "#fdf4ff" }, // fuchsia
  "Transitions":            { from: "#a5f3fc", to: "#ecfeff" }, // cyan
  "Targeting & Discovery":  { from: "#bbf7d0", to: "#f0fdf4" }, // emerald
  "Quality & Safety":       { from: "#fecaca", to: "#fef2f2" }, // rose, a blocking gate
  "Apps":                   { from: "#fef3c7", to: "#fffbeb" }, // amber, app-store tab installs
};
const DEFAULT_THEME = { from: "#e4e4e7", to: "#fafafa" };

/** App-Store-style skill medallion: a large, crisp internet icon on a white disc,
 *  falling back to the raw emoji glyph if the remote icon fails to load. */
function SkillMedallion({ skillId, emoji, dim }: { skillId: string; emoji: string; dim?: boolean }) {
  const name = SKILL_ICON[skillId] ?? EMOJI_ICON[emoji];
  const [ok, setOk] = useState(Boolean(name));
  return (
    <span
      className={`flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-900/10 bg-white text-xl leading-none shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] ${dim ? "opacity-70" : ""}`}
    >
      {ok && name ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconifyUrl(name)}
          alt=""
          width={30}
          height={30}
          loading="lazy"
          onError={() => setOk(false)}
          className="size-[26px] object-contain"
        />
      ) : (
        emoji
      )}
    </span>
  );
}

/**
 * Clipping skills Marketplace (builder "Marketplace" tab). Lists the clipping
 * skill catalog; installing one (free) writes its MD into agentSkillFiles - the
 * Library - and it then shows up as a draggable node on the canvas + drives the
 * AI editor at Run time. Cream/neobrutalist to match the builder.
 *
 * QoL: search (name/blurb/tag) + category filter chips. Deprecated caption-style
 * skills (now covered by the Dynamic Captions preset picker) are excluded.
 */
export function MarketplacePanel({ sessionId, mintAddress }: { sessionId?: string; mintAddress?: string }) {
  const ownedDocs =
    (useQuery(
      mintAddress ? api.agentSkillFiles.listByMint : api.agentSkillFiles.listBySession,
      mintAddress ? { mintAddress } : sessionId ? { sessionId } : "skip",
    ) as { _id: string; skillId: string }[] | undefined) ?? [];
  const ownedById = new Map(
    ownedDocs.filter((d) => isClipSkillId(d.skillId)).map((d) => [d.skillId, d._id]),
  );
  const upsert = useMutation(api.agentSkillFiles.upsert);
  const remove = useMutation(api.agentSkillFiles.remove);

  // Effective per-run prices (static defaults with any admin overrides applied).
  // Falls back to the static label until the query resolves.
  const effectivePrices = (useQuery(api.adminPricing.effectiveSkillPrices, {}) as
    | { effective: Record<string, number> } | undefined)?.effective;
  const priceLabel = (id: string) => (effectivePrices ? priceLabelFromUsdc(effectivePrices[id]) : clipSkillPriceLabel(id));

  const canWrite = Boolean(sessionId || mintAddress);
  const sessionKey = sessionId ?? mintAddress ?? "";

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MARKETPLACE_CLIP_SKILLS.filter((s) => {
      if (category !== "All" && categoryForSkill(s.id) !== category) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.blurb.toLowerCase().includes(q) ||
        s.tag.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  const install = (id: string) => {
    if (!canWrite) return;
    if (isWipClipSkill(id)) return; // WIP skills are inert - never install for now.
    const skill = MARKETPLACE_CLIP_SKILLS.find((s) => s.id === id);
    if (!skill) return;
    void upsert({
      sessionId: sessionKey,
      skillId: skill.id,
      title: skill.name,
      markdown: skill.markdownTemplate,
      ...(mintAddress ? { mintAddress } : {}),
    });
  };
  const uninstall = (id: string) => {
    const docId = ownedById.get(id);
    if (docId) void remove({ id: docId as unknown as never });
  };

  const chips = ["All", ...CLIP_SKILL_CATEGORIES];

  return (
    <div className="min-h-full bg-[#ece5d6] px-8 py-10" style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}>
      <h2 className="font-serif text-2xl font-bold text-zinc-900">App Store</h2>
      <p className="mt-1 text-sm text-zinc-600">
        Install skills - they land in your Library and become nodes you can drop on the canvas.
      </p>
      {!canWrite && (
        <p className="mt-2 text-sm text-amber-700">Open this agent from the builder to install skills.</p>
      )}

      {/* Search */}
      <div className="mt-5 flex items-center gap-2 rounded-xl border-2 border-zinc-900/15 bg-white px-3 py-2 shadow-[0_2px_0_0_rgba(0,0,0,0.06)] sm:max-w-sm">
        <Search className="size-4 shrink-0 text-zinc-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills…"
          className="w-full bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} title="Clear" className="text-zinc-400 hover:text-zinc-700">
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Category chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const active = category === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                active
                  ? "border-transparent bg-zinc-900 text-white"
                  : "border-zinc-900/15 bg-white text-zinc-600 hover:bg-zinc-900/5"
              }`}
            >
              {c}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">No skills match “{query}”{category !== "All" ? ` in ${category}` : ""}.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((s) => {
            const installed = ownedById.has(s.id);
            const wip = isWipClipSkill(s.id);
            const theme = CATEGORY_THEME[categoryForSkill(s.id) ?? ""] ?? DEFAULT_THEME;
            return (
              <div
                key={s.id}
                className={`flex flex-col overflow-hidden rounded-2xl border-2 border-zinc-900/15 bg-white shadow-[0_2px_0_0_rgba(0,0,0,0.06)] transition-transform hover:-translate-y-0.5 ${
                  wip ? "opacity-60" : ""
                }`}
              >
                {/* Category-themed header banner with the skill medallion + tag. */}
                <div
                  className="relative flex items-center gap-2.5 border-b-2 border-zinc-900/10 px-3.5 py-2.5"
                  style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}
                >
                  <SkillMedallion skillId={s.id} emoji={s.icon} dim={wip} />
                  <span className={`text-[14px] font-bold leading-tight ${wip ? "text-zinc-500" : "text-zinc-900"}`}>
                    {s.name}
                  </span>
                  <div className="absolute right-3 top-3 flex items-center gap-1.5">
                    {s.appOnly && (
                      <span
                        title="Installs as an app - unlocks a dedicated tab in the clipper workspace, not a canvas node"
                        className="rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700"
                      >
                        App
                      </span>
                    )}
                    {wip && (
                      <span
                        title="Coming soon - not yet available to install"
                        className="rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700"
                      >
                        WIP
                      </span>
                    )}
                    <span className="rounded-full border border-zinc-900/15 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-zinc-600 backdrop-blur-sm">
                      {s.tag}
                    </span>
                  </div>
                </div>

                {/* Body: description + price + install. Description is clamped to a
                    fixed 2 lines so every card is the same height; the footer sits at
                    the bottom via mt-auto. */}
                <div className="flex flex-1 flex-col p-3.5">
                  <p className={`line-clamp-2 min-h-[2.4rem] text-[13px] leading-snug ${wip ? "text-zinc-400" : "text-zinc-600"}`}>{s.blurb}</p>
                  <div className="mt-auto flex items-center justify-between pt-3">
                    <span className="text-[11px] font-medium text-zinc-500">
                      {priceLabel(s.id) === "Free" ? "Free" : `Free install · ${priceLabel(s.id)}`}
                    </span>
                    {wip ? (
                      <span className="text-[11px] font-medium text-zinc-400">Coming soon</span>
                    ) : installed ? (
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-lime-700">
                          <Check className="size-3.5" />
                          Installed
                        </span>
                        <button
                          type="button"
                          onClick={() => uninstall(s.id)}
                          title="Uninstall"
                          className="text-zinc-400 transition-colors hover:text-red-500"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => install(s.id)}
                        className="inline-flex items-center gap-1.5 rounded-[5px] bg-lime-500 px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_#4d7c0f] transition-[transform,box-shadow] duration-100 hover:brightness-105 active:translate-y-[3px] active:shadow-[0_1px_0_#4d7c0f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 disabled:pointer-events-none disabled:opacity-40 disabled:shadow-[0_4px_0_#4d7c0f]"
                      >
                        <Plus className="size-3.5" />
                        Get
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

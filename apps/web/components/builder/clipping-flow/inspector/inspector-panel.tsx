"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { HookShine } from "@/components/builder/hook-shine";
import { HookFxMini } from "@/components/builder/hook-fx-preview";
import { useClippingStore } from "@/components/builder/clipping-flow/store/clipping-store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Eye, SlidersHorizontal, X, Plus, Upload, Link2, Loader2, Megaphone, PanelRightClose, Play, Pause } from "lucide-react";
import { getContentRewards } from "@/lib/content-rewards";
import { isRestrictedCampaign, isAllowedRestrictedEmail } from "@/lib/restrictedCampaigns";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { nodeVisual } from "@/components/builder/clipping-flow/canvas/node-visual";
import type { VelloNode } from "@/components/builder/clipping-flow/types/clipping";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { CLIP_SKILL_BY_ID } from "@/lib/builder/clipSkillsCatalog";
import { HOOK_FONT_FAMILY, burnFontStack } from "@/lib/builder/burnFonts";
import { isPickableCampaign } from "@/lib/campaignVisibility";
import { CLIP_GENRES } from "@/lib/builder/clipGenres";
import { CAPTION_PRESETS } from "@/lib/builder/captionPresets";
import {
  HOOK_DESIGNS,
  hookHeadlineLines,
  isHookFxLayout,
  DEFAULT_HOOK_DESIGN_ID,
  DEFAULT_HOOK_DURATION_SEC,
  HOOK_DURATION_MIN,
  HOOK_DURATION_MAX,
} from "@/lib/builder/hookDesigns";
import {
  TITLE_CARD_DESIGNS,
  DEFAULT_TITLE_CARD_ID,
  DEFAULT_TITLE_DURATION_SEC,
  TITLE_DURATION_MIN,
  TITLE_DURATION_MAX,
} from "@/lib/builder/titleCardDesigns";
import {
  TRANSITIONS,
  DEFAULT_TRANSITION_ID,
  TRANSITION_DURATION_MIN,
  TRANSITION_DURATION_MAX,
  isWipTransition,
  transitionById,
} from "@/lib/server/transitionsPack";
import { STICKER_STYLES, DEFAULT_STICKER_STYLE_ID, DEFAULT_STICKER_POSITION } from "@/lib/builder/stickerStyles";
import { FILTER_CHIPS } from "@/lib/builder/filterStyles";
import { GAMEPLAY_PACK, RANDOM_GAMEPLAY_ID } from "@/lib/server/gameplayPack";
import { TRENDING_AUDIO } from "@/lib/server/trendingAudioPack";
import { REACTION_SFX_PACKS, DEFAULT_REACTION_SFX_PACK_ID } from "@/lib/server/reactionSfxPack";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SourcePreview } from "@/components/builder/clipping-flow/source-preview";

/**
 * Genre chip row (OpusClip-style "choose genres that fit your content").
 * Single-select; "Let AI detect" = default virality weighting.
 */
function GenrePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CLIP_GENRES.map((g) => {
        const selected = (value || "auto") === g.id;
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onChange(g.id)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              selected
                ? "border-transparent bg-zinc-100 text-zinc-900"
                : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            <span className="leading-none">{g.emoji}</span>
            {g.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Caption preset grid (OpusClip "Quick presets") for the Dynamic Captions
 * skill node. Each card CSS-approximates the burned-in look; the server
 * resolves the picked id to the full ASS render spec.
 */
function CaptionPresetPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {CAPTION_PRESETS.map((p) => {
        const selected = (value || "default") === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            title={p.blurb}
            className={`rounded-lg border p-2 text-left transition-colors ${
              selected ? "border-lime-500 bg-lime-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"
            }`}
          >
            <div
              className="flex h-10 items-center justify-center gap-1 overflow-hidden rounded-md text-[11px] leading-none whitespace-nowrap"
              style={{ background: p.preview.chipBg ?? "#27272a" }}
            >
              <span style={p.preview.base}>TO GET</span>
              <span style={p.preview.active ?? p.preview.base}>STARTED</span>
            </div>
            <div className={`mt-1.5 text-[11px] font-medium ${selected ? "text-lime-300" : "text-zinc-300"}`}>
              {p.name}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Campaign Scout picker - choose which marketplace campaigns the scout
 * considers on each run. None checked = all active campaigns.
 */
function CampaignPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const campaigns = useQuery(api.campaigns.list, {}) as
    | { _id: string; title: string; status?: string; targetNiche?: string[] }[]
    | undefined;
  const active = (campaigns ?? []).filter((cp) => (cp.status ?? "active") === "active");
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        Campaigns to consider {selected.length === 0 ? "(all active)" : `(${selected.length} picked)`}
      </Label>
      {campaigns === undefined ? (
        <div className="text-[11px] text-zinc-500">Loading campaigns…</div>
      ) : active.length === 0 ? (
        <div className="text-[11px] text-zinc-500">No active campaigns in the marketplace right now.</div>
      ) : (
        <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
          {active.map((cp) => (
            <label key={cp._id} className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 hover:bg-white/10">
              <input
                type="checkbox"
                checked={selected.includes(cp._id)}
                onChange={() => toggle(cp._id)}
                className="accent-lime-500"
              />
              <span className="min-w-0 flex-1 truncate">{cp.title}</span>
              {cp.targetNiche?.[0] && <span className="shrink-0 text-[10px] text-zinc-500">{cp.targetNiche[0]}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Source-from-campaign picker (Feature D). Two-level pick: choose a clipping
 * CAMPAIGN, then one of its contentLinks. Picking a link sets sourceUrl +
 * campaignId (and clears any uploaded blob) - campaignId is the provenance tag
 * the canvas reads to mark the transcribe call cacheable (the E caching rule).
 * Campaigns with no contentLinks are hidden; NO status filter (real campaigns
 * are "open", not "active").
 */
/**
 * Pick a source from a campaign. Lists BOTH stores in one dropdown, plus a
 * "- None -" option to clear:
 *  - Stage CLIPPING campaigns (Supabase content_rewards, gdrive "what to clip").
 *    Picking one resolves its gdrive videos via /api/clip/campaign-sources and
 *    seeds the Source with the first video + the full list (RewardVideoPicker
 *    swaps among them) + contentRewardId (Supabase provenance → cache + submit).
 *  - Convex `campaigns` (Clipping/UGC - the Web3 board is gone): a second select
 *    of its contentLinks, labelled by category, tagged campaignId (Convex provenance).
 */
function CampaignSourcePicker({
  currentUrl,
  campaignId,
  contentRewardId,
  clipAll,
  onPickConvex,
  onPickReward,
  onToggleClipAll,
  onClear,
}: {
  currentUrl: string;
  campaignId?: string;
  contentRewardId?: string;
  clipAll?: boolean;
  // collectionUrl (3rd arg): the folder/channel the videos were expanded from —
  // persisted so a "clip all" run can re-expand it. Undefined for a single raw link.
  onPickConvex: (url: string, campaignId: string, collectionUrl?: string) => void;
  onPickReward: (rewardId: string, videos: { url: string; name: string }[], title: string) => void;
  onToggleClipAll?: (on: boolean) => void;
  onClear: () => void;
}) {
  const campaigns = useQuery(api.campaigns.list, {}) as
    | { _id: string; title: string; category?: string; contentRewardId?: string; contentLinks?: string[]; contentFileUrls?: string[]; status?: string; pdaAddress?: string | null; creatorWallet?: string; origin?: string }[]
    | undefined;
  // RESTRICTED campaigns are now SHOWN to every user (labelled 🔒 for non-allowed
  // accounts) but stay LOCKED: selecting one shows a note instead of resolving its
  // sources, so a non-allowed user never triggers the source fetch (the server 403
  // stays as defense-in-depth). The real gate is server-side (source-resolve +
  // submit); this just keeps the raw 403 from surfacing and leaves the source unset.
  const { profile } = useSupabaseAuth();
  const allowedRestricted = isAllowedRestrictedEmail(profile?.email);
  // The viewer's wallets — an owner still sees their own unfunded draft, exactly as
  // on /stage. Unknown viewer ⇒ funded campaigns only, the safe direction.
  const myWallets = useMemo(
    () => new Set(((profile?.walletAddresses ?? []) as string[]).filter(Boolean)),
    [profile?.walletAddresses],
  );
  // A restricted (owner-exclusive) entry a NON-allowed user may SEE but not clip.
  const isLockedEntry = (contentRewardId: string | null | undefined, title: string | null | undefined) =>
    !allowedRestricted && isRestrictedCampaign({ contentRewardId, title });
  // A campaign's clippable sources are its pasted links UNION its uploaded files.
  // An upload-sourced campaign (contentFileUrls set, contentLinks empty) must still
  // appear and be wireable, so key visibility + the per-clip list off BOTH.
  const convexSources = (cp: { contentLinks?: string[]; contentFileUrls?: string[] }) =>
    [...(cp.contentLinks ?? []), ...(cp.contentFileUrls ?? [])];
  // Show what /stage shows — funded, or mine — and nothing terminal. api.campaigns.list
  // is deliberately unfiltered (crons + the oracle read it), so each surface filters;
  // sharing ONE rule is what stops this dropdown from drifting back into listing
  // abandoned drafts the operator sees nowhere else.
  const convexWithLinks = (campaigns ?? [])
    .filter((cp) => convexSources(cp).length > 0)
    .filter((cp) => isPickableCampaign(cp, myWallets));

  // Stage (Supabase content_rewards) CLIPPING campaigns - client-side anon fetch.
  const [stage, setStage] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    getContentRewards()
      .then((rows) => {
        if (!alive) return;
        setStage(
          (rows ?? [])
            .filter((r) => (r.type ?? "").toLowerCase() === "clipping")
            .map((r) => ({ id: r.id, name: r.campaign_name || "Clipping campaign" })),
        );
      })
      .catch(() => { if (alive) setStage([]); });
    return () => { alive = false; };
  }, []);

  const [convexCampId, setConvexCampId] = useState<string>("");
  const [resolving, setResolving] = useState(false);
  // Why the last reward pick wired nothing: "empty" = resolved OK but no clippable
  // URL (bare site / telegram / an unshared Drive folder we can't list); "error" =
  // the resolve fetch itself failed. Either way the campaign shows selected, so we
  // MUST surface it - the old silent collapse to [] read as a dead no-op.
  const [noSource, setNoSource] = useState<null | "empty" | "error">(null);
  // A locked (owner-exclusive) entry a non-allowed user selected: show a friendly
  // note instead of resolving/wiring the source.
  const [lockedNote, setLockedNote] = useState(false);
  // Convex-campaign Drive FOLDER expansion (mirrors PasteUrlSource, but for a
  // campaign's saved link). A picked link that IS a Drive folder is resolved to its
  // member videos HERE, the first is wired via onPickConvex, and a sub-picker lists
  // the rest so the user can switch which file this Source clips. Kept in local state
  // so the node-config shape (and onPickConvex) stay unchanged - a folder is NEVER
  // wired raw (the clip pipeline can't clip a folder URL). `link` is the folder that
  // produced `videos`, gated against `links` so it never bleeds across campaigns.
  const [convexFolder, setConvexFolder] = useState<{ link: string; videos: { url: string; name: string }[] } | null>(null);
  const [folderResolving, setFolderResolving] = useState(false);
  const [folderEmpty, setFolderEmpty] = useState(false);
  const effectiveConvexId = convexCampId || (contentRewardId ? "" : campaignId) || "";
  const chosenConvex = convexWithLinks.find((cp) => cp._id === effectiveConvexId);
  const links = chosenConvex ? convexSources(chosenConvex) : [];

  const selected =
    contentRewardId ? `r:${contentRewardId}` :
    effectiveConvexId ? `c:${effectiveConvexId}` : "";

  const pickReward = async (rewardId: string, title: string) => {
    setResolving(true);
    setNoSource(null);
    try {
      const res = await fetch(`/api/clip/campaign-sources?rewardId=${encodeURIComponent(rewardId)}`);
      if (!res.ok) {
        // A fetch/auth failure - NOT an empty campaign. Distinguish it so the user
        // isn't told "no source" when the resolve itself broke. Keep the
        // contentRewardId (provenance/auto-submit) so a manual URL still pays out.
        setNoSource("error");
        onPickReward(rewardId, [], title);
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { videos?: { url: string; name: string }[]; title?: string };
      const videos = Array.isArray(j.videos) ? j.videos : [];
      if (videos.length === 0) {
        // Resolved OK but no clippable URL (bare site / telegram / an unshared Drive
        // folder). Do NOT silently pretend it wired: keep the contentRewardId set
        // (provenance still fires on auto-submit) and tell the user nothing was
        // auto-wired so they can fix the Drive share or paste a URL by hand.
        setNoSource("empty");
        onPickReward(rewardId, [], j.title || title);
        return;
      }
      onPickReward(rewardId, videos, j.title || title);
    } catch {
      setNoSource("error");
      onPickReward(rewardId, [], title);
    } finally {
      setResolving(false);
    }
  };

  // Resolve a Drive FOLDER or YouTube CHANNEL/PLAYLIST campaign link → its member
  // videos (the SAME route the Paste-URL pill uses; the channel walk runs SERVER-side
  // there, never yt-dlp in the browser), wire the FIRST via onPickConvex, and stash
  // the list for the sub-picker. 0 videos (unshared / no Drive key / empty channel /
  // unreachable) → the amber hint, nothing wired. Only called for `looksExpandableSource`.
  const expandConvexFolder = async (folderUrl: string, campId: string) => {
    setFolderResolving(true);
    setFolderEmpty(false);
    setConvexFolder(null);
    try {
      const res = await fetch(`/api/clip/resolve-source-url?url=${encodeURIComponent(folderUrl.trim())}`);
      if (!res.ok) { setFolderEmpty(true); return; }
      const j = (await res.json().catch(() => ({}))) as {
        videos?: { url: string; name: string }[];
        isFolder?: boolean;
      };
      const videos = Array.isArray(j.videos) ? j.videos : [];
      const first = videos[0];
      if (first) {
        setConvexFolder({ link: folderUrl, videos });
        // Persist the collection url (folderUrl) so a "clip all" run can re-expand it.
        onPickConvex(first.url, campId, folderUrl);
      } else {
        // Reachable-but-empty OR a resolve failure: either way nothing is clippable,
        // so leave the Source unwired and surface the amber "share it / paste a file".
        setFolderEmpty(true);
      }
    } catch {
      setFolderEmpty(true);
    } finally {
      setFolderResolving(false);
    }
  };

  if (campaigns === undefined || stage === null) {
    return <div className="text-[11px] text-zinc-500">Loading campaigns…</div>;
  }
  if (convexWithLinks.length === 0 && stage.length === 0) {
    return <div className="text-[11px] text-zinc-500">No campaigns available yet.</div>;
  }
  return (
    <div className="space-y-2">
      <NativeSelect
        value={selected}
        onChange={(v) => {
          setNoSource(null);
          setLockedNote(false);
          setConvexFolder(null);
          setFolderEmpty(false);
          if (!v) { setConvexCampId(""); onClear(); return; }
          if (v.startsWith("r:")) {
            const id = v.slice(2);
            const name = stage.find((s) => s.id === id)?.name ?? "";
            setConvexCampId("");
            if (isLockedEntry(id, name)) {
              // Owner-exclusive campaign, non-allowed user: DON'T resolve sources
              // (the server 403s anyway). Show a note and leave the source unset.
              onClear();
              setLockedNote(true);
              return;
            }
            pickReward(id, name);
          } else if (v.startsWith("c:")) {
            const id = v.slice(2);
            const cp = convexWithLinks.find((x) => x._id === id);
            if (cp && isLockedEntry(cp.contentRewardId ?? null, cp.title)) {
              setConvexCampId("");
              onClear();
              setLockedNote(true);
              return;
            }
            setConvexCampId(id);
            // One source → wire it immediately (no pointless second pick). Multiple →
            // keep the second dropdown; a hint tells the user to pick a clip below.
            const only = cp ? convexSources(cp) : [];
            const lone = only.length === 1 ? only[0] : undefined;
            if (lone) {
              // A lone Drive FOLDER or YouTube CHANNEL/PLAYLIST expands to its member
              // videos instead of wiring the raw collection URL (which the pipeline
              // can't clip — a channel URL would hit the 290s audio-pull timeout).
              if (looksExpandableSource(lone)) void expandConvexFolder(lone, id);
              else onPickConvex(lone, id);
            }
          }
        }}
        options={[
          { value: "", label: "- None -" },
          ...stage.map((r) => ({
            value: `r:${r.id}`,
            label: `${isLockedEntry(r.id, r.name) ? "🔒 " : ""}Clipping · ${r.name}`,
          })),
          ...convexWithLinks.map((cp) => {
            // Web3 board removed: campaigns are normalized to "ugc"/"clipping"
            // (legacy "web3"/absent → "clipping"). Label by the real category so
            // the picker never surfaces the sunset "Web3 ·" tag again.
            const cat = (cp.category ?? "").toLowerCase() === "ugc" ? "UGC" : "Clipping";
            return {
              value: `c:${cp._id}`,
              label: `${isLockedEntry(cp.contentRewardId ?? null, cp.title) ? "🔒 " : ""}${cat} · ${cp.title} (${convexSources(cp).length})`,
            };
          }),
        ]}
      />
      {resolving && <div className="text-[11px] text-zinc-500">Loading campaign clips…</div>}
      {!resolving && noSource === "empty" && (
        <p className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300/80">
          This campaign has no clippable source yet - make sure its Google Drive link is
          shared &ldquo;anyone with the link&rdquo;, or paste a source URL manually from the
          Paste&nbsp;URL pill above. It stays linked so the reward still pays out.
        </p>
      )}
      {!resolving && noSource === "error" && (
        <p className="rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-red-300/80">
          Couldn&apos;t load this campaign&apos;s clips just now - try again in a moment, or
          paste a source URL manually from the Paste&nbsp;URL pill above. It stays linked so
          the reward still pays out.
        </p>
      )}
      {!resolving && lockedNote && (
        <p className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300/80">
          🔒 This campaign is exclusive to its owner - you can&apos;t clip it. You can still
          view it on the Stage board.
        </p>
      )}
      {!contentRewardId && effectiveConvexId && links.length > 1 && !links.includes(currentUrl) && !convexFolder && (
        <p className="text-[11px] text-zinc-500">Now pick a clip below.</p>
      )}
      {!contentRewardId && effectiveConvexId && links.length > 0 && (
        <>
          <NativeSelect
            value={convexFolder && links.includes(convexFolder.link) ? convexFolder.link : (links.includes(currentUrl) ? currentUrl : "")}
            onChange={(v) => {
              if (!v) return;
              setFolderEmpty(false);
              setConvexFolder(null);
              // A Drive FOLDER or YouTube CHANNEL/PLAYLIST expands to its member videos
              // (never wire the raw collection — the pipeline can't clip a folder, and a
              // channel URL would hit the 290s audio-pull timeout). Anything else wires raw.
              if (looksExpandableSource(v)) void expandConvexFolder(v, effectiveConvexId);
              else onPickConvex(v, effectiveConvexId);
            }}
            options={[
              { value: "", label: "Pick a link from this campaign…" },
              ...links.map((link, i) => ({
                value: link,
                label: `${looksLikeDriveFolder(link) ? "📁 " : looksLikeYoutubeChannel(link) ? "🎬 " : ""}#${i + 1} · ${link.length > 42 ? link.slice(0, 42) + "…" : link}`,
              })),
            ]}
          />
          {folderResolving && <div className="text-[11px] text-zinc-500">Listing videos…</div>}
          {!folderResolving && folderEmpty && (
            <p className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300/80">
              This source has no clippable video, a Drive folder must be shared &ldquo;anyone
              with the link&rdquo; and a YouTube channel/playlist must be public, or paste a
              single video link instead.
            </p>
          )}
          {convexFolder && links.includes(convexFolder.link) && convexFolder.videos.length > 0 && (
            <>
              <Row label={`Folder videos (${convexFolder.videos.length})`}>
                <RewardVideoPicker
                  currentUrl={currentUrl}
                  videos={convexFolder.videos}
                  // Pass the collection url so swapping a member keeps sourceCollectionUrl
                  // (a "clip all" opt-in must survive a member swap).
                  onPick={(url) => onPickConvex(url, effectiveConvexId, convexFolder.link)}
                />
              </Row>
              {convexFolder.videos.length > 1 && onToggleClipAll && (
                <ClipAllToggle
                  count={convexFolder.videos.length}
                  enabled={clipAll === true}
                  onToggle={onToggleClipAll}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Stage content-reward swap-picker: when a Source node was seeded from a Supabase
 * content_reward (rewardVideos stashed on its config), list every resolved folder
 * video by name and let the user swap which one this Source clips. The
 * contentRewardId stays untouched (the caller keeps it) so the swapped URL still
 * caches + auto-submits to the same Stage campaign. Mirrors CampaignSourcePicker.
 */
function RewardVideoPicker({
  currentUrl,
  videos,
  onPick,
}: {
  currentUrl: string;
  videos: { url: string; name: string }[];
  onPick: (url: string) => void;
}) {
  return (
    <NativeSelect
      value={videos.some((v) => v.url === currentUrl) ? currentUrl : ""}
      onChange={(v) => {
        if (v) onPick(v);
      }}
      options={[
        { value: "", label: "Pick a clip from this campaign…" },
        ...videos.map((v, i) => ({
          value: v.url,
          label: `#${i + 1} · ${v.name.length > 42 ? v.name.slice(0, 42) + "…" : v.name}`,
        })),
      ]}
    />
  );
}

/**
 * Master Videos "clip all" toggle (#4a). Shown under a folder/channel sub-picker so
 * the operator can opt into clipping EVERY member video (one job each, capped) instead
 * of only the picked top one. Flips the Source node's `clipAll` flag; the cloud run then
 * sends the collection url + clipAll:true so run-task re-expands and fans out.
 */
function ClipAllToggle({
  count,
  enabled,
  onToggle,
}: {
  count: number;
  enabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-lime-500/20 bg-lime-500/[0.07] px-2.5 py-2">
      <div className="min-w-0">
        <Label className="text-[11px] font-medium text-lime-200">Clip all {count} videos</Label>
        <p className="text-[10px] leading-snug text-zinc-400">
          One clip run per video (capped). Off = just the top pick.
        </p>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}

/** True for a Google Drive FOLDER link. */
function looksLikeDriveFolder(u: string): boolean {
  return /drive\.google\.com/i.test(u) && /\/folders\//i.test(u);
}

/** True for a YouTube CHANNEL or PLAYLIST link (an expandable collection), NOT a
 *  single video. Pure client regex — the actual channel walk runs SERVER-SIDE via
 *  /api/clip/resolve-source-url (never yt-dlp in the browser). Mirrors the server's
 *  classifyYoutubeUrl channel/playlist shapes. A single watch?v=/youtu.be/shorts
 *  link is intentionally NOT matched — it stays a single source. */
function looksLikeYoutubeChannel(u: string): boolean {
  if (!/(?:^|\/\/|\.)(?:youtube\.com|youtu\.be)\//i.test(u)) return false;
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "youtu.be") return false; // youtu.be/<id> is always a single video
    const path = url.pathname.replace(/\/+$/, "");
    if (/^\/(shorts|embed|v|live)\//i.test(path)) return false;
    if (path === "/watch") return !url.searchParams.get("v") && !!url.searchParams.get("list");
    if (path === "/playlist") return !!url.searchParams.get("list");
    if (/^\/(@[\w.-]+|channel\/[\w-]+|user\/[\w.-]+|c\/[\w.-]+)/i.test(path)) return true;
    return !!url.searchParams.get("list");
  } catch {
    return false;
  }
}

/** True for any link the Source picker should expand via a resolve round-trip into
 *  a sub-picker of member videos — a Drive FOLDER or a YouTube CHANNEL/PLAYLIST.
 *  Everything else (single video / Drive file / .mp4) stays a single source with no
 *  server call, keeping the Paste-URL pill instant & cheap. */
function looksExpandableSource(u: string): boolean {
  return looksLikeDriveFolder(u) || looksLikeYoutubeChannel(u);
}

/**
 * Paste-URL source pill. For a normal link (YouTube/TikTok/.mp4/single Drive file)
 * this is just today's URL box - typing sets sourceUrl live, no server round-trip.
 * The ONE addition: when the pasted URL is a Google Drive FOLDER, it calls
 * /api/clip/resolve-source-url, seeds the Source with the folder's FIRST video, and
 * shows a compact picker (RewardVideoPicker) listing every file so the user can
 * switch which one this Source clips - exactly like the Campaign pill's folder
 * expansion, but for a manually pasted link (no campaign provenance).
 *
 * The resolve only fires for Drive /folders/ links, and only on paste/blur (never
 * per-keystroke), so normal pasting never touches the network. `key={node.id}` on
 * the caller resets the local typed/resolve state when a different node is selected.
 */
function PasteUrlSource({
  url,
  folderVideos,
  clipAll,
  onChangeUrl,
  onExpandFolder,
  onPickFolderVideo,
  onToggleClipAll,
}: {
  url: string;
  folderVideos: { url: string; name: string }[] | undefined;
  clipAll?: boolean;
  /** A fresh manually-typed URL: single user source, clears any prior folder list. */
  onChangeUrl: (url: string) => void;
  /** A pasted Drive FOLDER/YouTube collection resolved to N videos: seed the first +
   *  stash the list, and persist the collectionUrl for a "clip all" run to re-expand. */
  onExpandFolder: (videos: { url: string; name: string }[], collectionUrl: string) => void;
  /** Swap which folder video this Source clips (keeps the stashed list). */
  onPickFolderVideo: (url: string) => void;
  /** Toggle the Master Videos "clip all member videos" opt-in. */
  onToggleClipAll?: (on: boolean) => void;
}) {
  // Local text so the pasted FOLDER url stays visible in the box even after we seed
  // sourceUrl to the first FILE (url prop flips to the file; typed keeps the folder).
  const [typed, setTyped] = useState<string>(url);
  const [resolving, setResolving] = useState(false);
  const [emptyFolder, setEmptyFolder] = useState(false);
  // Dedupe: paste + the following blur must not resolve the same folder URL twice.
  const lastResolved = useRef<string>("");

  const resolveFolder = async (raw: string) => {
    const trimmed = raw.trim();
    // Drive FOLDER or YouTube CHANNEL/PLAYLIST → expand server-side; anything else
    // (single video / Drive file / .mp4) stays a single source, no round-trip.
    if (!looksExpandableSource(trimmed)) return;
    if (trimmed === lastResolved.current) return; // already resolved this exact URL
    setResolving(true);
    setEmptyFolder(false);
    try {
      const res = await fetch(`/api/clip/resolve-source-url?url=${encodeURIComponent(trimmed)}`);
      if (!res.ok) return; // resolve failed → leave it as a single source, no scary error
      const j = (await res.json().catch(() => ({}))) as {
        videos?: { url: string; name: string }[];
        isFolder?: boolean;
      };
      const videos = Array.isArray(j.videos) ? j.videos : [];
      if (j.isFolder && videos.length > 0) {
        lastResolved.current = trimmed;
        // trimmed IS the collection url (Drive folder / YouTube channel-playlist).
        onExpandFolder(videos, trimmed);
      } else if (j.isFolder) {
        // A collection we could reach but couldn't list (private folder / empty or
        // blocked channel) — surface the amber hint, keep the box a single source.
        lastResolved.current = trimmed;
        setEmptyFolder(true);
      }
    } catch {
      /* network hiccup - keep today's single-source behavior */
    } finally {
      setResolving(false);
    }
  };

  return (
    <>
      <p className="text-[10.5px] leading-relaxed text-zinc-500">
        Paste a video link, YouTube video, TikTok, a direct .mp4, or a Google Drive
        file/folder. A YouTube channel or playlist expands to its top videos. Transcribed,
        then deleted, only the clips are kept.
      </p>
      <Input
        value={typed}
        onChange={(e) => {
          const v = e.target.value;
          setTyped(v);
          setEmptyFolder(false);
          onChangeUrl(v);
        }}
        onBlur={() => void resolveFolder(typed)}
        onPaste={(e) => {
          // Paste of a Drive folder / YouTube channel link resolves immediately (the
          // natural onChange sets sourceUrl first; the async expand then wins by seeding
          // the first member video).
          const t = e.clipboardData.getData("text").trim();
          if (t && looksExpandableSource(t)) void resolveFolder(t);
        }}
        placeholder="https://youtube.com/… .mp4, a Drive folder, or a YouTube channel"
      />
      {resolving && <div className="text-[11px] text-zinc-500">Listing videos…</div>}
      {!resolving && emptyFolder && (
        <p className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300/80">
          No clippable videos here, a Drive folder must be shared &ldquo;anyone with the
          link&rdquo;, and a YouTube channel/playlist must be public. Or paste a single video
          link instead.
        </p>
      )}
      {folderVideos && folderVideos.length > 0 && (
        <>
          <Row label={`Folder videos (${folderVideos.length})`}>
            <RewardVideoPicker currentUrl={url} videos={folderVideos} onPick={onPickFolderVideo} />
          </Row>
          {folderVideos.length > 1 && onToggleClipAll && (
            <ClipAllToggle
              count={folderVideos.length}
              enabled={clipAll === true}
              onToggle={onToggleClipAll}
            />
          )}
        </>
      )}
    </>
  );
}

/**
 * Brain Rot config (clip.brainrot, Feature B): pick a composite layout and one
 * of the bundled gameplay backgrounds. Persists bgLayout + bgId onto the
 * MarketplaceSkillConfig; the catalog floor turns these into a composite_bg op.
 */
function BrainRotConfig({
  bgId,
  onBg,
}: {
  bgId: string;
  onBg: (id: string) => void;
}) {
  // Vertical split only (clip on top, gameplay below) - no layout choice.
  return (
    <Row label="Gameplay background">
      <NativeSelect
        value={bgId}
        onChange={(v) => onBg(v)}
        options={[
          { value: "random", label: "🎲 Random - different loop per clip" },
          ...GAMEPLAY_PACK.map((g) => ({ value: g.id, label: g.label })),
        ]}
      />
    </Row>
  );
}

/**
 * Video Call To Action config (clip.cta): upload a clip that's appended to the END
 * of every produced clip. Persists ctaUrl + ctaStorageId onto the node's config;
 * compile-graph lifts ctaUrl into clipConfig.ctaVideo, and the render (clip-batch-
 * start → lib/server/ctaAppend) concatenates it onto the finished clip. Unlike the
 * Source UploadDropzone this upload PERSISTS (it runs on every future clip).
 */
/**
 * Transitions config (clip.transitions): pick the seam transition style + its
 * duration. Persists transitionId + transitionDurationSec onto the node config;
 * compile-graph lifts them into clipConfig.transition, and the ffmpeg seams
 * (clipFilterGraph title join, ctaAppend CTA join, concat multi-clip stitch) apply
 * the matching xfade. Premium/asset styles show but are disabled until hosted.
 */
// ── Skill description markdown → clean JSX (bold **…**, `code`, # headings, - bullets)
//    so the inspector reads as professional formatted text, not raw asterisks. ──────
function renderMdInline(text: string, keyBase: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={`${keyBase}-b${k++}`} className="font-semibold text-zinc-200">{tok.slice(2, -2)}</strong>);
    else parts.push(<code key={`${keyBase}-c${k++}`} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[10px] text-zinc-200">{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function SkillMarkdown({ md }: { md: string }) {
  const lines = md.split("\n");
  const blocks: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];
  let k = 0;
  const flush = () => {
    if (bullets.length) { blocks.push(<ul key={`ul${k++}`} className="ml-3.5 list-disc space-y-1 marker:text-zinc-600">{bullets}</ul>); bullets = []; }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("# ")) { flush(); blocks.push(<div key={`h${k++}`} className="text-[12.5px] font-bold text-zinc-100">{renderMdInline(line.slice(2), `h${k}`)}</div>); continue; }
    if (line.startsWith("- ")) { bullets.push(<li key={`li${k++}`} className="leading-relaxed">{renderMdInline(line.slice(2), `li${k}`)}</li>); continue; }
    flush();
    blocks.push(<p key={`p${k++}`} className="leading-relaxed">{renderMdInline(line, `p${k}`)}</p>);
  }
  flush();
  return <div className="space-y-2 rounded-md border border-white/10 bg-white/5 p-3 text-[11.5px] text-zinc-400">{blocks}</div>;
}

// ── Music volume: an intuitive 0–100% slider mapped to the render's gainDb ──────
// 0% = silent, 100% = loudest (0 dB, the track's native level — no distortion).
// FIXED: this used to be a straight linear-amplitude→dB mapping (20*log10(pct/100)),
// which put 10% at only -20dB and 50% at just -6dB — both still clearly audible
// under a voiceover, not the "quiet bed" the percentage implied. The low end of a
// 0-100 loudness slider needs to fall off much faster than that for it to READ as
// quiet. Now the percentage is squared before the dB conversion (pct=20 -> effective
// 4%), which keeps the same two anchors (0% silent, 100% = full native 0dB) but makes
// the bottom half of the slider drop off steeply: 10% ~ -40dB (essentially inaudible),
// 20% ~ -28dB (quiet bed), 50% ~ -12dB (still clearly subordinate to speech).
const MUSIC_MUTE_DB = -60;
function musicPctToGainDb(pct: number): number {
  const p = Math.max(0, Math.min(100, pct));
  if (p <= 0) return MUSIC_MUTE_DB;
  const effectivePct = (p * p) / 100; // quadratic taper, steep at the low end, unchanged at 0/100
  return Math.max(-40, Math.round(20 * Math.log10(effectivePct / 100) * 10) / 10);
}
function musicGainDbToPct(db: number): number {
  if (db <= -55) return 0;
  const effectivePct = 100 * Math.pow(10, db / 20);
  return Math.max(0, Math.min(100, Math.round(Math.sqrt(effectivePct * 100))));
}
// Default bed level when the operator hasn't touched the slider — a quiet bed under
// speech (~20% on the new curve), not the old 50%-loud default. Must match the
// catalog floor's default so display == render.
const DEFAULT_MUSIC_GAIN_DB = -28;

function TransitionsConfig({
  transitionId,
  duration,
  onTransition,
  onDuration,
}: {
  transitionId: string;
  duration: number;
  onTransition: (id: string) => void;
  onDuration: (v: number) => void;
}) {
  const active = transitionById(transitionId) ?? TRANSITIONS[0];
  return (
    <>
      <Row label="Transition style">
        <div className="grid grid-cols-2 gap-1.5">
          {TRANSITIONS.map((t) => {
            const wip = isWipTransition(t.id);
            const selected = (transitionId || DEFAULT_TRANSITION_ID) === t.id;
            return (
              <button
                key={t.id}
                type="button"
                disabled={wip}
                onClick={() => { if (!wip) onTransition(t.id); }}
                title={t.blurb}
                className={`flex flex-col gap-0.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                  wip ? "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-60"
                    : selected ? "border-lime-500 bg-lime-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-[13px] leading-none">{t.icon}</span>
                  <span className={`text-[11px] font-medium ${selected ? "text-lime-300" : "text-zinc-300"}`}>{t.name}</span>
                </span>
                {wip && <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-300/80">Coming soon</span>}
              </button>
            );
          })}
        </div>
      </Row>
      <Row label={`Transition length · ${duration.toFixed(2)}s`}>
        <Slider
          value={duration}
          min={TRANSITION_DURATION_MIN}
          max={TRANSITION_DURATION_MAX}
          step={0.05}
          onValueChange={(v) => onDuration((Array.isArray(v) ? v[0] : v) as number)}
        />
      </Row>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Applied at the clip&apos;s seams, the title slate into the video, the video into your CTA,
        and between stitched clips, so nothing hard-cuts.
        <span className="text-zinc-300"> {active.name}</span> - {active.blurb}
      </p>
    </>
  );
}


/**
 * Video POOL config (clip.hookvideos / clip.maincontent): upload SEVERAL videos and
 * keep them on the node. compile-graph lifts `videoUrls` into clipConfig.hookVideos
 * / .mainVideos (and `mainOnly` into clipConfig.mainOnly), and the batch render
 * picks one per clip — best transcript match, cycling until transcripts are warm.
 */
function VideoPoolConfig({
  label,
  hint,
  urls,
  onChange,
  bypass,
}: {
  label: string;
  hint: string;
  urls: string[];
  onChange: (next: string[]) => void;
  /** Main Content only: the "No clip / UGC needed" switch + its current value. */
  bypass?: { enabled: boolean; onToggle: (v: boolean) => void };
}) {
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const MAX_POOL_BYTES = 500 * 1024 * 1024; // 500MB each, a body video can be long

  const handleFiles = async (files: File[]) => {
    setError(null);
    const videos = files.filter((f) => f.type.startsWith("video/"));
    if (!videos.length) { setError("Pick video files (.mp4/.mov/.webm)."); return; }
    const tooBig = videos.find((f) => f.size > MAX_POOL_BYTES);
    if (tooBig) { setError(`${tooBig.name} is ${(tooBig.size / 1048576).toFixed(0)}MB, keep each under 500MB.`); return; }
    setBusy(true);
    try {
      const added: string[] = [];
      // Sequential — a parallel burst of large uploads stalls the tab and gives the
      // operator no progress signal.
      for (const file of videos) {
        const uploadUrl = await generateUploadUrl({});
        const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        if (!res.ok) throw new Error(`upload failed (${res.status})`);
        const { storageId } = (await res.json()) as { storageId: string };
        const publicUrl = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
        if (publicUrl) added.push(publicUrl);
      }
      if (added.length) onChange([...urls, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row label={label}>
      <div className="space-y-2">
        {bypass && (
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-white/10 bg-white/5 p-2.5">
            <input
              type="checkbox"
              checked={bypass.enabled}
              disabled={urls.length === 0}
              onChange={(e) => bypass.onToggle(e.target.checked)}
              className="mt-0.5 size-3.5 accent-lime-500"
            />
            <span>
              <span className="block text-[11.5px] font-medium text-zinc-200">No clip / UGC needed</span>
              <span className="block text-[10.5px] leading-relaxed text-zinc-500">
                Post these uploads as the content instead of cutting the source. A hook video still plays in front,
                and captions, filters and the CTA still apply.
                {urls.length === 0 && " Upload a video to enable this."}
              </span>
            </span>
          </label>
        )}
        {urls.map((url, i) => (
          <div key={url} className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 p-1.5">
            <video src={url} className="h-12 w-20 shrink-0 rounded bg-black object-cover" muted playsInline />
            <span className="flex-1 truncate text-[11px] text-zinc-400">Video {i + 1}</span>
            <button
              type="button"
              onClick={() => onChange(urls.filter((u) => u !== url))}
              aria-label={`Remove video ${i + 1}`}
              className="rounded p-1 text-red-300 transition-colors hover:bg-red-500/10"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-3 py-4 text-center transition-colors hover:border-white/30 hover:bg-white/[0.06]">
          {busy ? (
            <>
              <Loader2 className="size-5 animate-spin text-lime-400" />
              <span className="text-xs text-zinc-300">Uploading…</span>
            </>
          ) : (
            <>
              <Upload className="size-5 text-zinc-400" />
              <span className="text-xs text-zinc-300">{urls.length ? "Add more videos" : "Upload videos"}</span>
              <span className="text-[10.5px] text-zinc-500">{hint}</span>
            </>
          )}
          <input type="file" accept="video/*" multiple className="hidden" disabled={busy}
            onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void handleFiles(f); }} />
        </label>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>
    </Row>
  );
}

function CtaVideoConfig({
  ctaUrl,
  onUpload,
  onRemove,
}: {
  ctaUrl?: string;
  onUpload: (url: string, storageId: string) => void;
  onRemove: () => void;
}) {
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const MAX_CTA_BYTES = 200 * 1024 * 1024; // 200MB, a CTA is short

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("video/")) { setError("Pick a video file (.mp4/.mov/.webm)."); return; }
    if (file.size > MAX_CTA_BYTES) { setError(`Video is ${(file.size / 1048576).toFixed(0)}MB, keep the CTA under 200MB.`); return; }
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const publicUrl = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
      if (!publicUrl) throw new Error("could not resolve uploaded video");
      onUpload(publicUrl, storageId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row label="Call-to-action clip">
      <div className="space-y-2">
        {ctaUrl ? (
          <>
            <video src={ctaUrl} controls playsInline className="max-h-40 w-full rounded-lg bg-black" />
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-white/10">
                {busy ? <Loader2 className="size-3.5 animate-spin text-lime-400" /> : <Upload className="size-3.5" />}
                {busy ? "Uploading…" : "Replace"}
                <input type="file" accept="video/*" className="hidden" disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
              </label>
              <button type="button" onClick={onRemove} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50">
                <Trash2 className="size-3.5" /> Remove
              </button>
            </div>
          </>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-3 py-5 text-center transition-colors hover:border-white/30 hover:bg-white/[0.06]">
            {busy ? (
              <>
                <Loader2 className="size-5 animate-spin text-lime-400" />
                <span className="text-xs text-zinc-300">Uploading…</span>
              </>
            ) : (
              <>
                <Upload className="size-5 text-zinc-400" />
                <span className="text-xs text-zinc-300">Upload the CTA clip</span>
                <span className="text-[10.5px] text-zinc-500">Appended to the end of every clip · up to 200MB</span>
              </>
            )}
            <input type="file" accept="video/*" className="hidden" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
          </label>
        )}
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>
    </Row>
  );
}

/** Upload-your-own-MP3 control for clip.trendingaudio — mirrors CtaVideoConfig's
 *  single-file upload flow (same Convex storage mutations), swapped to audio.
 *  When a track is uploaded it wins over the curated pack / auto-pick in the
 *  clip.trendingaudio floor (lib/builder/clipSkillsCatalog.ts); the existing
 *  volume slider still applies via the skill-agnostic gainDb field. */
function TrendingAudioUploadConfig({
  audioUrl,
  onUpload,
  onRemove,
}: {
  audioUrl?: string;
  onUpload: (url: string, storageId: string) => void;
  onRemove: () => void;
}) {
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const MAX_AUDIO_BYTES = 40 * 1024 * 1024; // 40MB, plenty for one MP3 track

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("audio/") && !/\.mp3$/i.test(file.name)) { setError("Pick an audio file (.mp3/.m4a/.wav)."); return; }
    if (file.size > MAX_AUDIO_BYTES) { setError(`File is ${(file.size / 1048576).toFixed(0)}MB, keep the track under 40MB.`); return; }
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "audio/mpeg" }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const publicUrl = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
      if (!publicUrl) throw new Error("could not resolve uploaded track");
      onUpload(publicUrl, storageId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row label="Or use your own song">
      <div className="space-y-2">
        {audioUrl ? (
          <>
            <audio src={audioUrl} controls className="w-full" />
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-white/10">
                {busy ? <Loader2 className="size-3.5 animate-spin text-lime-400" /> : <Upload className="size-3.5" />}
                {busy ? "Uploading…" : "Replace"}
                <input type="file" accept="audio/*,.mp3" className="hidden" disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
              </label>
              <button type="button" onClick={onRemove} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50">
                <Trash2 className="size-3.5" /> Remove
              </button>
            </div>
          </>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-3 py-5 text-center transition-colors hover:border-white/30 hover:bg-white/[0.06]">
            {busy ? (
              <>
                <Loader2 className="size-5 animate-spin text-lime-400" />
                <span className="text-xs text-zinc-300">Uploading…</span>
              </>
            ) : (
              <>
                <Upload className="size-5 text-zinc-400" />
                <span className="text-xs text-zinc-300">Upload an MP3</span>
                <span className="text-[10.5px] text-zinc-500">Plays instead of the curated pack · up to 40MB</span>
              </>
            )}
            <input type="file" accept="audio/*,.mp3" className="hidden" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
          </label>
        )}
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>
    </Row>
  );
}

/** Curated-track picker for clip.trendingaudio, grouped by folder (e.g. the
 *  "Podcast" bucket in the Supabase trending-audio/podcast/ subfolder) with a
 *  play/pause preview button per track — one shared <audio> element so picking
 *  a new preview stops whatever was already playing instead of overlapping. */
function TrendingAudioPicker({ activeId, onSelect }: { activeId: string; onSelect: (id: string | null) => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const togglePreview = (t: { id: string; url: string; label: string }) => {
    const audio = audioRef.current;
    if (!audio || !t.url) return;
    if (previewing === t.id) {
      audio.pause();
      setPreviewing(null);
      return;
    }
    audio.src = t.url;
    audio.currentTime = 0;
    void audio.play().catch(() => setPreviewing(null));
    setPreviewing(t.id);
  };

  // Folder groups first (Podcast, …), then the ungrouped root pack under "More sounds".
  const groups = useMemo(() => {
    const byFolder = new Map<string, typeof TRENDING_AUDIO>();
    const root: typeof TRENDING_AUDIO = [];
    for (const t of TRENDING_AUDIO) {
      if (t.folder) {
        const arr = byFolder.get(t.folder) ?? [];
        arr.push(t);
        byFolder.set(t.folder, arr);
      } else {
        root.push(t);
      }
    }
    const out: { label: string | null; tracks: typeof TRENDING_AUDIO }[] = [];
    for (const [folder, tracks] of byFolder) {
      out.push({ label: folder.charAt(0).toUpperCase() + folder.slice(1), tracks });
    }
    if (root.length) out.push({ label: out.length ? "More sounds" : null, tracks: root });
    return out;
  }, []);

  return (
    <div className="space-y-3">
      { }
      <audio ref={audioRef} onEnded={() => setPreviewing(null)} className="hidden" />
      {groups.map((g) => (
        <div key={g.label ?? "root"}>
          {g.label && <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{g.label}</p>}
          <div className="grid grid-cols-2 gap-1.5">
            {g.tracks.map((t) => {
              const activeT = activeId === t.id;
              const isPreviewing = previewing === t.id;
              return (
                <div
                  key={t.id}
                  className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1.5 text-[11px] font-medium transition-colors ${activeT ? "border-lime-500 bg-lime-500/20 text-lime-200" : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20"}`}
                >
                  <button
                    type="button"
                    onClick={() => togglePreview(t)}
                    disabled={!t.url}
                    aria-label={isPreviewing ? `Pause ${t.label}` : `Play ${t.label}`}
                    title={t.url ? (isPreviewing ? "Pause preview" : "Play preview") : "Track unavailable"}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-current transition-colors hover:bg-white/20 disabled:opacity-40"
                  >
                    {isPreviewing ? <Pause className="size-2.5" /> : <Play className="size-2.5 translate-x-px" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelect(activeT ? null : t.id)}
                    className="min-w-0 flex-1 truncate text-left"
                    title={t.label}
                  >
                    {t.label}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Auto Hook config (clip.hook): how long the hook line shows + its text design,
 * with a live preview chip per template. Persists hookDurationSec + hookTemplateId
 * onto the MarketplaceSkillConfig; the catalog floor + clipEditPlanner.applyHookStyle
 * burn them onto the clip's opening overlay. Each chip CSS-approximates the
 * burned-in look (one source of truth with the render params in lib/builder/hookDesigns).
 */
type HookCustom = { fontColor?: string; fontSize?: number; yPct?: number; position?: "top" | "center" | "bottom"; boxColor?: string | null; allCaps?: boolean };

function HookOverlayConfig({
  prompt,
  duration,
  alwaysOn,
  templateId,
  position,
  custom,
  onPrompt,
  onDuration,
  onAlwaysOn,
  onTemplate,
  onPosition,
  onCustom,
}: {
  prompt: string;
  duration: number;
  alwaysOn: boolean;
  onAlwaysOn: (v: boolean) => void;
  templateId: string;
  position?: "top" | "center" | "bottom";
  custom: HookCustom | null;
  onPrompt: (v: string) => void;
  onDuration: (v: number) => void;
  onTemplate: (id: string) => void;
  onPosition: (p: "top" | "center" | "bottom") => void;
  onCustom: (d: HookCustom | null) => void;
}) {
  const active = HOOK_DESIGNS.find((d) => d.id === templateId) ?? HOOK_DESIGNS[0];
  // The position dropdown drives the preview: EVERY chip shows the hook at the same
  // chosen spot (top/center/bottom) so the previews aren't a random mix, and they
  // match what actually burns into the video. Falls back to the design's own spot
  // until the operator picks one.
  const effPos = position ?? active.render.position;
  return (
    <>
      <Row label="Hook idea (optional)">
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          placeholder={'What should the hook say? e.g. "tease the surprising result" · "call out the biggest mistake" · "ask a bold question"'}
          rows={3}
          className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-lime-500"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          The AI writes a short line from this idea and overlays it ON the video. Leave empty to auto-write from the clip.
        </p>
      </Row>
      <Row label={alwaysOn ? "Hook duration · whole video" : `Hook duration · ${duration}s`}>
        <div className={alwaysOn ? "pointer-events-none opacity-40" : undefined} aria-disabled={alwaysOn}>
          <Slider
            value={duration}
            min={HOOK_DURATION_MIN}
            max={HOOK_DURATION_MAX}
            step={0.5}
            onValueChange={(v) => onDuration((Array.isArray(v) ? v[0] : v) as number)}
          />
        </div>
        <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-xs text-zinc-200">
          <input
            type="checkbox"
            checked={alwaysOn}
            onChange={(e) => onAlwaysOn(e.target.checked)}
            className="mt-0.5 size-3.5 accent-lime-400"
          />
          <span>
            Always on
            <span className="block text-[11px] leading-relaxed text-zinc-500">
              Keep the hook on screen until the end of the video.
            </span>
          </span>
        </label>
      </Row>
      <Row label="Text design">
        {/* Manrope for the whole picker, cleaner, more modern than the default UI
            face. All template cards are CENTER-aligned (chip, name + theme) so the
            grid reads as a tidy gallery instead of ragged left-aligned tiles. */}
        <div
          className="grid grid-cols-2 gap-2"
          style={{ fontFamily: "var(--font-manrope), ui-sans-serif, system-ui, sans-serif" }}
        >
          {HOOK_DESIGNS.map((d) => {
            const selected = (templateId || DEFAULT_HOOK_DESIGN_ID) === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onTemplate(d.id)}
                title={d.blurb}
                aria-pressed={selected}
                className={`group flex flex-col items-center rounded-xl border p-2.5 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                  selected
                    ? "border-lime-400/70 bg-lime-400/10 shadow-[0_0_0_1px_rgba(163,230,53,0.25),0_6px_20px_-8px_rgba(163,230,53,0.35)]"
                    : "border-white/10 bg-white/[0.04] hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.07]"
                }`}
              >
                <div
                  className="relative flex h-[92px] w-full flex-col items-center justify-center overflow-hidden rounded-md bg-zinc-800 px-1.5 ring-1 ring-inset ring-white/10"
                  style={{
                    justifyContent: effPos === "top" ? "flex-start" : effPos === "bottom" ? "flex-end" : "center",
                  }}
                >
                  {isHookFxLayout(d.render.layout) ? (
                    <HookFxMini design={d} text={d.render.allCaps ? "THE STORY BEHIND THIS" : "Do what you love and the rest will come"} widthPx={150} replayKey={d.id} />
                  ) : (
                  <div className="relative flex max-w-full flex-col items-center overflow-hidden text-center"
                    style={d.render.layout === "news-card" ? { width: "90%", padding: 6, borderRadius: 10, background: d.render.boxColor } : undefined}>
                    {hookHeadlineLines(d.render.allCaps ? "THE STORY BEHIND THIS" : "The story behind this", d.render.fontSize, 820, d.render.layout === "news-card" ? 3 : 4).map((line, index, all) => (
                      <span key={`${line}-${index}`} className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap px-1.5 text-[9px] leading-tight"
                        style={{
                          color: d.render.layout === "news-card" && index === all.length - 1 ? d.render.accentColor : d.render.fontColor,
                          background: d.render.layout === "news-card" ? undefined : d.render.layout === "stacked" && index % 2 ? d.render.accentColor : d.render.boxColor,
                          fontFamily: burnFontStack(HOOK_FONT_FAMILY[d.render.font] ?? "Montserrat SemiBold"),
                        }}>
                        {line}
                      </span>
                    ))}
                    <HookShine motion={d.render.motion} />
                  </div>
                  )}
                </div>
                <div className={`mt-2 text-[11px] font-semibold leading-tight ${selected ? "text-lime-200" : "text-zinc-200"}`}>
                  {d.name}
                </div>
                <div className={`mt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] ${selected ? "text-lime-400/80" : "text-zinc-500"}`}>
                  {d.theme}
                </div>
              </button>
            );
          })}
        </div>
      </Row>
      <Row label="Text position">
        <NativeSelect
          value={position ?? active.render.position}
          onChange={(v) => onPosition(v as "top" | "center" | "bottom")}
          options={[
            { value: "top", label: "Top" },
            { value: "center", label: "Middle" },
            { value: "bottom", label: "Bottom" },
          ]}
        />
      </Row>
      {(() => {
        // Size + fine-position sliders write into hookCustomDesign (merged over the
        // template at burn time), so they persist with the skill config — the saved
        // style IS the template every future clip renders with. They work without
        // toggling "Custom look" on (that toggle only gates color/box).
        const baseSize = active.render.fontSize;
        const sizePct = Math.round(((custom?.fontSize ?? baseSize) / baseSize) * 100);
        const bandYPct = effPos === "top" ? 12 : effPos === "bottom" ? 85 : 50;
        const yPct = typeof custom?.yPct === "number" ? custom.yPct : bandYPct;
        const patch = (p: Partial<NonNullable<HookCustom>>) => onCustom({ ...(custom ?? {}), ...p });
        return (
          <>
            <Row label={`Text size · ${sizePct}%`}>
              <Slider
                value={sizePct}
                min={50}
                max={200}
                step={5}
                onValueChange={(v) => {
                  const pct = (Array.isArray(v) ? v[0] : v) as number;
                  patch({ fontSize: Math.round((baseSize * pct) / 100) });
                }}
              />
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">100% = the template&apos;s size. Applies to every clip.</p>
            </Row>
            <Row label={`Fine position · ${Math.round(yPct)}% from top`}>
              <Slider
                value={yPct}
                min={0}
                max={100}
                step={1}
                onValueChange={(v) => patch({ yPct: (Array.isArray(v) ? v[0] : v) as number })}
              />
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                Exact vertical spot, overrides Top/Middle/Bottom when moved.
                {typeof custom?.yPct === "number" && (
                  <button
                    type="button"
                    className="ml-2 text-lime-400 hover:underline"
                    onClick={() => { const rest = { ...(custom ?? {}) }; delete rest.yPct; onCustom(Object.keys(rest).length ? rest : null); }}
                  >
                    Reset to band
                  </button>
                )}
              </p>
            </Row>
          </>
        );
      })()}
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Preview approximates the burned-in look. <span className="text-zinc-300">{active.name}</span> - {active.blurb}
      </p>
      <Row label="Custom look">
        <button
          type="button"
          onClick={() => onCustom(custom ? null : { position: active.render.position, fontColor: active.render.fontColor })}
          className={`w-full rounded-md border px-2 py-1.5 text-xs ${custom ? "border-lime-500 bg-lime-500/20 text-zinc-100" : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20"}`}
        >
          {custom ? "Custom ON - overrides the template" : "Customize this hook…"}
        </button>
      </Row>
      {custom && (
        <>
          <Row label="Text color">
            <input
              type="color"
              value={custom.fontColor ?? active.render.fontColor}
              onChange={(e) => onCustom({ ...custom, fontColor: e.target.value })}
              className="h-7 w-full cursor-pointer rounded-md border border-white/10 bg-white/5"
            />
          </Row>
          <Row label="Box behind text">
            <NativeSelect
              value={custom.boxColor === undefined ? "template" : custom.boxColor ? `box:${custom.boxColor}` : "none"}
              onChange={(v) => onCustom({ ...custom, boxColor: v === "template" ? undefined : v === "none" ? "" : v.replace("box:", "") })}
              options={[
                { value: "template", label: "Same as template" },
                { value: "none", label: "No box" },
                { value: "box:#000000", label: "Black box" },
                { value: "box:#FFFFFF", label: "White box" },
                { value: "box:#E11D48", label: "Red box" },
              ]}
            />
          </Row>
          <Row label={`Size · ${custom.fontSize ?? active.render.fontSize}px`}>
            <Slider
              value={custom.fontSize ?? active.render.fontSize}
              min={36}
              max={80}
              step={2}
              onValueChange={(v) => onCustom({ ...custom, fontSize: (Array.isArray(v) ? v[0] : v) as number })}
            />
          </Row>
          <Row label="ALL CAPS">
            <button
              type="button"
              onClick={() => onCustom({ ...custom, allCaps: !(custom.allCaps ?? active.render.allCaps) })}
              className={`w-full rounded-md border px-2 py-1.5 text-xs ${(custom.allCaps ?? active.render.allCaps) ? "border-lime-500 bg-lime-500/20 text-zinc-100" : "border-white/10 bg-white/5 text-zinc-300"}`}
            >
              {(custom.allCaps ?? active.render.allCaps) ? "ON" : "OFF"}
            </button>
          </Row>
        </>
      )}
    </>
  );
}

/**
 * Hook Title Card config (clip.title): pick the opening-slate design + how long it
 * holds, with a live preview chip per template. Persists titleTemplateId +
 * titleDurationSec onto the MarketplaceSkillConfig; the catalog floor +
 * clipEditPlanner.applyTitleStyle burn them onto the clip's opening title_card
 * slate. Each chip CSS-approximates the burned-in look (black slate) — one source
 * of truth with the render params in lib/builder/titleCardDesigns.
 */
function TitleCardConfig({
  templateId,
  duration,
  prompt,
  onTemplate,
  onDuration,
  onPrompt,
}: {
  templateId: string;
  duration: number;
  prompt: string;
  onTemplate: (id: string) => void;
  onDuration: (v: number) => void;
  onPrompt: (v: string) => void;
}) {
  const active = TITLE_CARD_DESIGNS.find((d) => d.id === templateId) ?? TITLE_CARD_DESIGNS[0];
  return (
    <>
      <Row label="News template">
        <div className="grid grid-cols-2 gap-1.5">
          {TITLE_CARD_DESIGNS.map((d) => {
            const selected = (templateId || DEFAULT_TITLE_CARD_ID) === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onTemplate(d.id)}
                title={d.blurb}
                className={`rounded-lg border p-2 text-left transition-colors ${
                  selected ? "border-lime-500 bg-lime-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                {/* 9:16 mini news-slate: the kicker badge over a headline line on the
                    template's background, matches the burned-in news graphic. */}
                <div
                  className="mx-auto flex h-16 w-9 flex-col items-center justify-center gap-1 overflow-hidden rounded-sm px-0.5"
                  style={{ background: d.render.bgColor }}
                >
                  {d.render.kicker && (
                    <span
                      className="rounded-[2px] px-1 py-px text-[5px] font-black uppercase leading-none"
                      style={{ background: d.render.kickerColor, color: d.render.kickerTextColor }}
                    >
                      {d.render.kicker.replace(/[⚡●⚠]/g, "").trim().slice(0, 9)}
                    </span>
                  )}
                  <span className="px-0.5 text-center text-[6px] leading-tight" style={{ ...d.preview, background: "transparent" }}>
                    Headline
                  </span>
                </div>
                <div className={`mt-1.5 text-[11px] font-medium ${selected ? "text-lime-300" : "text-zinc-300"}`}>
                  {d.name}
                </div>
              </button>
            );
          })}
        </div>
      </Row>
      <Row label={`Slate duration · ${duration}s`}>
        <Slider
          value={duration}
          min={TITLE_DURATION_MIN}
          max={TITLE_DURATION_MAX}
          step={0.5}
          onValueChange={(v) => onDuration((Array.isArray(v) ? v[0] : v) as number)}
        />
      </Row>
      <Row label="Headline (optional)">
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          placeholder={'What should the headline say? e.g. "he quit his job for THIS" · "the coffee stat nobody talks about" · "3 signs you\'re being scammed"'}
          rows={3}
          className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-lime-500"
        />
      </Row>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        A news-style title card is prepended so the clip opens like a broadcast, a
        <span className="text-zinc-300"> {active.render.kicker || "headline"} </span>
        badge over your headline. Leave it empty and the AI writes the headline from the clip.
        <span className="text-zinc-300"> {active.name}</span> - {active.blurb}
      </p>
    </>
  );
}

/**
 * Viral Sticker config (clip.sticker): box style + position + an optional prompt
 * to steer the (otherwise auto, context-aware) sticker text. Each style chip
 * CSS-approximates the burned-in box look (one source of truth with stickerStyles).
 */
function StickerConfig({
  styleId,
  position,
  prompt,
  onStyle,
  onPosition,
  onPrompt,
}: {
  styleId: string;
  position: string;
  prompt: string;
  onStyle: (id: string) => void;
  onPosition: (p: string) => void;
  onPrompt: (v: string) => void;
}) {
  return (
    <>
      <Row label="Sticker style">
        <div className="grid grid-cols-2 gap-1.5">
          {STICKER_STYLES.map((s) => {
            const selected = (styleId || DEFAULT_STICKER_STYLE_ID) === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onStyle(s.id)}
                title={s.blurb}
                className={`rounded-lg border p-2 text-left transition-colors ${
                  selected ? "border-lime-500 bg-lime-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                <div className="flex h-10 items-center justify-center overflow-hidden rounded-md bg-zinc-800 px-1 text-[12px] leading-none whitespace-nowrap">
                  <span style={s.preview}>STICKER</span>
                </div>
                <div className={`mt-1.5 text-[11px] font-medium ${selected ? "text-lime-300" : "text-zinc-300"}`}>
                  {s.name}
                </div>
              </button>
            );
          })}
        </div>
      </Row>
      <Row label="Position">
        <NativeSelect
          value={position || DEFAULT_STICKER_POSITION}
          onChange={(v) => onPosition(v)}
          options={[
            { value: "top", label: "Top" },
            { value: "center", label: "Center" },
            { value: "bottom", label: "Bottom" },
          ]}
        />
      </Row>
      <Row label="Sticker text (optional steer)">
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          placeholder={'e.g. "announce joining the $$$ trend"  ·  leave blank to auto-write from the clip'}
          rows={2}
          className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-lime-500"
        />
      </Row>
    </>
  );
}

/**
 * Overlay Image config (clip.overlayimage): upload ONE image (logo / watermark /
 * sticker / frame) and pick how it composites onto the clip:
 *  - Overlay mode: the image floats ON the full video, centered or pinned to the
 *    top / bottom band.
 *  - Frame mode: the video scales DOWN to a centered box (overlayScale of the
 *    canvas) and the image fills the whole canvas as the frame behind it — the
 *    entire video stays fully visible inside the image border.
 * The image URL + settings ride the node config and the planner's image_overlay
 * floor burns them into every clip the pipeline renders.
 */
function OverlayImageConfig({
  imageUrl,
  mode,
  position,
  opacity,
  scale,
  onImage,
  onMode,
  onPosition,
  onOpacity,
  onScale,
}: {
  imageUrl: string;
  mode: "overlay" | "frame";
  position: string;
  opacity: number;
  scale: number;
  onImage: (url: string) => void;
  onMode: (m: "overlay" | "frame") => void;
  onPosition: (p: "overlay" | "top" | "bottom") => void;
  onOpacity: (v: number) => void;
  onScale: (v: number) => void;
}) {
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const MAX_BYTES = 10 * 1024 * 1024; // 10MB, a watermark/logo is tiny

  const handleFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Pick an image file (.png/.jpg/.webp/.gif)."); return; }
    if (file.size > MAX_BYTES) { setError(`${file.name} is ${(file.size / 1048576).toFixed(1)}MB, keep it under 10MB.`); return; }
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const publicUrl = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
      if (publicUrl) onImage(publicUrl);
      else setError("upload returned no URL, try again");
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Row label="Image">
        <div className="space-y-2">
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt="overlay preview"
              className="h-16 w-full rounded-md border border-white/10 bg-zinc-900 object-contain"
            />
          )}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 bg-white/5 px-3 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-lime-500/60 hover:text-zinc-100">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            {busy ? "Uploading…" : imageUrl ? "Replace image" : "Upload image"}
          </label>
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
        </div>
      </Row>
      <Row label="Mode">
        <NativeSelect
          value={mode}
          onChange={(v) => onMode(v as "overlay" | "frame")}
          options={[
            { value: "overlay", label: "Overlay, image floats on the video" },
            { value: "frame", label: "Frame, video shrinks, image fills around it" },
          ]}
        />
      </Row>
      {mode === "overlay" ? (
        <Row label="Position">
          <NativeSelect
            value={position || "overlay"}
            onChange={(v) => onPosition(v as "overlay" | "top" | "bottom")}
            options={[
              { value: "overlay", label: "Centered on the video" },
              { value: "top", label: "Top, pinned near the top of the video" },
              { value: "bottom", label: "Bottom, pinned near the bottom of the video" },
            ]}
          />
        </Row>
      ) : (
        <Row label={`Video size · ${Math.round(scale * 100)}%`}>
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={Math.round(scale * 100)}
            onChange={(e) => onScale(Number(e.target.value) / 100)}
            className="w-full accent-lime-500"
          />
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            The video shrinks to a centered box at this size; your image fills the
            canvas around it (the frame). The whole video stays visible.
          </p>
        </Row>
      )}
      <Row label={`Opacity · ${Math.round(opacity * 100)}%`}>
        <input
          type="range"
          min={5}
          max={100}
          step={5}
          value={Math.round(opacity * 100)}
          onChange={(e) => onOpacity(Number(e.target.value) / 100)}
          className="w-full accent-lime-500"
        />
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          The image is burned onto the clip in every run. Lower opacity makes a subtle
          watermark; 100% is fully opaque.
        </p>
      </Row>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function NativeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full appearance-none rounded-lg border border-input bg-transparent pr-8 pl-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {options.map((o) => (
          <option
            key={o.value}
            value={o.value}
            className="bg-popover text-popover-foreground"
          >
            {o.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

/**
 * Upload a local video file to Convex storage (transient; the run deletes the
 * source blob afterward, keeping only the clips). Sidesteps the YouTube bot-check.
 * URL + Campaign inputs are sibling pills in the Source node's 3-pill selector.
 */
function UploadDropzone({
  storageId,
  onUpload,
}: {
  storageId?: string;
  onUpload: (publicUrl: string, storageId: string) => void;
}) {
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);
  const setSourceUploading = useClippingStore((s) => s.setSourceUploading);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The clip pipeline (download/transcribe/clip) caps a source at 500MB - reject
  // an oversize upload HERE with a clear message, not deep in the run with a
  // generic failure (and a stranded blob).
  const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("video/")) { setError("Pick a video file (.mp4/.mov/.webm)."); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError(`Video is ${(file.size / 1048576).toFixed(0)}MB - over the 500MB limit. Trim it or export at a lower resolution.`); return; }
    setBusy(true);
    setSourceUploading(true); // gate the Run button until the upload completes
    setFileName(file.name);
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId: sid } = (await res.json()) as { storageId: string };
      const publicUrl = (await resolveStorageUrl({ storageId: sid as unknown as never })) as string;
      onUpload(publicUrl, sid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
      setFileName(null);
    } finally {
      setBusy(false);
      setSourceUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-3 py-5 text-center transition-colors hover:border-white/30 hover:bg-white/[0.06]">
        {busy ? (
          <>
            <Loader2 className="size-5 animate-spin text-lime-400" />
            <span className="text-xs text-zinc-300">Uploading {fileName}…</span>
          </>
        ) : storageId ? (
          <>
            <Upload className="size-5 text-emerald-400" />
            <span className="max-w-full truncate text-xs text-emerald-300">{fileName ?? "Video uploaded ✓"}</span>
            <span className="text-[10.5px] text-zinc-500">Click to replace - deleted after the run</span>
          </>
        ) : (
          <>
            <Upload className="size-5 text-zinc-400" />
            <span className="text-xs text-zinc-300">Drop or click to upload a video</span>
            <span className="text-[10.5px] text-zinc-500">Transcribed, then deleted - only clips are kept</span>
          </>
        )}
        <input
          type="file"
          accept="video/*"
          className="hidden"
          disabled={busy}
          // Reset value so re-picking the SAME file still fires onChange (e.g.
          // after an error, or to replace then re-upload the identical file).
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }}
        />
      </label>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

// ── Publish node inspector ──────────────────────────────────────────────────
const PUBLISH_PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", facebook: "Facebook",
  x: "X", twitter: "X", threads: "Threads", linkedin: "LinkedIn", pinterest: "Pinterest",
  bluesky: "Bluesky", reddit: "Reddit", telegram: "Telegram",
};
const publishPlatformLabel = (p: string) => PUBLISH_PLATFORM_LABEL[p] ?? (p.charAt(0).toUpperCase() + p.slice(1));

type ConnAccount = { platform: string; displayName?: string; image?: string };

/** Small round social glyph: the account's real avatar when upload-post returns
 *  one, else the platform's brand mark from simpleicons, else a letter. */
function SocialGlyph({ platform, image }: { platform: string; image?: string }) {
  const [broke, setBroke] = useState(false);
  const brand = platform === "twitter" ? "x" : platform;
  const src = image && !broke ? image : `https://cdn.simpleicons.org/${brand}/white`;
  return (
    <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-700 text-[11px] font-bold text-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-full object-cover" onError={() => setBroke(true)} />
    </span>
  );
}

/** Persist the agent's clipConfig via the owner-gated route (auth auto-attached
 *  by the global fetch interceptor). Spreads the existing config so unrelated
 *  fields (schedule, order, interval) are preserved. */
async function savePublishClipConfig(mintAddress: string, clipConfig: unknown, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/agents/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mintAddress, kind: "clip", payload: { ...(clipConfig as object ?? {}), ...patch } }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
}

function PublishConfig({
  mintAddress,
  clipConfig,
  onNavigateToPosting,
}: {
  mintAddress?: string;
  clipConfig?: unknown;
  onNavigateToPosting?: () => void;
}) {
  const { accessToken } = useSupabaseAuth();
  const cfg = (clipConfig ?? {}) as { platforms?: string[]; autoPost?: boolean };

  const [accounts, setAccounts] = useState<ConnAccount[] | null>(null); // null = loading
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [autoPost, setAutoPost] = useState<boolean>(Boolean(cfg.autoPost));
  // null = "not customised yet" → every connected account defaults ON. A non-empty
  // array = the EXPLICIT set of enabled platforms. We never store [] to mean "all".
  const [enabled, setEnabled] = useState<string[] | null>(
    Array.isArray(cfg.platforms) && cfg.platforms.length ? cfg.platforms : null,
  );
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Live connected accounts (icon + display name), refreshed on focus so a connect
  // done in the popup reflects on return. Mirrors PostingTab's status poll.
  const refresh = useCallback(async () => {
    if (!mintAddress) { setAccounts([]); return; }
    try {
      const res = await fetch(`/api/social/status?username=${encodeURIComponent(mintAddress)}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) { setStatusErr(null); return; } // transient, keep last known
      const json = (await res.json()) as { ok?: boolean; connected?: Record<string, { displayName?: string; image?: string } | null> };
      if (json.ok === false) return;
      const conn = json.connected ?? {};
      const list: ConnAccount[] = Object.entries(conn)
        .filter(([, v]) => Boolean(v))
        .map(([platform, v]) => ({ platform, displayName: v?.displayName, image: v?.image }));
      setAccounts(list);
      setStatusErr(null);
    } catch {
      setStatusErr((e) => e); // network blip, keep last known
    }
  }, [mintAddress, accessToken]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const connectedPlatforms = useMemo(() => (accounts ?? []).map((a) => a.platform), [accounts]);
  const isOn = useCallback(
    (p: string) => (enabled === null ? true : enabled.includes(p)),
    [enabled],
  );
  const onPlatforms = useMemo(() => connectedPlatforms.filter(isOn), [connectedPlatforms, isOn]);

  // The clip Post Now publishes: the next-up not-yet-posted clip, else the newest
  // clip that has a rendered URL. postingFeed is best-first (viralScore DESC).
  const feed = useQuery(api.clipJobs.postingFeed, mintAddress ? { mintAddress } : "skip") as
    | { clipUrl?: string; title?: string; state?: string }[]
    | undefined;
  const nextClip = useMemo(() => {
    const rows = feed ?? [];
    return rows.find((r) => r.state === "not_posted" && r.clipUrl) ?? rows.find((r) => r.clipUrl);
  }, [feed]);

  const persist = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!mintAddress) return;
      try {
        await savePublishClipConfig(mintAddress, clipConfig, patch);
        setSaveErr(null);
      } catch (e) {
        setSaveErr(e instanceof Error ? e.message : "Couldn't save");
      }
    },
    [mintAddress, clipConfig],
  );

  const toggleAccount = useCallback(
    (platform: string) => {
      const base = enabled ?? connectedPlatforms; // start from the effective ON set
      const next = base.includes(platform) ? base.filter((p) => p !== platform) : [...base, platform];
      setEnabled(next);
      // If the user turns every account off, also force auto-post off so the drip
      // can never fall back to "post everywhere" on an empty list.
      const patch: Record<string, unknown> = { platforms: next };
      if (next.length === 0 && autoPost) { setAutoPost(false); patch.autoPost = false; }
      void persist(patch);
    },
    [enabled, connectedPlatforms, autoPost, persist],
  );

  const toggleAutoPost = useCallback(
    (on: boolean) => {
      setAutoPost(on);
      void persist({ autoPost: on });
    },
    [persist],
  );

  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<string | null>(null);
  const postNow = useCallback(async () => {
    if (posting || !mintAddress) return;
    if (onPlatforms.length === 0) { setPostMsg("Turn on at least one account to post to."); return; }
    if (!nextClip?.clipUrl) { setPostMsg("No clip ready yet, generate clips first, then Post Now."); return; }
    setPosting(true);
    setPostMsg("Posting the latest clip…");
    try {
      const res = await fetch("/api/social/post", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({
          username: mintAddress,
          platforms: onPlatforms,
          type: "video",
          title: nextClip.title || "New clip",
          description: nextClip.title || "",
          mediaUrls: [nextClip.clipUrl],
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; posted?: string[]; error?: string; alreadyPosted?: boolean };
      if (j.alreadyPosted) setPostMsg("That clip was already posted.");
      else if (res.ok && j.ok) setPostMsg(`✅ Posted to ${(j.posted ?? onPlatforms).map(publishPlatformLabel).join(", ")}.`);
      else setPostMsg(`Post failed: ${j.error ?? `HTTP ${res.status}`}`);
    } catch (e) {
      setPostMsg(`Post failed: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      setPosting(false);
    }
  }, [posting, mintAddress, onPlatforms, nextClip, accessToken]);

  return (
    <div className="space-y-3">
      {/* Master auto-post switch */}
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-zinc-100">Auto-post new clips</div>
          <div className="text-[11px] text-zinc-400">
            {autoPost ? "Publishing automatically to the accounts below" : "Clips are saved as drafts until you post"}
          </div>
        </div>
        <Switch checked={autoPost} onCheckedChange={toggleAutoPost} className="data-[state=checked]:bg-emerald-500" />
      </div>

      {/* Connected accounts with per-account on/off */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Connected accounts</Label>
        {accounts === null ? (
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-[12px] text-zinc-400">
            <Loader2 className="size-3.5 animate-spin" /> Checking connections…
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/15 bg-white/5 px-3 py-3 text-[12px] text-zinc-400">
            No social accounts connected yet. Connect them in the Schedule tab, then they show up here.
          </div>
        ) : (
          <div className="space-y-1.5">
            {accounts.map((a) => (
              <div
                key={a.platform}
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2"
              >
                <SocialGlyph platform={a.platform} image={a.image} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-zinc-100">
                    {a.displayName || publishPlatformLabel(a.platform)}
                  </div>
                  <div className="truncate text-[11px] text-zinc-400">{publishPlatformLabel(a.platform)}</div>
                </div>
                <Switch
                  checked={isOn(a.platform)}
                  onCheckedChange={() => toggleAccount(a.platform)}
                  className="data-[state=checked]:bg-emerald-500"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Post now */}
      <Button
        type="button"
        onClick={postNow}
        disabled={posting || (accounts?.length ?? 0) === 0 || onPlatforms.length === 0}
        className="w-full justify-center gap-1.5 bg-lime-500 text-zinc-900 hover:bg-lime-400"
      >
        {posting ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}
        {posting ? "Posting…" : "Post latest clip now"}
      </Button>
      {nextClip?.title && !posting && (
        <p className="truncate text-[11px] text-zinc-500">
          Next up: <span className="text-zinc-300">{nextClip.title}</span>
        </p>
      )}
      {postMsg && <p className="text-[11px] leading-relaxed text-zinc-300">{postMsg}</p>}
      {saveErr && <p className="text-[11px] text-red-400">Couldn&apos;t save: {saveErr}</p>}
      {statusErr && <p className="text-[11px] text-amber-400">{statusErr}</p>}

      <button
        type="button"
        onClick={() => onNavigateToPosting?.()}
        className="text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
      >
        Open the Schedule tab for drip timing &amp; order →
      </button>
    </div>
  );
}

function NodeForm({
  node,
  onNavigateToPosting,
  mintAddress,
  clipConfig,
}: {
  node: VelloNode;
  onNavigateToPosting?: () => void;
  mintAddress?: string;
  clipConfig?: unknown;
}) {
  const update = useClippingStore((s) => s.updateNodeConfig);
  const c = node.data.config as unknown as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) =>
    update(node.id, patch as Partial<typeof node.data.config>);
  // @base-ui Slider onValueChange returns number for scalar sliders; defensive unwrap for type safety
  const num = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : v) as number;

  switch (node.data.kind) {
    case "source": {
      // 3-pill source selector: Paste URL · Campaign · Upload file. Switching pills
      // RESETS the source (clears every cross-mode field) so Run only ever sees the
      // ONE input the active pill owns - no conflict over "what to process".
      const sm = (c.sourceMode as "url" | "campaign" | "upload" | undefined)
        ?? (c.sourceStorageId ? "upload" : (c.contentRewardId || c.campaignId) ? "campaign" : "url");
      const switchSourceMode = (target: "url" | "campaign" | "upload") => {
        if (target === sm) return;
        set({ sourceMode: target, sourceUrl: "", sourceStorageId: undefined, campaignId: undefined, contentRewardId: undefined, rewardVideos: undefined, sourceFolderVideos: undefined, clipAll: false, sourceCollectionUrl: undefined });
      };
      return (
        <>
          <Row label="Source video">
            <div className="space-y-2">
              <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
                {([["url", "Paste URL", Link2], ["campaign", "Campaign", Megaphone], ["upload", "Upload file", Upload]] as const).map(([m, label, Icon]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => switchSourceMode(m)}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors ${
                      sm === m ? "bg-white/15 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>
              {sm === "url" && (
                <PasteUrlSource
                  key={node.id}
                  url={(c.sourceUrl as string) ?? ""}
                  folderVideos={c.sourceFolderVideos as { url: string; name: string }[] | undefined}
                  clipAll={(c.clipAll as boolean) ?? false}
                  onChangeUrl={(url) =>
                    // A manually pasted URL is a USER source - clear all provenance so it's
                    // never falsely cached or auto-submitted (cache rule, risk #1), and drop
                    // any prior folder expansion + clip-all opt-in (this is a fresh URL).
                    set({ sourceUrl: url, sourceStorageId: undefined, campaignId: undefined, contentRewardId: undefined, rewardVideos: undefined, sourceFolderVideos: undefined, clipAll: false, sourceCollectionUrl: undefined })
                  }
                  onExpandFolder={(videos, collectionUrl) =>
                    // Pasted Drive FOLDER / YouTube collection: seed the FIRST video + stash
                    // the full list for the swap-picker + the collection url for a "clip all"
                    // run. Fresh expansion → clip-all defaults OFF (opt-in). Still a user source.
                    set({ sourceUrl: videos[0]?.url ?? "", sourceStorageId: undefined, campaignId: undefined, contentRewardId: undefined, rewardVideos: undefined, sourceFolderVideos: videos, sourceCollectionUrl: collectionUrl, clipAll: false })
                  }
                  onPickFolderVideo={(url) =>
                    // Swap which folder video this Source clips (keep the stashed list +
                    // collection url + any clip-all opt-in).
                    set({ sourceUrl: url, sourceStorageId: undefined, campaignId: undefined, contentRewardId: undefined, rewardVideos: undefined })
                  }
                  onToggleClipAll={(on) => set({ clipAll: on })}
                />
              )}
              {sm === "upload" && (
                <UploadDropzone
                  key={node.id}
                  storageId={c.sourceStorageId as string | undefined}
                  onUpload={(publicUrl, sid) => set({ sourceUrl: publicUrl, sourceStorageId: sid, campaignId: undefined, contentRewardId: undefined, rewardVideos: undefined })}
                />
              )}
              {sm === "campaign" && (
                <div className="space-y-2">
                  <CampaignSourcePicker
                    currentUrl={(c.sourceUrl as string) ?? ""}
                    campaignId={c.campaignId as string | undefined}
                    contentRewardId={c.contentRewardId as string | undefined}
                    clipAll={(c.clipAll as boolean) ?? false}
                    onPickConvex={(url, campaignId, collectionUrl) =>
                      // A Source carries at most ONE provenance - Convex XOR Supabase.
                      // collectionUrl set = a folder/channel was expanded → keep any clip-all
                      // opt-in; a plain single link (no collectionUrl) clears it.
                      set({ sourceUrl: url, sourceStorageId: undefined, campaignId, contentRewardId: undefined, rewardVideos: undefined, sourceCollectionUrl: collectionUrl, ...(collectionUrl ? {} : { clipAll: false }) })
                    }
                    onToggleClipAll={(on) => set({ clipAll: on })}
                    onPickReward={(rewardId, videos) =>
                      // Stage content_reward: seed first gdrive video + the full list
                      // (RewardVideoPicker swaps) + contentRewardId (Supabase provenance).
                      // A reward has no single collection url, so clip-all doesn't apply here.
                      set({
                        sourceUrl: videos[0]?.url ?? "",
                        sourceStorageId: undefined,
                        campaignId: undefined,
                        contentRewardId: rewardId,
                        rewardVideos: videos,
                        clipAll: false,
                        sourceCollectionUrl: undefined,
                      })
                    }
                    onClear={() =>
                      set({ sourceUrl: "", sourceStorageId: undefined, campaignId: undefined, contentRewardId: undefined, rewardVideos: undefined, clipAll: false, sourceCollectionUrl: undefined })
                    }
                  />
                  {Array.isArray(c.rewardVideos) && (c.rewardVideos as unknown[]).length > 0 && (
                    <>
                      <Row label={`Stage campaign clips (${(c.rewardVideos as unknown[]).length})`}>
                        <RewardVideoPicker
                          currentUrl={(c.sourceUrl as string) ?? ""}
                          videos={c.rewardVideos as { url: string; name: string }[]}
                          onPick={(url) =>
                            // Swap which folder video this Source clips, KEEPING the same
                            // contentRewardId (clearing any uploaded blob / Convex campaign).
                            set({ sourceUrl: url, sourceStorageId: undefined, campaignId: undefined })
                          }
                        />
                      </Row>
                      {(c.rewardVideos as unknown[]).length > 1 && (
                        <ClipAllToggle
                          count={(c.rewardVideos as unknown[]).length}
                          enabled={(c.clipAll as boolean) === true}
                          onToggle={(on) => set({ clipAll: on })}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </Row>
          {typeof c.sourceUrl === "string" && c.sourceUrl.trim() && !looksExpandableSource(c.sourceUrl) && (
            <SourcePreview
              sourceUrl={c.sourceUrl}
              mintAddress={mintAddress}
              title={([...(Array.isArray(c.sourceFolderVideos) ? c.sourceFolderVideos : []), ...(Array.isArray(c.rewardVideos) ? c.rewardVideos : [])] as { url: string; name: string }[]).find((video) => video.url === c.sourceUrl)?.name}
            />
          )}
          <div className="flex items-center justify-between rounded-lg border border-lime-500/20 bg-lime-500/[0.07] px-3 py-2">
            <Label className="text-xs font-medium text-lime-200">
              ✨ Let AI decide length &amp; count
            </Label>
            <Switch
              checked={(c.autoPlan as boolean) ?? false}
              onCheckedChange={(v) => set({ autoPlan: v })}
            />
          </div>
          {(c.autoPlan as boolean) ? (
            <p className="px-0.5 text-[11px] leading-relaxed text-zinc-400">
              The analyzer extracts as many strong clips as the source supports - natural windows, ~1 per few minutes (capped at 30). No manual limits.
            </p>
          ) : (
            <>
          <Row label={`Number of clips · ${(c.maxClips as number) ?? 1}`}>
            <Slider
              value={(c.maxClips as number) ?? 1}
              min={1}
              max={60}
              step={1}
              onValueChange={(v) => set({ maxClips: Math.round(num(v)) })}
            />
          </Row>
          <p className="px-0.5 text-[11px] leading-relaxed text-zinc-400">
            {((c.maxClips as number) ?? 1) > 1
              ? `≈ ${(c.maxClips as number) ?? 1}× the render + posting volume of a single clip. Counts beyond the source's distinct strong moments are made by reusing each moment as variations (different hook, caption, length & crop). High counts run on the cloud, the local preview run stays capped.`
              : "How many clips this source produces. Raise it to fan one source into many posts (up to 60, on cloud runs)."}
          </p>
          <Row label={`Min clip length · ${(c.clipLengthMin as number) ?? 20}s`}>
            <Slider
              value={(c.clipLengthMin as number) ?? 20}
              min={5}
              max={90}
              step={1}
              onValueChange={(v) => {
                const min = num(v);
                const max = (c.clipLengthMax as number) ?? 45;
                set(min > max ? { clipLengthMin: min, clipLengthMax: min } : { clipLengthMin: min });
              }}
            />
          </Row>
          <Row label={`Max clip length · ${(c.clipLengthMax as number) ?? 45}s`}>
            <Slider
              value={(c.clipLengthMax as number) ?? 45}
              min={5}
              max={90}
              step={1}
              onValueChange={(v) => {
                const max = num(v);
                const min = (c.clipLengthMin as number) ?? 20;
                set(max < min ? { clipLengthMax: max, clipLengthMin: max } : { clipLengthMax: max });
              }}
            />
          </Row>
            </>
          )}
          <Row label="Clip feel">
            <NativeSelect
              value={(c.clipFeel as string) ?? "any"}
              onChange={(v) => set({ clipFeel: v })}
              options={[
                { value: "any", label: "Any (best virality)" },
                { value: "funny", label: "Funny 😂" },
                { value: "shocking", label: "Shocking 😱" },
                { value: "inspiring", label: "Inspiring 🌟" },
                { value: "informative", label: "Informative 📚" },
                { value: "emotional", label: "Emotional 💜" },
                { value: "controversial", label: "Controversial 🔥" },
              ]}
            />
          </Row>
          <Row label="Genre - for best results, pick what fits your content">
            <GenrePicker value={(c.genre as string) ?? "auto"} onChange={(v) => set({ genre: v })} />
          </Row>
        </>
      );
    }
    case "compose":
      // Transparent skill hub - no editable config. Skills auto-attach around it.
      return (
        <div className="rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-400">
          Skills attached here fan around this hub. Drop skills from the Library
          or palette - they auto-attach.
        </div>
      );
    case "skill":
      if (c.variant === "marketplace") {
        const meta = CLIP_SKILL_BY_ID[c.skillId as string];
        return (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <span className="text-base leading-none">{meta?.icon ?? "✨"}</span>
              <span>{(c.skillName as string) ?? meta?.name ?? "Skill"}</span>
            </div>
            <p className="text-xs text-zinc-400">
              {meta?.blurb ?? "Installed clipping skill - the AI editor applies it when you Run."}
            </p>
            {/* Guardrails has no render-time knobs, it's a PUBLISH-time gate. Say so
                on the node, or an operator reads "no ops emitted" as "not working". */}
            {c.skillId === "clip.guardrails" && (
              <p className="rounded-md border border-rose-400/20 bg-rose-400/5 px-2.5 py-2 text-[11px] leading-relaxed text-rose-200/90">
                Runs when a clip is POSTED, not while it renders. Each clip is checked for
                flagged caption language, a broken/too-short/low-res render, existing burned-in
                captions and obvious AI artifacts, a clip that fails is blocked and shows as
                <span className="font-medium"> flagged</span> in the queue instead of going out.
              </p>
            )}
            {c.skillId === "clip.prompt" && (
              <Row label="What should the clipper look for?">
                <textarea
                  value={(c.prompt as string) ?? ""}
                  onChange={(e) => set({ prompt: e.target.value })}
                  placeholder={'e.g. "find every moment where we talk about pricing"'}
                  rows={3}
                  className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-lime-500"
                />
              </Row>
            )}
            {c.skillId === "clip.campaignscout" && (
              <CampaignPicker
                selected={(c.campaignIds as string[]) ?? []}
                onChange={(ids) => set({ campaignIds: ids })}
              />
            )}
            {c.skillId === "clip.captions" && (
              <Row label="Caption preset">
                <CaptionPresetPicker
                  value={(c.captionPreset as string) ?? "default"}
                  onChange={(id) => set({ captionPreset: id })}
                />
              </Row>
            )}
            {c.skillId === "clip.captions" && (
              <Row label="Caption alignment">
                <NativeSelect
                  value={(c.captionAlign as string) ?? "bottom"}
                  onChange={(v) => set({ captionAlign: v as "top" | "center" | "bottom" })}
                  options={[
                    { value: "top", label: "Top" },
                    { value: "center", label: "Middle" },
                    { value: "bottom", label: "Bottom (safe)" },
                  ]}
                />
              </Row>
            )}
            {c.skillId === "clip.captions" && (
              <Row label="Caption text (optional)">
                <textarea
                  value={(c.captionPrompt as string) ?? ""}
                  onChange={(e) => set({ captionPrompt: e.target.value })}
                  placeholder={'How the ON-VIDEO captions read. e.g. "translate to Malay" · "ALL CAPS" · "lowercase, add emojis"'}
                  rows={2}
                  className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-lime-500"
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                  Controls the burned-in captions ON the video. Leave empty to transcribe the spoken words as-is.
                </p>
              </Row>
            )}
            {c.skillId === "clip.sticker" && (
              <StickerConfig
                styleId={(c.stickerStyleId as string) ?? DEFAULT_STICKER_STYLE_ID}
                position={(c.stickerPosition as string) ?? DEFAULT_STICKER_POSITION}
                prompt={(c.stickerPrompt as string) ?? ""}
                onStyle={(id) => set({ stickerStyleId: id })}
                onPosition={(p) => set({ stickerPosition: p })}
                onPrompt={(v) => set({ stickerPrompt: v })}
              />
            )}
            {c.skillId === "clip.overlayimage" && (
              <OverlayImageConfig
                imageUrl={(c.overlayImageUrl as string) ?? ""}
                mode={c.overlayMode === "frame" ? "frame" : "overlay"}
                position={(c.overlayPosition as string) ?? "overlay"}
                opacity={typeof c.overlayOpacity === "number" ? c.overlayOpacity : 1}
                scale={typeof c.overlayScale === "number" ? c.overlayScale : 0.85}
                onImage={(url) => set({ overlayImageUrl: url })}
                onMode={(m) => set({ overlayMode: m })}
                onPosition={(p) => set({ overlayPosition: p })}
                onOpacity={(v) => set({ overlayOpacity: v })}
                onScale={(v) => set({ overlayScale: v })}
              />
            )}
            {c.skillId === "clip.facetrack" && (
              <Row label="Framing">
                <NativeSelect
                  value={(c.framingMode as string) ?? "auto"}
                  onChange={(v) => set({ framingMode: v })}
                  options={[
                    { value: "auto", label: "Auto - fit the people / follow the speaker (letterbox if unsure)" },
                    { value: "pan", label: "Pan both - sweep left → right between guests" },
                    { value: "zoom", label: "Zoom one - punch in on the speaker" },
                    { value: "full", label: "No Crop (Fit) - shows the whole shot, never cropped" },
                  ]}
                />
              </Row>
            )}
            {c.skillId === "clip.zoom" && (
              <Row label="Zoom style">
                <NativeSelect
                  value={(c.zoomStyle as string) ?? "blur"}
                  onChange={(v) => set({ zoomStyle: v })}
                  options={[
                    { value: "blur", label: "Blur background - full person, live frosted glass (recommended)" },
                    { value: "blur_zoom_in", label: "Blur + slow zoom in - extra camera push" },
                    { value: "blur_zoom_out", label: "Blur + zoom out - slow reveal" },
                    { value: "punch", label: "Punch in on face - quick zoom on the strongest beat" },
                  ]}
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                  The blur styles fit the WHOLE person in frame over an Apple-style
                  frosted background (a face is never cropped in half); the zoom
                  styles add smooth motion so the clip is not static. Punch keeps the
                  classic quick zoom on one beat.
                </p>
              </Row>
            )}
            {c.skillId === "clip.filters" && (
              <>
                <Row label="Filter preset">
                  <div className="grid grid-cols-3 gap-1.5">
                    {FILTER_CHIPS.map((chip) => {
                      const activeP = ((c.filterPreset as string) ?? "") === chip.id;
                      return (
                        <button
                          key={chip.id || "none"}
                          type="button"
                          onClick={() => set({ filterPreset: chip.id || undefined })}
                          className={`rounded-md border p-1 transition-colors ${activeP ? "border-lime-500 bg-lime-500/20" : "border-white/10 bg-white/5 hover:border-white/20"}`}
                        >
                          {/* Colorful gradient swatch (warm skin → sky blue → green)
                              with the preset's CSS filter applied - approximates the
                              burned-in look so saturate / hue / grayscale / sepia all show. */}
                          <div
                            className="h-12 w-full rounded"
                            style={{
                              background:
                                "linear-gradient(105deg, #f6c79a 0%, #e8896a 28%, #d8456a 48%, #4a86e8 72%, #34c98a 100%)",
                              ...chip.css,
                            }}
                          />
                          <div className={`mt-1 text-center text-[11px] font-medium ${activeP ? "text-lime-300" : "text-zinc-300"}`}>
                            {chip.label}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Row>
                <Row label={`Saturation · ${(((c.filterSaturation as number) ?? 1)).toFixed(2)}×`}>
                  <Slider
                    value={(c.filterSaturation as number) ?? 1}
                    min={0}
                    max={2}
                    step={0.05}
                    onValueChange={(v) => set({ filterSaturation: (Array.isArray(v) ? v[0] : v) as number })}
                  />
                </Row>
                <Row label={`Brightness · ${((c.filterBrightness as number) ?? 0) >= 0 ? "+" : ""}${(((c.filterBrightness as number) ?? 0)).toFixed(2)}`}>
                  <Slider
                    value={(c.filterBrightness as number) ?? 0}
                    min={-0.5}
                    max={0.5}
                    step={0.05}
                    onValueChange={(v) => set({ filterBrightness: (Array.isArray(v) ? v[0] : v) as number })}
                  />
                </Row>
              </>
            )}
            {c.skillId === "clip.captionstyle" && (
              <Row label="Post caption / description">
                <textarea
                  value={(c.descriptionPrompt as string) ?? ""}
                  onChange={(e) => set({ descriptionPrompt: e.target.value, descFromCaption: false })}
                  placeholder={'Describe the persona + rules for the POST caption. e.g. "hype tone, in Malay, tag @brandname, add 3 hashtags" · "professional English, mention our website, no emojis"'}
                  rows={4}
                  className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-lime-500"
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                  Writes the POST caption (the text published under the video). Set the voice, language, tags, mentions, and hashtags here. This does not change the on-video captions (that is Dynamic Captions).
                </p>
              </Row>
            )}
            {c.skillId === "clip.title" && (
              <TitleCardConfig
                templateId={(c.titleTemplateId as string) ?? DEFAULT_TITLE_CARD_ID}
                duration={(c.titleDurationSec as number) ?? DEFAULT_TITLE_DURATION_SEC}
                prompt={(c.titlePrompt as string) ?? ""}
                onTemplate={(id) => set({ titleTemplateId: id })}
                onDuration={(v) => set({ titleDurationSec: v })}
                onPrompt={(v) => set({ titlePrompt: v })}
              />
            )}
            {c.skillId === "clip.hook" && (
              <HookOverlayConfig
                prompt={(c.hookPrompt as string) ?? ""}
                duration={(c.hookDurationSec as number) ?? DEFAULT_HOOK_DURATION_SEC}
                alwaysOn={c.hookAlwaysOn === true}
                templateId={(c.hookTemplateId as string) ?? DEFAULT_HOOK_DESIGN_ID}
                position={c.hookPosition as "top" | "center" | "bottom" | undefined}
                custom={(c.hookCustomDesign as HookCustom | undefined) ?? null}
                onPrompt={(v) => set({ hookPrompt: v })}
                onDuration={(v) => set({ hookDurationSec: v })}
                onAlwaysOn={(v) => set({ hookAlwaysOn: v })}
                onTemplate={(id) => set({ hookTemplateId: id })}
                onPosition={(p) => set({ hookPosition: p })}
                onCustom={(d) => set({ hookCustomDesign: d ?? undefined })}
              />
            )}
            {c.skillId === "clip.cta" && (
              <CtaVideoConfig
                ctaUrl={(c.ctaUrl as string) || undefined}
                onUpload={(url, storageId) => set({ ctaUrl: url, ctaStorageId: storageId })}
                onRemove={() => set({ ctaUrl: undefined, ctaStorageId: undefined })}
              />
            )}
            {c.skillId === "clip.hookvideos" && (
              <VideoPoolConfig
                label="Hook videos"
                hint="Played before every clip · up to 500MB each"
                urls={Array.isArray(c.videoUrls) ? (c.videoUrls as string[]) : []}
                onChange={(next) => set({ videoUrls: next })}
              />
            )}
            {c.skillId === "clip.maincontent" && (
              <VideoPoolConfig
                label="Main content videos"
                hint="Used as the body · up to 500MB each"
                urls={Array.isArray(c.videoUrls) ? (c.videoUrls as string[]) : []}
                onChange={(next) => set({ videoUrls: next })}
                bypass={{ enabled: c.mainOnly === true, onToggle: (v) => set({ mainOnly: v }) }}
              />
            )}
            {c.skillId === "clip.transitions" && (
              <TransitionsConfig
                transitionId={(c.transitionId as string) ?? DEFAULT_TRANSITION_ID}
                duration={(c.transitionDurationSec as number) ?? (transitionById((c.transitionId as string) ?? DEFAULT_TRANSITION_ID)?.durationSec ?? 0.5)}
                onTransition={(id) => set({ transitionId: id, transitionDurationSec: transitionById(id)?.durationSec })}
                onDuration={(v) => set({ transitionDurationSec: v })}
              />
            )}
            {c.skillId === "clip.brainrot" && (
              <BrainRotConfig
                bgId={(c.bgId as string) ?? RANDOM_GAMEPLAY_ID}
                onBg={(id) => set({ bgId: id })}
              />
            )}
            {c.skillId === "clip.memeaudio" && (
              <>
                <Row label="Reaction SFX pack">
                  <NativeSelect
                    value={(c.sfxPackId as string) ?? DEFAULT_REACTION_SFX_PACK_ID}
                    onChange={(v) => set({ sfxPackId: v })}
                    options={REACTION_SFX_PACKS.map((p) => ({ value: p.id, label: p.label }))}
                  />
                </Row>
                <p className="rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-400">
                  🔊 The AI still auto-picks WHICH sting fires and WHEN from the clip&apos;s emotion - the pack just swaps the sounds. No SFX on a neutral moment, or until the pack audio is hosted.
                </p>
              </>
            )}
            {c.skillId === "clip.trendingaudio" && (
              <>
                <TrendingAudioUploadConfig
                  audioUrl={(c.customAudioUrl as string) || undefined}
                  onUpload={(url, storageId) => set({ customAudioUrl: url, customAudioStorageId: storageId, musicTrackId: undefined, autoMusic: false })}
                  onRemove={() => set({ customAudioUrl: undefined, customAudioStorageId: undefined, autoMusic: true })}
                />
                {!(c.customAudioUrl as string) && (
                  <>
                    <Row label="Auto-pick to match the mood">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] leading-relaxed text-zinc-400">
                          Auto-add a track that fits the clip&apos;s mood — reads the transcript too, so a talky clip gets an instrumental bed instead of a vocal song. Turn off to pick one yourself.
                        </span>
                        <Switch
                          checked={((c.autoMusic as boolean | undefined) ?? true) !== false}
                          onCheckedChange={(v) => set(v ? { autoMusic: true, musicTrackId: undefined } : { autoMusic: false })}
                        />
                      </div>
                    </Row>
                    <Row label="Or pick a sound">
                      <TrendingAudioPicker
                        activeId={(c.musicTrackId as string) ?? ""}
                        onSelect={(id) => id ? set({ musicTrackId: id, autoMusic: false }) : set({ musicTrackId: undefined, autoMusic: true })}
                      />
                    </Row>
                  </>
                )}
                <Row label={`Music volume · ${musicGainDbToPct((c.gainDb as number) ?? DEFAULT_MUSIC_GAIN_DB)}%`}>
                  <Slider
                    value={musicGainDbToPct((c.gainDb as number) ?? DEFAULT_MUSIC_GAIN_DB)}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) => set({ gainDb: musicPctToGainDb((Array.isArray(v) ? v[0] : v) as number) })}
                  />
                </Row>
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  0% = silent · 100% = loudest. The track plays UNDER the clip so speech stays clear.
                </p>
                {TRENDING_AUDIO.length === 0 && !(c.customAudioUrl as string) && (
                  <p className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300/80">
                    No tracks loaded yet - the music library appears here once the sounds are uploaded, or upload your own above.
                  </p>
                )}
              </>
            )}
            <SkillMarkdown md={(meta?.markdownTemplate ?? "").slice(0, 700)} />
          </div>
        );
      }
      if (c.variant === "captions")
        return (
          <>
            <Row label="Tone">
              <NativeSelect
                value={c.tone as string}
                onChange={(v) => set({ tone: v })}
                options={[
                  { value: "casual", label: "Casual" },
                  { value: "hype", label: "Hype" },
                  { value: "informative", label: "Informative" },
                ]}
              />
            </Row>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Include hashtags
              </Label>
              <Switch
                checked={c.hashtags as boolean}
                onCheckedChange={(v) => set({ hashtags: v })}
              />
            </div>
          </>
        );
      if (c.variant === "broll")
        return (
          <>
            <Row label="Overlay pack">
              <NativeSelect
                value={c.pack as string}
                onChange={(v) => set({ pack: v })}
                options={[
                  { value: "city", label: "City" },
                  { value: "nature", label: "Nature" },
                  { value: "abstract", label: "Abstract" },
                ]}
              />
            </Row>
            <Row label={`Intensity · ${c.intensity}%`}>
              <Slider
                value={c.intensity as number}
                min={0}
                max={100}
                step={5}
                onValueChange={(v) => set({ intensity: num(v) })}
              />
            </Row>
          </>
        );
      return (
        <>
          <Row label="Aspect ratio">
            <NativeSelect
              value={c.ratio as string}
              onChange={(v) => set({ ratio: v })}
              options={[
                { value: "9:16", label: "9:16 (Vertical)" },
                { value: "16:9", label: "16:9 (Landscape)" },
                { value: "1:1", label: "1:1 (Square)" },
                { value: "4:5", label: "4:5 (Portrait)" },
              ]}
            />
          </Row>
          <Row label="Focus">
            <NativeSelect
              value={c.focus as string}
              onChange={(v) => set({ focus: v })}
              options={[
                { value: "auto", label: "Auto (subject)" },
                { value: "center", label: "Center" },
              ]}
            />
          </Row>
        </>
      );
    case "publish":
      // The Publish node OWNS the live posting controls: a master auto-post switch,
      // a per-account on/off toggle for every connected social, and a Post Now that
      // publishes the latest clip to the enabled accounts. State persists to the
      // agent clipConfig so the drip + Schedule tab stay in sync.
      return (
        <PublishConfig
          mintAddress={mintAddress}
          clipConfig={clipConfig}
          onNavigateToPosting={onNavigateToPosting}
        />
      );
    default:
      return null;
  }
}

export function InspectorPanel({
  onNavigateToPosting,
  onClose,
  mintAddress,
  clipConfig,
}: {
  onNavigateToPosting?: () => void;
  /** Minimize/hide the inspector (slides it back out). */
  onClose?: () => void;
  /** Agent mint - drives the Publish node's connected-accounts + Post Now. */
  mintAddress?: string;
  /** Raw agent clipConfig - the Publish node spreads it when persisting toggles. */
  clipConfig?: unknown;
} = {}) {
  const node = useClippingStore(
    (s) => s.nodes.find((n) => n.id === s.selectedId) ?? null
  );
  const removeNode = useClippingStore((s) => s.removeNode);
  const setPreview = useClippingStore((s) => s.setPreview);
  const edges = useClippingStore((s) => s.edges);
  const allNodes = useClippingStore((s) => s.nodes);
  const removeEdge = useClippingStore((s) => s.removeEdge);
  const addConnectedSkill = useClippingStore((s) => s.addConnectedSkill);
  const availableSkills = useClippingStore((s) => s.availableSkills);
  const running = useClippingStore((s) => s.runStatus === "running");

  if (!node) {
    return (
      <aside
        className="clip-inspector relative flex h-full w-80 shrink-0 flex-col items-center justify-center border-l border-white/10 bg-[#15161c] p-6 text-center text-zinc-100"
        style={{ fontFamily: "var(--font-manrope), ui-sans-serif, system-ui, sans-serif" }}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Hide inspector"
            aria-label="Hide inspector"
            className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
          >
            <PanelRightClose className="size-4" />
          </button>
        )}
        <SlidersHorizontal className="size-6 text-muted-foreground/40" />
        <div className="mt-3 text-sm font-medium">No node selected</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Click a node on the canvas to edit its settings.
        </div>
      </aside>
    );
  }

  const v = nodeVisual(node.data);
  const Icon = v.icon;
  const conns = edges.filter((e) => e.source === node.id || e.target === node.id);
  const nameOf = (id: string) => allNodes.find((n) => n.id === id)?.data.title ?? id;

  return (
    <aside
      className="clip-inspector flex h-full w-80 shrink-0 flex-col border-l border-white/10 bg-[#15161c] text-zinc-100"
      style={{ fontFamily: "var(--font-manrope), ui-sans-serif, system-ui, sans-serif" }}
    >
      <div className="flex items-center gap-2.5 border-b px-4 py-3">
        <span
          className="flex size-8 items-center justify-center rounded-lg"
          style={{
            background: `color-mix(in oklch, ${v.accent} 20%, transparent)`,
            color: v.accent,
          }}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{node.data.title}</div>
          <div className="text-xs capitalize text-muted-foreground">
            {node.data.status}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Hide inspector"
            aria-label="Hide inspector"
            className="shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
          >
            <PanelRightClose className="size-4" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`space-y-4 p-4 ${running ? "pointer-events-none opacity-50" : ""}`}>
          {running && (
            <div className="pointer-events-auto rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[11px] text-amber-200">
              Pipeline running - canvas is locked until it finishes.
            </div>
          )}
          {/* key by node.id: force a fresh mount whenever the selected node changes
              so no config component ever shows a previously-selected node's state
              (was causing the inspector to open the wrong skill's settings). */}
          <NodeForm key={node.id} node={node} onNavigateToPosting={onNavigateToPosting} mintAddress={mintAddress} clipConfig={clipConfig} />

          <div className="space-y-1.5 border-t border-white/10 pt-4">
            <Label className="text-xs text-muted-foreground">Connections</Label>
            {conns.length === 0 ? (
              <div className="text-xs text-zinc-500">Not connected to anything yet.</div>
            ) : (
              conns.map((e) => {
                const incoming = e.target === node.id;
                const other = incoming ? e.source : e.target;
                return (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs"
                  >
                    <span className="shrink-0 text-zinc-500">{incoming ? "← from" : "→ to"}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-100">{nameOf(other)}</span>
                    <button
                      type="button"
                      title="Detach connection"
                      onClick={() => removeEdge(e.id)}
                      className="shrink-0 text-zinc-400 transition-colors hover:text-red-400"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      <div className="space-y-2 border-t p-3">
        {/* "Add skill" only on the Compose hub (its purpose: skills fan around it).
            Skill / Publish / Source nodes hide it - skills are added by dragging
            from the Marketplace/Library, so the button just cluttered those cards. */}
        {node.data.kind === "compose" && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="w-full" />}>
              <Plus className="size-4" />
              Add skill
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {availableSkills.length === 0 ? (
                <DropdownMenuItem disabled>No skills yet - install from Marketplace</DropdownMenuItem>
              ) : (
                availableSkills.map((s) => (
                  <DropdownMenuItem
                    key={s.skillId}
                    onClick={() => addConnectedSkill(node.id, { skillId: s.skillId, name: s.name })}
                  >
                    <span className="mr-1.5">{s.icon}</span>
                    {s.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="outline"
          className="w-full"
          disabled={!node.data.output}
          onClick={() => setPreview(node.id)}
        >
          <Eye className="size-4" />
          View last output
        </Button>
        <Button
          variant="ghost"
          className="w-full text-destructive hover:text-destructive"
          onClick={() => removeNode(node.id)}
        >
          <Trash2 className="size-4" />
          Remove node
        </Button>
      </div>
    </aside>
  );
}

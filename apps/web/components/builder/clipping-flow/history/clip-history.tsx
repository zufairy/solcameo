"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clapperboard, Download, Loader2, Send, ExternalLink, Trash2 } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { loadClipHistory, removeClipFromHistory, type ClipHistoryItem, type ClipStatus } from "@/components/builder/clipping-flow/lib/clipHistoryStorage";
import { isPlaceholderClipTitle } from "@/lib/clip/placeholderTitle";
import { ConfirmDeleteDialog, postDelete } from "@/components/ui/confirm-delete-dialog";

function DeleteClipButton({ title, onDelete }: { title: string; onDelete: () => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const message = await onDelete();
    setBusy(false);
    if (message) setError(message);
    else setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true); }}
        title="Delete video"
        aria-label={`Delete ${title || "video"}`}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.07] text-zinc-500 backdrop-blur-xl transition-colors hover:bg-rose-500/15 hover:text-rose-300"
      >
        <Trash2 className="size-3.5" />
      </button>
      <ConfirmDeleteDialog
        open={open}
        title="Delete this video?"
        description="This permanently removes the video and cancels any scheduled posts for it. This cannot be undone."
        busy={busy}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={() => { if (!busy) setOpen(false); }}
      />
    </>
  );
}

/**
 * "3h ago" — how long since the clip was generated, with the exact timestamp kept
 * in the `title` attribute so the precise date is one hover away. Relative time is
 * what an operator actually reads at a glance; the absolute date matters only when
 * they are reconciling a specific post.
 */
function relativeTime(ts: number | undefined): { label: string; exact: string } {
  if (!ts || !Number.isFinite(ts)) return { label: "", exact: "" };
  const exact = new Date(ts).toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return { label: "just now", exact };
  const mins = Math.round(secs / 60);
  if (mins < 60) return { label: `${mins}m ago`, exact };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { label: `${hours}h ago`, exact };
  const days = Math.round(hours / 24);
  if (days < 7) return { label: `${days}d ago`, exact };
  const weeks = Math.round(days / 7);
  if (weeks < 5) return { label: `${weeks}w ago`, exact };
  // Past a month, "9w ago" stops meaning anything — show the date itself.
  return { label: new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" }), exact };
}

/** Seconds → "MM:SS" for the duration pill on the thumbnail. */
function fmtMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** DB clip status → the compact display status used on the card. */
const DB_STATUS: Record<string, ClipStatus> = {
  ready: "done", rendering: "pending", posting: "posting", posted: "posted", failed: "failed",
};

/**
 * Builder "Generations" tab - the clips this agent has generated. The AUTHORITATIVE
 * source is the backend `clips` table (survives cache clears, other devices, and
 * autonomous runs); the per-agent localStorage index is merged in for draft/session
 * runs not yet minted. Renders each clip as a card (inline preview + meta + download).
 * Previously localStorage-only, so a real agent with clips in the DB but an empty
 * localStorage wrongly showed "No clips yet" — fixed by reading the DB too.
 */
export function ClipHistory({ historyKey, mintAddress, agentName }: { historyKey: string; mintAddress?: string; agentName?: string }) {
  const [local, setLocal] = useState<ClipHistoryItem[]>([]);
  const refresh = useCallback(() => {
    setLocal(loadClipHistory(historyKey));
  }, [historyKey]);
  useEffect(() => { refresh(); }, [refresh]);

  // Backend clips for this agent (only with a real video URL — a failed/skipped
  // clip with no URL is not a "video"). Skipped for draft/unminted agents.
  const dbClips = useQuery(
    api.clipJobs.listClipsByMint,
    mintAddress ? { mintAddress } : "skip",
  ) as Array<{ _id: string; title: string; clipUrl?: string; viralScore: number; status: string; startSeconds: number; endSeconds: number; createdAt: number; postUrl?: string; captionText?: string; platformPostId?: string; uploadPostRequestId?: string }> | undefined;

  // Which clip is mid-publish, and any error to show on its card. Keyed by clip id
  // so one failing post can't blank the whole grid.
  const [publishing, setPublishing] = useState<string | null>(null);
  const [postError, setPostError] = useState<Record<string, string>>({});

  /**
   * Publish a clip to every connected account.
   *
   * Empty `platforms` means "everywhere connected" — the route resolves the agent's
   * live connections, so this cannot go stale the way a client-side list does. The
   * route also CLAIMS the clip (ready→posting→posted), which is what stops the drip
   * cron from publishing the same video a second time. On success the clips row gains
   * its postUrl and the query re-renders the card into "View post" on its own.
   */
  // Re-checks a posted clip's permalink from the ids recorded at post time.
  const [linking, setLinking] = useState<string | null>(null);
  const resolveLink = useCallback(async (id: string, clipUrl: string) => {
    if (!mintAddress || linking) return;
    setLinking(id);
    setPostError((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch("/api/social/clip-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, clipUrl }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; postUrl?: string; reason?: string; error?: string };
      // The row now carries the postUrl, so the reactive query flips this card to
      // "View post" on its own — nothing to set here on success.
      if (!j.ok) {
        setPostError((e) => ({
          ...e,
          [id]: j.reason === "not_indexed_yet" ? "The platform hasn't published the link yet, try again shortly."
            : j.reason === "no_post_identity" ? "No post id was recorded for this clip, so the link can't be looked up."
            : j.error ?? "Couldn't find the link.",
        }));
      }
    } catch (e) {
      setPostError((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : "lookup failed" }));
    } finally {
      setLinking(null);
    }
  }, [mintAddress, linking]);

  const publish = useCallback(async (clip: { id: string; clipUrl: string; title?: string }) => {
    if (!mintAddress || publishing) return;
    setPublishing(clip.id);
    setPostError((e) => ({ ...e, [clip.id]: "" }));
    try {
      const res = await fetch("/api/social/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: mintAddress,
          platforms: [],
          type: "video",
          title: clip.title || "New clip",
          description: clip.title || "",
          mediaUrls: [clip.clipUrl],
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; alreadyPosted?: boolean; reason?: string };
      if (j.alreadyPosted) return; // the row already carries its postUrl
      if (!res.ok || j.ok === false) {
        // Translate machine error codes into human-readable messages.
        const reason = j.reason ?? "";
        const msg =
          reason === "posting_in_progress"
            ? "Already publishing, the clip is being posted now. Refresh in a moment."
            : j.error ?? reason ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
    } catch (e) {
      setPostError((prev) => ({ ...prev, [clip.id]: e instanceof Error ? e.message : "post failed" }));
    } finally {
      setPublishing(null);
    }
  }, [mintAddress, publishing]);

  // Merge DB (authoritative, keyed by clipUrl) with localStorage-only items, so a
  // clip shows once whether it's synced or a fresh draft-session render.
  const items = useMemo<ClipHistoryItem[]>(() => {
    const byUrl = new Map<string, ClipHistoryItem>();
    for (const c of dbClips ?? []) {
      if (!c.clipUrl) continue; // no video yet → don't surface (keeps the "has video" contract)
      byUrl.set(c.clipUrl, {
        id: c._id,
        clipUrl: c.clipUrl,
        title: c.title,
        durationSeconds: Math.max(0, Math.round(c.endSeconds - c.startSeconds)),
        sourceUrl: "",
        viralScore: c.viralScore,
        status: DB_STATUS[c.status] ?? "done",
        createdAt: c.createdAt,
        ...(c.postUrl ? { postUrl: c.postUrl } : {}),
        ...(c.captionText ? { captionText: c.captionText } : {}),
        // The raw DB status (not the narrowed display status) — "posted" has to be
        // distinguishable from "ready" even before a permalink exists.
        ...(c.status ? { dbStatus: c.status } : {}),
      } as ClipHistoryItem & { postUrl?: string; captionText?: string; dbStatus?: string });
    }
    // localStorage items fill in anything the DB doesn't have (unsynced/draft).
    const extra = local.filter((c) => !(c.clipUrl && byUrl.has(c.clipUrl)));
    // Newest first — now that each card is timestamped, an unordered grid reads as
    // broken. Undated items sort last rather than jumping to the top.
    return [...byUrl.values(), ...extra].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [dbClips, local]);

  const dbClipIds = useMemo(() => new Set((dbClips ?? []).map((clip) => String(clip._id))), [dbClips]);
  const deleteClip = useCallback(async (clip: ClipHistoryItem): Promise<string | null> => {
    if (dbClipIds.has(clip.id)) {
      if (!mintAddress) return "This agent must be minted before its video can be deleted.";
      const error = await postDelete("/api/clips/delete", { clipId: clip.id, mintAddress });
      if (error) return error;
    }
    setLocal(removeClipFromHistory(historyKey, { id: clip.id, clipUrl: clip.clipUrl }));
    return null;
  }, [dbClipIds, historyKey, mintAddress]);

  if (items.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <Clapperboard className="mx-auto size-7 text-zinc-500" />
          <div className="mt-3 text-xl font-bold text-white">No clips yet</div>
          <div className="mt-1 text-sm text-zinc-500">
            Run the pipeline in the Clipping tab to start generating clips on this agent.
          </div>
        </div>
      </div>
    );
  }

  const hasUrl = (u: string) => /^https?:\/\//i.test(u);

  return (
    <div>
      <p className="text-[12px] text-zinc-500">
        {items.length} clip{items.length === 1 ? "" : "s"} generated on this agent.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((c) => (
          <div key={c.id} className="group">
            {/* No card chrome, the thumbnail sits flush against the page,
                just a duration pill floating on top (frosted, no outline). */}
            <div className="relative overflow-hidden rounded-xl bg-black">
              {hasUrl(c.clipUrl) ? (
                <video src={c.clipUrl} controls preload="metadata" className="aspect-[9/16] w-full bg-black object-contain" />
              ) : (
                <div className="grid aspect-[9/16] w-full place-items-center bg-white/[0.03] text-zinc-600">
                  <Clapperboard className="size-8" />
                </div>
              )}
              {c.durationSeconds ? (
                <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/55 backdrop-blur-md px-2.5 py-1 font-mono text-[11px] text-white/90">
                  00:00 <span className="text-white/50">{fmtMMSS(c.durationSeconds)}</span>
                </span>
              ) : null}
            </div>

            {/* Frosted glassmorphic icon row, no outline, just blur + a faint tint. */}
            <div className="mt-2.5 flex items-center gap-2">
              {hasUrl(c.clipUrl) && (
                <a
                  href={c.clipUrl}
                  download
                  title="Download"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-zinc-300 backdrop-blur-xl transition-colors hover:bg-white/20 hover:text-white"
                >
                  <Download className="size-3.5" />
                </a>
              )}
              {/* Publish / View post, same frosted circular language, tinted by state. */}
              {hasUrl(c.clipUrl) && (() => {
                const row = c as ClipHistoryItem & { postUrl?: string; dbStatus?: string };
                const posted = row.postUrl;
                // A clip can be genuinely posted with no permalink yet — the platform
                // indexes a few seconds later and the post path stops polling. Treat
                // the STATUS as the truth for "already published" so the card never
                // offers to post it a second time.
                const isPosted = !posted && (row.dbStatus === "posted" || c.status === "posted");

                if (row.dbStatus === "guardrail_rejected") {
                  return (
                    <span title="Guardrails blocked this clip" className="grid size-8 shrink-0 place-items-center rounded-full bg-purple-400/15 text-purple-300 backdrop-blur-xl">
                      🛡
                    </span>
                  );
                }
                if (row.dbStatus === "posting") {
                  return (
                    <span title="Publishing…" className="grid size-8 shrink-0 place-items-center rounded-full bg-sky-400/15 text-sky-300 backdrop-blur-xl">
                      <Loader2 className="size-3.5 animate-spin" />
                    </span>
                  );
                }
                if (!posted && isPosted) {
                  const looking = linking === c.id;
                  return (
                    <button
                      type="button"
                      onClick={() => void resolveLink(c.id, c.clipUrl)}
                      disabled={looking}
                      title={looking ? "Finding link…" : "Posted, click to check if the platform has published the link yet."}
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-sky-400/15 text-sky-300 backdrop-blur-xl transition-colors hover:bg-sky-400/25 disabled:opacity-70"
                    >
                      {looking ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                    </button>
                  );
                }
                if (posted) {
                  return (
                    <a
                      href={posted}
                      target="_blank"
                      rel="noreferrer noopener"
                      title="View post"
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-sky-400/15 text-sky-300 backdrop-blur-xl transition-colors hover:bg-sky-400/25"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  );
                }
                const busy = publishing === c.id;
                return (
                  <button
                    type="button"
                    onClick={() => void publish({ id: c.id, clipUrl: c.clipUrl, title: c.title })}
                    // Disabled while ANY card is publishing: these all post to the
                    // same connected accounts, and firing a second upload mid-flight
                    // is how you get two videos out of one click.
                    disabled={!!publishing || !mintAddress}
                    title={!mintAddress ? "Mint the agent to publish" : busy ? "Publishing…" : "Publish"}
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-lime-400/15 text-lime-300 backdrop-blur-xl transition-colors hover:bg-lime-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  </button>
                );
              })()}
              <DeleteClipButton title={c.title} onDelete={() => deleteClip(c)} />
            </div>
            {postError[c.id] && <p className="mt-1 text-[10.5px] text-rose-400">{postError[c.id]}</p>}

            {/* Apple-style caption block, clean sans, no mono metadata line. */}
            <div className="mt-2.5">
              {(() => {
                const caption = (c as ClipHistoryItem & { captionText?: string }).captionText?.trim();
                // Clips rendered before descriptions existed carry only a
                // placeholder title. Rather than "Untitled clip", fall back to the
                // agent's own name — the operator recognises it, and the date below
                // already distinguishes one card from another.
                const label = caption
                  || (isPlaceholderClipTitle(c.title) ? "" : c.title?.trim())
                  || (agentName ? `${agentName} clip` : "")
                  || "Untitled clip";
                return (
                  <div className="line-clamp-2 text-[16px] font-medium leading-snug text-white/90" title={label}>
                    {label}
                  </div>
                );
              })()}
              {relativeTime(c.createdAt).label && (
                <div className="mt-1 text-[12.5px] text-zinc-500" title={relativeTime(c.createdAt).exact}>
                  {relativeTime(c.createdAt).label}
                  {typeof c.viralScore === "number" ? ` · Virality ${c.viralScore}/100` : ""}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Per-agent history of generated clips, persisted in localStorage (mirrors
// clipGraphStorage). The clip bytes live in Convex storage at `clipUrl`; this
// just indexes what each agent has produced so the History tab can list them.
export type ClipStatus = "done" | "pending" | "scheduled" | "posting" | "posted" | "failed";

export interface ClipHistoryItem {
  id: string;
  clipUrl: string;
  title: string;
  durationSeconds: number;
  sourceUrl: string;
  /** Virality score (0-100) + one-word emotion from the analysis ranking. */
  viralScore?: number;
  emotion?: string;
  /** Lifecycle tag shown in the History tab. Rendered clips start "done";
      drip-scheduling moves them scheduled → posting → posted/failed. */
  status?: ClipStatus;
  /** Set true once this entry's clip has been backfilled into the Convex `clips`
      table (via /api/clips/record). recordCanvasClips creates NEW rows each call,
      so this flag is the ONLY idempotency guard - never re-POST a synced entry. */
  syncedToDb?: boolean;
  createdAt: number;
}

const HISTORY_LIMIT = 50;
export const clipHistoryKey = (mintKey: string) => `vello-cliphistory:${mintKey}`;

export function loadClipHistory(mintKey: string): ClipHistoryItem[] {
  try {
    const raw = localStorage.getItem(clipHistoryKey(mintKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClipHistoryItem[]) : [];
  } catch {
    return [];
  }
}

export function addClipToHistory(mintKey: string, item: ClipHistoryItem): ClipHistoryItem[] {
  const next = [item, ...loadClipHistory(mintKey).filter((c) => c.id !== item.id)].slice(0, HISTORY_LIMIT);
  try {
    localStorage.setItem(clipHistoryKey(mintKey), JSON.stringify(next));
  } catch {
    /* quota / SSR - ignore */
  }
  return next;
}

/** Remove a clip from the browser-side index. Matching the URL as well as the
 * local id prevents a synced clip from reappearing after its database row is
 * deleted, because the database and localStorage records use different ids. */
export function removeClipFromHistory(
  mintKey: string,
  match: { id?: string; clipUrl?: string },
): ClipHistoryItem[] {
  const next = loadClipHistory(mintKey).filter((clip) => (
    (!match.id || clip.id !== match.id)
    && (!match.clipUrl || clip.clipUrl !== match.clipUrl)
  ));
  try {
    localStorage.setItem(clipHistoryKey(mintKey), JSON.stringify(next));
  } catch {
    /* quota / SSR - ignore */
  }
  return next;
}

/** Update one history item's status (e.g. when a drip post schedules/lands). */
export function setClipStatus(mintKey: string, id: string, status: ClipStatus): ClipHistoryItem[] {
  const next = loadClipHistory(mintKey).map((c) => (c.id === id ? { ...c, status } : c));
  try {
    localStorage.setItem(clipHistoryKey(mintKey), JSON.stringify(next));
  } catch {
    /* quota / SSR - ignore */
  }
  return next;
}

/** True only for entries that can be backfilled: a real https clipUrl AND not
 *  yet pushed to the `clips` table. (Old localStorage entries predate syncedToDb,
 *  so an undefined flag means "not synced".) */
function isUnsynced(c: ClipHistoryItem): boolean {
  return c.syncedToDb !== true && typeof c.clipUrl === "string" && /^https:\/\//i.test(c.clipUrl);
}

/** The local clips that still need backfilling into Convex - those with a real
 *  https clipUrl and no syncedToDb flag. Drives the "Sync N old clips" button. */
export function unsyncedClips(mintKey: string): ClipHistoryItem[] {
  return loadClipHistory(mintKey).filter(isUnsynced);
}

/** Mark the given history entries as backfilled so the next backfill skips them.
 *  Idempotency lives here: recordCanvasClips inserts fresh rows on every call, so
 *  only entries WITHOUT this flag are ever POSTed. */
export function markClipsSynced(mintKey: string, ids: string[]): ClipHistoryItem[] {
  const idSet = new Set(ids);
  const next = loadClipHistory(mintKey).map((c) => (idSet.has(c.id) ? { ...c, syncedToDb: true } : c));
  try {
    localStorage.setItem(clipHistoryKey(mintKey), JSON.stringify(next));
  } catch {
    /* quota / SSR - ignore */
  }
  return next;
}

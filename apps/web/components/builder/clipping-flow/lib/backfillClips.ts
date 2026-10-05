// Backfill OLD canvas-run clips that were only ever saved to browser
// localStorage (via clipHistoryStorage) into the Convex `clips` table, so they
// finally appear in the Creations tab + the builder clips queue.
//
// New canvas runs persist automatically (ClippingFlowCanvas POSTs the finished
// batch to /api/clips/record). This is the one-time catch-up for entries that
// predate that write path. The same route + Convex mutation are reused - NO new
// Convex function.
//
// IDEMPOTENCY (critical): api.clipJobs.recordCanvasClips inserts NEW rows on
// every call, so we must never POST the same entry twice. After a successful
// POST we stamp each entry `syncedToDb: true` (markClipsSynced) and only ever
// backfill entries that lack the flag (unsyncedClips). Re-running is a no-op.
import {
  unsyncedClips,
  markClipsSynced,
  type ClipHistoryItem,
} from "@/components/builder/clipping-flow/lib/clipHistoryStorage";

export interface BackfillResult {
  /** Clips successfully written to the `clips` table this run. */
  synced: number;
  /** Eligible local clips that were attempted (unsynced + https clipUrl). */
  attempted: number;
}

/** Map a localStorage history entry to the shape /api/clips/record expects.
 *  The history entry only carries clipUrl + title (+ maybe viralScore); the rest
 *  default safely - reason "", captionText "", start/end 0. */
function toRecordClip(c: ClipHistoryItem) {
  return {
    title: typeof c.title === "string" && c.title ? c.title : "Clip",
    reason: "",
    clipUrl: c.clipUrl,
    viralScore: typeof c.viralScore === "number" ? c.viralScore : 0,
    captionText: "",
    startSeconds: 0,
    endSeconds: 0,
  };
}

/**
 * Push every not-yet-synced local clip for `mintAddress` into the `clips` table.
 *
 * `historyKey` is the localStorage namespace (mintAddress for a minted agent).
 * Only a real minted agent can be backfilled - the route is mint-keyed and
 * ownership-checked - so pass the agent's on-chain mint as `mintAddress`.
 *
 * Auth: the global fetch interceptor attaches the Bearer + X-Siws-Session
 * headers to every /api/ call, so a plain fetch is correctly authenticated
 * (same as NftMintCard / ClipUrlInput).
 *
 * Best-effort: throws on a network/route failure (caller surfaces it); already
 * synced clips stay synced because we only mark AFTER a successful POST.
 */
export async function backfillLocalClips(
  historyKey: string,
  mintAddress: string,
): Promise<BackfillResult> {
  const eligible = unsyncedClips(historyKey);
  if (eligible.length === 0) return { synced: 0, attempted: 0 };

  const res = await fetch("/api/clips/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mintAddress,
      sourceUrl: "",
      clips: eligible.map(toRecordClip),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Sync failed (${res.status})`);
  }

  // Only NOW - after the rows are written - flip the idempotency flag, so a
  // failure leaves the entries unsynced and retryable.
  markClipsSynced(historyKey, eligible.map((c) => c.id));
  return { synced: eligible.length, attempted: eligible.length };
}

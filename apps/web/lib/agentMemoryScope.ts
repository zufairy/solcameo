// Which identity an agent's episodic memory is scoped to.
//
// Memory used to be keyed ONLY by `mintAddress`, and every pre-mint agent wrote
// under `mintAddress = ""`. That pooled every project's memories into one shared
// bucket, so the builder graph (and any recall with an empty mint) surfaced other
// projects' memories. Memory now follows a per-project identity that exists
// pre-mint — the builder `sessionId` — and promotes to the real `mintAddress`
// once the agent is minted (mirroring how `agentKnowledge` is session-scoped).
//
// The critical rule: an EMPTY identity resolves to `none`, never to a shared
// empty-string query — so a project can never read another project's memory.

export type MemoryScope =
  | { by: "mint"; value: string }
  | { by: "session"; value: string }
  | { by: "none" };

/**
 * Decide how to scope a memory read/write from the (optional) mint + session.
 * A real mint wins (post-mint agents); otherwise the session (pre-mint project);
 * if neither is a non-blank string, returns `{ by: "none" }` so callers return
 * nothing instead of leaking the global empty-key bucket.
 */
export function resolveMemoryScope(
  mintAddress?: string | null,
  sessionId?: string | null,
): MemoryScope {
  const mint = (mintAddress ?? "").trim();
  if (mint) return { by: "mint", value: mint };
  const session = (sessionId ?? "").trim();
  if (session) return { by: "session", value: session };
  return { by: "none" };
}

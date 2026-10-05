/** Idempotent publishing: given earlier post_content tasks for an agent, decide
 *  what a new post call carrying `key` should do. A post that outlived its
 *  caller's timeout still publishes server-side; without this, each retry of
 *  the same schedule row published the video again (the "posted 3-4 times" bug). */
export type PriorTask = { _id: string; type: string; status: string; input?: string; output?: string; startedAt?: number; _creationTime: number };
export type PostDecision =
  | { kind: "already_posted"; taskId: string; output: Record<string, unknown> }
  | { kind: "in_progress"; taskId: string }
  | { kind: "post" };

/** An earlier attempt still "running" past this is presumed dead (run-task's
 *  own wall is 5 min), so a fresh attempt is allowed. */
export const STILL_RUNNING_MS = 20 * 60_000;

export function decidePostIdempotency(tasks: PriorTask[], key: string, now = Date.now()): PostDecision {
  const needle = `"idempotencyKey":${JSON.stringify(key)}`;
  const prior = tasks.filter((t) => t.type === "post_content" && typeof t.input === "string" && t.input.includes(needle));
  for (const t of prior) {
    if (t.status !== "succeeded" || !t.output) continue;
    try {
      const out = JSON.parse(t.output) as Record<string, unknown>;
      if (out.status === "posted") return { kind: "already_posted", taskId: t._id, output: out };
    } catch { /* unparseable — not proof of a publish */ }
  }
  const running = prior.find((t) => (t.status === "running" || t.status === "pending") && now - (t.startedAt ?? t._creationTime) < STILL_RUNNING_MS);
  if (running) return { kind: "in_progress", taskId: running._id };
  return { kind: "post" };
}

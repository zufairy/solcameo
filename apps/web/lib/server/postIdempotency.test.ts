import { describe, it, expect } from "vitest";
import { decidePostIdempotency, type PriorTask } from "./postIdempotency";

const NOW = 1_000_000_000;
const task = (p: Partial<PriorTask>): PriorTask => ({
  _id: "t", type: "post_content", status: "succeeded", _creationTime: NOW - 60_000,
  input: JSON.stringify({ mediaUrl: "x.mp4", idempotencyKey: "sched:row1" }), ...p,
});

describe("decidePostIdempotency", () => {
  it("never re-posts a schedule row that already published", () => {
    const d = decidePostIdempotency([task({ _id: "a", output: JSON.stringify({ status: "posted", postUrl: "https://tiktok/1" }) })], "sched:row1", NOW);
    expect(d).toEqual({ kind: "already_posted", taskId: "a", output: { status: "posted", postUrl: "https://tiktok/1" } });
  });
  it("waits while an earlier attempt is still publishing (the timed-out case)", () => {
    expect(decidePostIdempotency([task({ _id: "b", status: "running", startedAt: NOW - 5 * 60_000 })], "sched:row1", NOW).kind).toBe("in_progress");
  });
  it("allows a retry when earlier attempts failed or never published", () => {
    expect(decidePostIdempotency([
      task({ status: "failed" }),
      task({ status: "succeeded", output: JSON.stringify({ status: "skipped" }) }),
      task({ status: "running", startedAt: NOW - 60 * 60_000 }), // long dead
    ], "sched:row1", NOW).kind).toBe("post");
  });
  it("only matches the same key (other rows / other videos are independent)", () => {
    expect(decidePostIdempotency([task({ output: JSON.stringify({ status: "posted" }) })], "sched:row2", NOW).kind).toBe("post");
    expect(decidePostIdempotency([task({ type: "create_video", output: JSON.stringify({ status: "posted" }) })], "sched:row1", NOW).kind).toBe("post");
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  approvePlan, approveResult, getThread, rejectResult, reportClipJobs, reportVideoTask, updateThread,
  type ChatMessage, type Plan,
} from "./store";

const KEY = "team:m1";
const MSG = "plan-msg";

function seedPlan(plan: Plan) {
  const m: ChatMessage = { id: MSG, role: "assistant", content: "Here's the plan", at: 1, speaker: "A", plan };
  updateThread(KEY, () => ({ messages: [m], sending: false }));
}
const plan = () => getThread(KEY).messages.find((m) => m.id === MSG)!.plan!;
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.unstubAllGlobals());

describe("mission runner (approval-first)", () => {
  it("runs a video → clip hand-off end to end, and only posts what the owner approves", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (url === "/api/agents/run-task" && body.taskType === "create_video") return new Response(JSON.stringify({ ok: true, taskId: "task1", async: true }));
      if (url === "/api/agents/run-task" && body.taskType === "clip_source") return new Response(JSON.stringify({ ok: true, taskId: "task2", output: { jobIds: ["job1"] } }));
      if (url === "/api/schedule/create") return new Response(JSON.stringify({ ok: true }));
      return new Response("{}", { status: 404 });
    }));

    seedPlan({
      id: "p1", title: "Raya push", status: "proposed",
      steps: [
        { id: "s1", agentMint: "A", agentName: "Fikri", kind: "create_video", topic: "Raya fit check", status: "proposed" },
        { id: "s2", agentMint: "B", agentName: "Clipzy", kind: "clip_video", sourceStep: 0, status: "proposed" },
      ],
    });

    // Nothing runs until approval.
    expect(calls).toHaveLength(0);
    approvePlan(KEY, MSG);
    await flush(); await flush();

    // Step 1 starts in hold-for-approval mode; step 2 waits on the hand-off.
    expect(calls.map((c) => c.body.taskType)).toEqual(["create_video"]);
    expect((calls[0].body.input as Record<string, unknown>).holdForApproval).toBe(true);
    expect(plan().steps.map((s) => s.status)).toEqual(["running", "queued"]);

    // Render finishes → review + narration → hand-off starts with the new video.
    reportVideoTask(KEY, MSG, "s1", { status: "succeeded", videoUrl: "https://cdn/v1.mp4" });
    await flush(); await flush();
    expect(plan().steps[0].status).toBe("review");
    const clipCall = calls.find((c) => c.body.taskType === "clip_source")!;
    expect(clipCall.body.input).toEqual({ sourceUrl: "https://cdn/v1.mp4", holdForApproval: true });
    expect(plan().steps[1].status).toBe("running");
    expect(getThread(KEY).messages.some((m) => m.speaker === "A" && /ready/i.test(m.content))).toBe(true);

    // Clips land → review.
    reportClipJobs(KEY, MSG, "s2", [{ status: "completed" }], [
      { clipUrl: "https://cdn/c1.mp4", title: "c1", captionText: "cap1", status: "ready" },
      { clipUrl: "https://cdn/c2.mp4", title: "c2", captionText: "cap2", status: "ready" },
    ]);
    expect(plan().steps[1].results?.map((r) => r.status)).toEqual(["review", "review"]);
    expect(calls.some((c) => c.url === "/api/schedule/create")).toBe(false); // nothing auto-posted

    // Owner approves the video + one clip, skips the other.
    await approveResult(KEY, MSG, "s1", 0, { caption: "Raya ready ✨", platforms: ["tiktok"] });
    await approveResult(KEY, MSG, "s2", 0, { caption: "cap1", platforms: ["youtube"] });
    rejectResult(KEY, MSG, "s2", 1);
    await flush();

    const posts = calls.filter((c) => c.url === "/api/schedule/create").map((c) => c.body);
    expect(posts).toEqual([
      expect.objectContaining({ mintAddress: "A", videoUrl: "https://cdn/v1.mp4", caption: "Raya ready ✨", platforms: ["tiktok"] }),
      expect.objectContaining({ mintAddress: "B", videoUrl: "https://cdn/c1.mp4", platforms: ["youtube"] }),
    ]);
    expect(plan().steps.map((s) => s.status)).toEqual(["posted", "posted"]);
    expect(plan().status).toBe("done");
    expect(getThread(KEY).messages.at(-1)?.content).toMatch(/2 videos scheduled/);
  });

  it("fails a hand-off cleanly when its source video never gets made", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, taskId: "t", async: true }))));
    seedPlan({
      id: "p2", title: "x", status: "proposed",
      steps: [
        { id: "s1", agentMint: "A", agentName: "Fikri", kind: "create_video", topic: "t", status: "proposed" },
        { id: "s2", agentMint: "B", agentName: "Clipzy", kind: "clip_video", sourceStep: 0, status: "proposed" },
      ],
    });
    approvePlan(KEY, MSG);
    await flush(); await flush();
    reportVideoTask(KEY, MSG, "s1", { status: "failed", error: "Render timed out." });
    await flush();
    expect(plan().steps.map((s) => s.status)).toEqual(["failed", "failed"]);
    expect(plan().steps[1].error).toMatch(/step 1/);
    expect(plan().status).toBe("done");
  });
});

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireAuth } from "@/lib/server/requireAuth";
import type { Id } from "@/convex/_generated/dataModel";

// Fires the swarm: pre-creates one pending agentTasks row per brief (so the
// client can subscribe to generationStatus immediately), returns the ids, then
// drains the queue in the BACKGROUND by calling run-task server-to-server with
// the internal secret (the swarm uses roster agents the caller doesn't own —
// the browser can't call owner-gated run-task for them). Railway is a
// long-lived Node process, so the post-response drain keeps running.
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ITEMS = 100;
// Simultaneous run-task calls. The whole swarm fires together — each call does
// the script LLM pass then defers the render to the background job chain, so
// this only gates LLM/API pressure. 12 keeps a 100-item swarm's total dispatch
// under ~4 minutes while all renders queue in parallel.
const DISPATCH_CONCURRENCY = 12;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: {
    items?: { mintAddress?: string; topic?: string }[];
    productImageUrl?: string;
    /** Product grounding (user prompt + AI summary) — appended to every brief so
     *  each persona's script writer knows the ACTUAL product, not just the angle. */
    productContext?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const items = (body.items ?? [])
    .filter((i) => typeof i.mintAddress === "string" && i.mintAddress && typeof i.topic === "string" && i.topic!.trim())
    .map((i) => ({ mintAddress: i.mintAddress!, topic: i.topic!.trim().slice(0, 500) }))
    .slice(0, MAX_ITEMS);
  if (items.length === 0) return NextResponse.json({ ok: false, error: "No items to launch" }, { status: 400 });

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!CONVEX_URL || !secret) return NextResponse.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const productImageUrl = body.productImageUrl?.trim() || undefined;
  const productContext = (body.productContext ?? "").trim().slice(0, 1500);
  // The topic each script pass receives = the unique persona brief + the shared
  // product grounding, so every video is on-persona AND on-product.
  const topicFor = (t: string) => (productContext ? `${t}\n\nPRODUCT CONTEXT (ground every claim in this): ${productContext}` : t);

  // 1. Pre-create every task row (pending) so the launch is atomic from the
  //    client's point of view: it gets ALL ids back at once and just watches.
  const created: { taskId: string; mintAddress: string; topic: string }[] = [];
  for (const item of items) {
    const taskId = (await convex.mutation(api.agentTasks.create, {
      mintAddress: item.mintAddress,
      sessionId: `swarm:${auth.user.id}`,
      type: "create_video",
      title: `Swarm: ${item.topic.slice(0, 60)}`,
      input: JSON.stringify({ topic: topicFor(item.topic), ...(productImageUrl ? { productImageUrl } : {}) }),
      triggeredBy: "content_swarm",
      status: "pending",
      authSecret: secret,
    })) as Id<"agentTasks">;
    created.push({ taskId, mintAddress: item.mintAddress, topic: item.topic });
  }

  // 2. Background drain — claim + run each pending task through the normal
  //    create_video pipeline. Errors are per-task (run-task marks the row
  //    failed via its claim/failPreflight path); the drain itself never throws.
  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  void (async () => {
    let cursor = 0;
    async function worker() {
      while (cursor < created.length) {
        const t = created[cursor++];
        try {
          await fetch(`${origin}/api/agents/run-task`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Internal-Secret": secret },
            body: JSON.stringify({
              mintAddress: t.mintAddress,
              taskType: "create_video",
              taskId: t.taskId,
              title: `Swarm: ${t.topic.slice(0, 60)}`,
              input: {
                topic: topicFor(t.topic),
                taskId: t.taskId,
                ...(productImageUrl ? { productImageUrl, campaignImageUrls: [productImageUrl] } : {}),
              },
              triggeredBy: "content_swarm",
            }),
            // Script pass can take a while; don't let the default fetch timeout kill it.
            signal: AbortSignal.timeout(280_000),
          });
        } catch (e) {
          console.warn(`[swarm/launch] dispatch failed for task ${t.taskId}:`, e instanceof Error ? e.message : e);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(DISPATCH_CONCURRENCY, created.length) }, () => worker()));
    console.log(`[swarm/launch] drained ${created.length} tasks for ${auth.user.id}`);
  })();

  return NextResponse.json({ ok: true, taskIds: created.map((c) => c.taskId) });
}

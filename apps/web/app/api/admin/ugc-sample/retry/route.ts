import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import {
  runConceptSlot, runStorySlot, runCarouselSlot,
  type ClientType, type UgcConcept, type UgcSlotCtx,
} from "@/lib/server/ugcSampleWorkers";

// Retry ONE slot of an existing UGC-sample run — everything the worker needs is
// rebuilt from the persisted run doc, so a single failed card re-runs alone
// instead of burning a whole new 6-slot generation.
export const runtime = "nodejs";
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const CHECK_ADMIN = makeFunctionReference<"action">("submissions:checkAdminToken");
const GET_RUN = makeFunctionReference<"query">("ugcSampleRuns:get");

interface RunDoc {
  websiteUrl: string; photoUrl: string; productSummary?: string; websiteText?: string;
  screenshotUrl?: string; productImageUrl?: string; productImageUrls?: string[]; clientType?: string; language?: string;
  slots: Array<{ type: string; label: string; concept?: string; status: string; imageUrls?: string[] }>;
}

export async function POST(req: NextRequest) {
  let body: { runId?: string; index?: number; accessToken?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const runId = String(body.runId ?? "");
  const index = Math.floor(Number(body.index));
  if (!runId || !Number.isFinite(index) || index < 0) {
    return NextResponse.json({ ok: false, error: "runId and index required" }, { status: 400 });
  }

  if (!checkInternalSecret(req)) {
    if (!body.accessToken || !CONVEX_URL) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const convex = new ConvexHttpClient(CONVEX_URL);
    const chk = (await convex.action(CHECK_ADMIN, { accessToken: body.accessToken }).catch(() => null)) as { admin: boolean } | null;
    if (!chk?.admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const run = (await convex.query(GET_RUN, { runId }).catch(() => null)) as RunDoc | null;
  if (!run) return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404 });
  const slot = run.slots?.[index];
  if (!slot) return NextResponse.json({ ok: false, error: "Slot not found" }, { status: 404 });
  // "Still running" only blocks retry while the run is FRESH. A slot stuck on
  // scripting/rendering in an old run is an orphan (the background worker died
  // with the process) — it would 409 forever and the card could never recover.
  const runAgeMs = Date.now() - Number((run as unknown as { createdAt?: number }).createdAt ?? 0);
  const STUCK_AFTER_MS = 15 * 60_000;
  if ((slot.status === "scripting" || slot.status === "rendering") && runAgeMs < STUCK_AFTER_MS) {
    return NextResponse.json({ ok: false, error: "Slot is still running" }, { status: 409 });
  }

  // Older runs (before clientType/websiteText were persisted) retry with
  // sensible defaults — the summary alone still grounds the scripts.
  const clientType: ClientType = run.clientType === "physical" || run.clientType === "service" ? run.clientType : "app";
  const { normalizeImageForKie } = await import("@/lib/server/imageForKie");
  const isKiePng = (u: string | null): u is string => !!u && /\.png(\?|#|$)/i.test(u);
  // screenshot/product were stored ALREADY normalized at create; the photo is
  // stored raw — re-normalize (process-cached, so usually instant).
  const normPhoto = await normalizeImageForKie(run.photoUrl, 0);

  const ctx: UgcSlotCtx = {
    convex,
    runId,
    req,
    websiteUrl: run.websiteUrl,
    productContext: [
      `WEBSITE: ${run.websiteUrl}`,
      run.productSummary ? `PRODUCT SUMMARY: ${run.productSummary}` : "",
      run.websiteText ? `WEBSITE CONTENT (scraped): ${run.websiteText}` : "",
    ].filter(Boolean).join("\n"),
    clientType,
    language: run.language || "English",
    normalizedPhotoUrl: isKiePng(normPhoto) ? normPhoto : run.photoUrl,
    screenshotUrl: run.screenshotUrl ?? "",
    productImageUrl: run.productImageUrl ?? "",
    productImageUrls: Array.isArray(run.productImageUrls) ? run.productImageUrls : [],
  };

  // Dispatch the matching worker in the background (same drain pattern as
  // generate); the page's live subscription shows the slot restart immediately.
  void (async () => {
    if (slot.type === "story-fomo" || slot.type === "story-emotional") {
      await runStorySlot(ctx, index, slot.type);
    } else if (slot.type === "carousel") {
      // Resume state (plan + finished slides + in-flight KIE task id) rides in
      // the slot itself — the retry continues where the last run died instead
      // of re-planning and re-paying for all 5 images.
      await runCarouselSlot(ctx, index, { concept: slot.concept, imageUrls: slot.imageUrls });
    } else if (slot.type === "reaction" || slot.type === "cartoon" || slot.type === "review") {
      await runConceptSlot(ctx, index, {
        format: slot.type,
        title: slot.label,
        idea: slot.concept ?? run.productSummary ?? run.websiteUrl,
        hookText: "",
      } satisfies UgcConcept);
    } else {
      console.warn(`[ugc-sample/retry] unknown slot type "${slot.type}"`);
    }
  })();

  return NextResponse.json({ ok: true });
}

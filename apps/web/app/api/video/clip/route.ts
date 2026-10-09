import { chargeAgentGeneration } from "@/lib/server/agentGenerationBilling";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireInternalOrUserAuth, requireOwnerWithSiws, requireSiwsSession } from "@/lib/server/requireAuth";
import { meterAgentService } from "@/lib/economy/meterAgentService";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { safeFetchToBuffer } from "@/lib/server/downloader";
import { renderClipFromFile, renderStitchedClip, probeDurationSec, ClipRenderError } from "@/lib/server/clipRender";
import { derivePricedSkillsFromOps, opsRequireBillingIdentity } from "@/lib/server/clipOpsBilling";
import type { TranscriptWord } from "@/lib/server/clipTypes";

export const runtime = "nodejs";
export const maxDuration = 300;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Render ONE clip (the canvas "demo run" / ad-hoc path). Thin wrapper around the
 * shared render core (lib/server/clipRender.ts): it authenticates, meters, pulls
 * the source into a temp file, then delegates to renderClipFromFile — which does
 * the entire ffmpeg graph (reframe/captions/overlays/face-track/brain-rot) via
 * input-seek. The cloud auto-clip path reuses the SAME core directly from
 * /api/video/clip-batch-start (no per-clip HTTP hop).
 */
export async function POST(req: NextRequest) {
  // Whole-route deadline. maxDuration=300 is a HARD ceiling — a brain-rot render
  // stacks source-download + face-detect + gameplay-bg fetch + a 2-stream encode,
  // and the SUM (not any one ffmpeg) can blow 300s → a raw 502. We pass the render
  // core the REMAINING budget so an overrun dies with a clean error instead.
  const startedAt = Date.now();
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  let body: { sourceUrl?: string; startSeconds?: number; endSeconds?: number; ops?: unknown; words?: TranscriptWord[]; width?: number; height?: number; hookVideoUrl?: string; billing?: { mintAddress?: string; sessionId?: string; runId?: string; step?: string } };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { sourceUrl, startSeconds = 0, endSeconds = 0 } = body;
  // Reject a pathological window BEFORE billing/fetch — the source is read into
  // RAM here, so an unbounded window is a memory/DoS risk (backstop; the canvas
  // clamps to ~90s). 600s is a generous ceiling for a short-form clip.
  if (!sourceUrl || endSeconds <= startSeconds || endSeconds - startSeconds > 600) {
    return NextResponse.json({ error: "sourceUrl + valid window (max 600s) required" }, { status: 400 });
  }

  // Auth gate for user (Bearer) callers — internal cron callers skip. When the
  // render is billed to an agent (billing.mintAddress), require the SIWS-proven
  // owner. For an ad-hoc render (no mintAddress) there is no owner to scope, so
  // require a valid SIWS session only.
  if (!auth.internal) {
    const billedMint = body.billing?.mintAddress?.trim();
    if (billedMint && CONVEX_URL) {
      const owner = await new ConvexHttpClient(CONVEX_URL).query(api.influencers.getByMintServer, {
        mintAddress: billedMint, authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      });
      const ownershipError = requireOwnerWithSiws(auth, owner);
      if (ownershipError) return ownershipError;
    } else {
      const siwsError = requireSiwsSession(auth);
      if (siwsError) return siwsError;
    }
  }

  // ── METER: gate the render BEFORE the ffmpeg work (never trust the client —
  // the canvas precheck is UX, this is the backstop). #23: a direct authed POST
  // used to render fully-skilled clips FREE by simply omitting `billing`; the
  // route now derives the PRICED skills from the ops it is about to render
  // (exclusive-emitter inversion — see lib/server/clipOpsBilling.ts for why the
  // ambiguous op kinds are gated but never charged) and bills them itself.
  {
    const b = body.billing;
    const billedMint = b?.mintAddress?.trim();
    const draftSession = b?.sessionId?.trim();
    const runId = b?.runId?.trim() || `clip:${randomUUID()}`;
    const pricedSkills = derivePricedSkillsFromOps(body.ops);
    if (billedMint) {
      // Legacy step-metered render fee — preserved for callers that send `step`.
      // The canvas path sends NO step: its $0.40 render compute is intentionally
      // absorbed into the skills-only pricing, so no `render` meter fires there.
      if (b?.step) {
        const metered = await meterAgentService(billedMint, "render", 1, runId ? `${runId}:${b.step}` : undefined);
        if (!metered.ok) {
          return NextResponse.json({ ok: false, error: metered.reason ?? "needs_funding", billing: metered }, { status: 402 });
        }
      }
      // Confirm each idempotent skill payment before any rendering starts.
      if (pricedSkills.length > 0) {
        for (const skillId of pricedSkills) {
          const charge = await chargeAgentGeneration(billedMint, runId, skillId);
          if (!charge.ok) return NextResponse.json({ ok: false, error: charge.reason }, {
            status: ["needs_funding", "daily_cap", "suspended"].includes(charge.reason) ? 402 : 503,
          });
        }
      }
    } else if (draftSession) {
      // Draft (unminted, sessionId) previews render FREE — product decision. The
      // free-tier daily cap is counted at run-start by clip-precheck.
    } else if (!auth.internal && opsRequireBillingIdentity(body.ops)) {
      // Skill-class ops with NO billing identity: fail CLOSED. This is the #23
      // exploit shape — an authed caller rendering skill output while omitting
      // billing entirely. Plain cuts (no skill-class ops) stay identity-free.
      return NextResponse.json({ ok: false, error: "billing_required" }, { status: 402 });
    } else {
      console.warn("[clip-billing] unmetered clip render (no billing identity)");
    }
  }

  // Pull the source into a temp file, then render. safeFetchToBuffer is still RAM-
  // buffered (500MB cap) for this canvas path — unchanged behavior. Budget the
  // fetch to reserve ~160s for face-detect + encode + upload, exactly like before;
  // the render core's absolute deadline (startedAt + maxMs) then equals the old
  // route's (startedAt + maxDuration*1000), so timing is byte-identical.
  const tmp = await mkdtemp(join(tmpdir(), "vello-clipsrc-"));
  try {
    const srcFetchDeadline = startedAt + maxDuration * 1000 - 160_000;
    const { buffer } = await safeFetchToBuffer(sourceUrl, { timeoutMs: Math.max(8_000, srcFetchDeadline - Date.now()) });
    const srcPath = join(tmp, "src.mp4");
    await writeFile(srcPath, new Uint8Array(buffer));
    // HOOK VIDEO (Hook Videos app, canvas run): prepend the operator's opener as a
    // stitch sub-segment so the overlay stage burns over it — identical join to the
    // cloud batch path, so a canvas run and a cloud run produce the same video.
    // Best-effort: an unusable hook renders the clip without it rather than failing.
    let hookPath: string | undefined;
    let hookDuration = 0;
    if (body.hookVideoUrl) {
      try {
        const { buffer: hookBuf } = await safeFetchToBuffer(body.hookVideoUrl, { timeoutMs: Math.max(8_000, srcFetchDeadline - Date.now()) });
        const p = join(tmp, "hook.mp4");
        await writeFile(p, new Uint8Array(hookBuf));
        hookDuration = await probeDurationSec(p);
        if (hookDuration > 0) hookPath = p;
      } catch (e) {
        console.warn(`[video/clip] hook video unusable, rendering without it: ${e instanceof Error ? e.message : e}`);
      }
    }
    const { clipUrl, warnings } = hookPath
      ? await renderStitchedClip(
          [
            { srcPath: hookPath, start: 0, end: hookDuration, words: [] },
            { srcPath, start: startSeconds, end: endSeconds, words: body.words ?? [] },
          ],
          { ops: body.ops, width: body.width, height: body.height },
          { maxMs: maxDuration * 1000 - (Date.now() - startedAt) },
        )
      : await renderClipFromFile(
          srcPath,
          { startSeconds, endSeconds, ops: body.ops, words: body.words, width: body.width, height: body.height },
          { maxMs: maxDuration * 1000 - (Date.now() - startedAt) },
        );
    return NextResponse.json({ ok: true, clipUrl, ...(warnings.length ? { warnings } : {}) });
  } catch (e) {
    if (e instanceof ClipRenderError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.code === "budget" ? 503 : e.code === "window" ? 400 : 500 });
    }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

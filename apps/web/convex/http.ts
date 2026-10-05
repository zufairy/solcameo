import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Oracle → Vello webhook (JOB-51).
// The verifier oracle POSTs here after pushing an on-chain attestation so Convex
// can flip the submission to verified/rejected, record the view count, and
// compute the USDC payout. Authenticated by a shared secret in `x-oracle-secret`.
//
// URL: POST {CONVEX_SITE_URL}/oracle/attestation
// Body: { submissionId, decision: "approved"|"rejected", viewCount, scoreHash?, attestationTx? }
http.route({
  path: "/oracle/attestation",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.ORACLE_WEBHOOK_SECRET;
    const provided = request.headers.get("x-oracle-secret");
    // Constant work whether or not `expected` is set; missing config => deny.
    if (!expected || provided !== expected) {
      return json({ error: "unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid json body" }, 400);
    }

    const b = body as Record<string, unknown>;
    const submissionId = b.submissionId;
    const decision = b.decision;
    const viewCount = b.viewCount;

    if (
      typeof submissionId !== "string" ||
      (decision !== "approved" && decision !== "rejected") ||
      typeof viewCount !== "number" ||
      !Number.isFinite(viewCount)
    ) {
      return json({ error: "invalid payload" }, 400);
    }

    try {
      const result = await ctx.runMutation(internal.campaigns.markVerified, {
        submissionId: submissionId as never,
        decision,
        viewCount,
        scoreHash: typeof b.scoreHash === "string" ? b.scoreHash : undefined,
        attestationTx:
          typeof b.attestationTx === "string" ? b.attestationTx : undefined,
        // The webhook must NOT settle v2 (on-chain) submissions — the oracle
        // worker owns that rail (it carries the real on-chain attestationTx).
        // markVerified returns a no-op skip for v2 when viaWebhook is true.
        viaWebhook: true,
      });
      return json({ ok: true, ...result }, 200);
    } catch (err) {
      // Most likely an unknown submission/campaign id.
      return json({ error: String(err instanceof Error ? err.message : err) }, 404);
    }
  }),
});

// Publicly serve a reference image from Convex file storage.
// URL: GET {CONVEX_SITE_URL}/ref-image?id={storageId}
// Kie.ai will fetch this URL to use as a reference for image generation.
http.route({
  path: "/ref-image",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const storageId = url.searchParams.get("id");
    if (!storageId) {
      return new Response("Missing id", { status: 400 });
    }

    const blob = await ctx.storage.get(storageId as `_storage/${string}`);
    if (!blob) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": blob.type,
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

export default http;

// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── Regression guard: clip-agent avatar generation called a DELETED route ──────
//
// The single-image avatar path in builder/page.tsx (used by CLIP agents, and the
// dropped trader) POSTed to `/api/trader/generate-image`. That route — and all of
// `app/api/trader/` — was DELETED when the trader product was dropped, so the call
// 404'd. Next returned an HTML error page, which the client parsed with a raw
// `.json()`, throwing `Unexpected token '<', "<!DOCTYPE"… is not valid JSON` and
// failing EVERY clip-agent avatar attempt with a misleading "try a different
// aesthetic" message.
//
// The fix reuses the working, timeout-safe `/api/generate-nft-images` create+collect
// flow (the same one the influencer path uses) with a DEFENSIVE parser, so a dead or
// HTML response degrades to a friendly "service busy" message instead of a crash.
//
// This test reads the source and asserts the deleted route is no longer referenced.
// It FAILS on the pre-fix code and PASSES after the fix, preventing this whole
// "call a route that no longer exists" class from regressing.
//
// NOTE on the OTHER trader routes still referenced in page.tsx
// (`/api/trader/save-autonomy`, `/api/trader/tick-price`, `/api/trader/place-binary`):
// those are also dead (the dir is gone), but they sit behind trader-ONLY agentAction
// types (`set_autonomy`, `place_binary`) that a clipper's copilot is never prompted
// to emit, and each is already crash-guarded (`.catch(() => {})` / a surrounding
// try/catch that parses defensively). So they cannot produce the reachable clip/
// influencer crash this fix addresses; we intentionally do NOT assert their absence
// here (removing dropped-trader logic is out of scope).

const here = dirname(fileURLToPath(import.meta.url));
const builderPageSource = readFileSync(join(here, "page.tsx"), "utf8");

describe("builder/page.tsx dead-route guard", () => {
  it("never calls the DELETED /api/trader/generate-image route", () => {
    expect(builderPageSource).not.toContain("/api/trader/generate-image");
  });

  it("generates avatars via the live /api/generate-nft-images create+collect flow", () => {
    expect(builderPageSource).toContain("/api/generate-nft-images");
    expect(builderPageSource).toContain("/api/generate-nft-images/collect");
  });
});

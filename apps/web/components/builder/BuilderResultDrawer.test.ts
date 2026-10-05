// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── Regression guard: the drawer's inline "Fund the campaign vault" card
// POSTed to `/api/web3-campaigns/prepare` and `/api/web3-campaigns/confirm-funding`
// — routes that were never implemented (`app/api/web3-campaigns/` does not exist).
// Clicking "Fund" always 404'd, `prepareRes.json()` threw on the HTML error body,
// and the funding flow died with a generic error. It was reachable any time the
// drawer rendered a resolved community (`meaningful && resolvedCommunityId`).
//
// Decision: remove the broken inline funding card outright. The working funding
// surface is the Stage (`/stage/create` → CampaignForm → `campaigns/set-pda` +
// `campaigns/topup`). The drawer now links out there instead of duplicating a
// broken on-chain flow inline.
//
// This test reads the source and asserts the dead routes are no longer referenced,
// and that a real, working navigation target replaces them — so this can't
// regress into either (a) the dead fetch calls coming back, or (b) a silent
// dead-end (no CTA at all) once a community/campaign is resolved.

const here = dirname(fileURLToPath(import.meta.url));
const drawerSource = readFileSync(join(here, "BuilderResultDrawer.tsx"), "utf8");

describe("BuilderResultDrawer dead-route guard", () => {
  it("never references the unimplemented /api/web3-campaigns routes", () => {
    expect(drawerSource).not.toContain("/api/web3-campaigns");
  });

  it("no longer defines the removed InlineFundingCard component", () => {
    expect(drawerSource).not.toContain("InlineFundingCard");
  });

  it("links out to the working Stage funding surface instead", () => {
    expect(drawerSource).toContain("/stage/create");
    expect(drawerSource).toMatch(/\/stage\/\$\{resolvedCampaignId\}/);
  });
});

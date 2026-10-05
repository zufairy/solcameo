/// <reference types="vite/client" />
/**
 * FIX 2 — public `api.campaigns.list` must NOT leak the restricted campaigns'
 * source URLs. The unauthenticated `list` query returns contentLinks +
 * contentFileUrls; a restricted reward's "Clipping FR" MIRROR copies the real
 * jobtepi source URLs into those fields, so `list` blanks them on restricted rows.
 * A genuinely different public campaign that merely shares a normalized title with
 * one of the 12 (different contentRewardId) keeps its own sources (prefer-UUID).
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/** The subset of the (widely-typed) `list` row the assertions read. */
type ListRow = {
  _id: string;
  title: string;
  contentRewardId?: string | null;
  contentLinks?: string[];
  contentFileUrls?: string[];
};

const RESTRICTED_ID = "879d3634-f98f-43f4-b2ac-0c228d80f4a8"; // Trade with Shrimp (restricted)

const base = {
  brandName: "Acme",
  brandLogoUrl: "https://api.dicebear.com/9.x/initials/svg?seed=Acme",
  brief: "Clip the keynote",
  budget: 500,
  ratePerThousandViews: 3,
  campaignType: "marketing",
  targetNiche: ["tech"] as string[],
  targetLanguage: ["en"] as string[],
  deadline: new Date(Date.now() + 30 * 864e5).toISOString(),
  status: "open",
  submissionsCount: 0,
};

describe("campaigns.list — restricted source-URL strip (FIX 2)", () => {
  it("BLANKS contentLinks/contentFileUrls on a restricted MIRROR row (matched by contentRewardId)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("campaigns", {
        ...base,
        creatorWallet: "W_owner",
        title: "Trade with Shrimp Clipping Push",
        contentRewardId: RESTRICTED_ID,
        origin: "clipping_fr",
        contentLinks: ["https://drive.google.com/secret-source-1"],
        contentFileUrls: ["https://cdn.example/secret-upload.mp4"],
      });
    });
    const rows = (await t.query(api.campaigns.list, {})) as unknown as ListRow[];
    const restricted = rows.find((c) => c.contentRewardId === RESTRICTED_ID)!;
    expect(restricted.contentLinks).toEqual([]);
    expect(restricted.contentFileUrls).toEqual([]);
  });

  it("leaves a NON-restricted campaign's sources UNCHANGED", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("campaigns", {
        ...base,
        creatorWallet: "W_owner",
        title: "Totally Public Clipping",
        contentRewardId: "some-other-real-uuid",
        contentLinks: ["https://public.example/source-1"],
        contentFileUrls: ["https://public.example/upload.mp4"],
      });
    });
    const rows = (await t.query(api.campaigns.list, {})) as unknown as ListRow[];
    const plain = rows.find((c) => c.title === "Totally Public Clipping")!;
    expect(plain.contentLinks).toEqual(["https://public.example/source-1"]);
    expect(plain.contentFileUrls).toEqual(["https://public.example/upload.mp4"]);
  });

  it("prefer-UUID (FIX 3): a DIFFERENT-uuid campaign that only SHARES a restricted title keeps its sources", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("campaigns", {
        ...base,
        creatorWallet: "W_owner",
        title: "Argos Clipping", // collides with a restricted title …
        contentRewardId: "a-different-real-uuid", // … but a definitive different UUID
        contentLinks: ["https://public.example/argos-source"],
      });
    });
    const rows = (await t.query(api.campaigns.list, {})) as unknown as ListRow[];
    const lookalike = rows.find((c) => c.title === "Argos Clipping")!;
    expect(lookalike.contentLinks).toEqual(["https://public.example/argos-source"]);
  });

  it("still BLANKS a restricted row matched by TITLE alone (no contentRewardId)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("campaigns", {
        ...base,
        creatorWallet: "W_owner",
        title: "Argos Clipping", // a restricted title, no UUID → title match gates
        contentLinks: ["https://drive.google.com/secret"],
      });
    });
    const rows = (await t.query(api.campaigns.list, {})) as unknown as ListRow[];
    const byTitle = rows.find((c) => c.title === "Argos Clipping")!;
    expect(byTitle.contentLinks).toEqual([]);
  });
});

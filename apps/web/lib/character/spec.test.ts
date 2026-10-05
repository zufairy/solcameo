import { describe, expect, it } from "vitest";
import { buildPrompt, categoriesFor, isBuildable, referencePlan, sanitizeSelection } from "./spec";
import { parseResult } from "@/lib/server/higgsfield";

describe("character spec", () => {
  it("every media option has a mirrored preview image path", () => {
    for (const c of categoriesFor("total")) {
      if (c.kind !== "media") continue;
      for (const o of c.options) expect(o.image, `${c.id}/${o.id}`).toMatch(/^\/character\/opt\/.+\.webp$/);
    }
  });

  it("hides freak-only options in the normal tier", () => {
    const normalHair = categoriesFor("normal").find((c) => c.id === "hair")!.options.map((o) => o.id);
    expect(normalHair).toContain("hair_long");
    expect(normalHair).not.toContain("hs_lampshade");
    expect(categoriesFor("freak").find((c) => c.id === "hair")!.options.map((o) => o.id)).toContain("hs_lampshade");
  });

  it("sanitizes untrusted selections: unknown ids dropped, max enforced, tier respected", () => {
    const sel = sanitizeSelection({
      gender: ["female", "male", "nope"],
      hair: ["hs_lampshade", "hair_long"],
      accessory: ["acc_hat", "acc_bag", "acc_glasses", "acc_jewelry"],
      bogus: ["x"],
    }, "normal");
    expect(sel.gender).toEqual(["female"]);
    expect(sel.hair).toEqual(["hair_long"]);
    expect(sel.accessory).toHaveLength(3);
    expect(sel).not.toHaveProperty("bogus");
    expect(sanitizeSelection("junk", "normal")).toEqual({});
    expect(isBuildable({})).toBe(false);
  });

  it("composes a prompt from the picks and picks a scraped reference", () => {
    const sel = sanitizeSelection({ gender: ["female"], hair: ["hair_long"], hair_colour: ["hc_blonde"], eye_color: ["eye_green"], aesthetic: ["goth"] }, "normal");
    const p = buildPrompt(sel, "normal");
    expect(p).toContain("woman");
    expect(p).toContain("very long straight center-parted hair");
    expect(p).toContain("goth fashion style");
    const plan = referencePlan(sel).options;
    expect(plan.map((o) => o.id)).toEqual(["hair_long", "goth", "female"]);
    expect(plan.every((o) => o.image.startsWith("/character/opt/"))).toBe(true);
    expect(buildPrompt(sel, "normal", { sheet: true })).toContain("grid of trait swatches");
    expect(buildPrompt(sel, "normal", { sheet: true })).toContain("very long straight center-parted hair");
    expect(buildPrompt(sel, "normal", { photo: true })).toContain("identity of the person in the reference photo");
    expect(referencePlan({}).options).toEqual([]);
    const many = sanitizeSelection({ hair: ["hair_long"], ethnicity_origin_base: ["european"], body_type: ["body_slim"], aesthetic: ["goth"], gender: ["female"], height: ["h_tall"] }, "normal");
    expect(referencePlan(many).options).toHaveLength(4);
  });
});

describe("higgsfield result parsing", () => {
  it("returns image urls only when https", () => {
    const r = parseResult({ status: "completed", images: [{ url: "https://x/y.png" }, { url: "http://bad" }, {}] }, "req12345");
    expect(r).toMatchObject({ status: "completed", imageUrls: ["https://x/y.png"] });
  });
  it("treats unknown states as in progress", () => {
    expect(parseResult({ status: "weird" }, "req12345").status).toBe("in_progress");
    expect(parseResult({ status: "nsfw" }, "req12345").status).toBe("nsfw");
  });
});

describe("higgsfield credentials", () => {
  const KEYS = ["HF_CREDENTIALS", "HIGGSFIELD_CREDENTIALS", "HIGGSFIELD_API_KEY", "HF_API_KEY", "HF_API_KEY_ID", "HF_API_SECRET", "HIGGSFIELD_API_SECRET"];
  const run = async (env: Record<string, string>) => {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => delete process.env[k]);
    Object.assign(process.env, env);
    try { const m = await import("@/lib/server/higgsfield"); return m.higgsfieldConfigured(); }
    finally { KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); }
  };
  it("accepts id:secret under several names and split vars", async () => {
    expect(await run({ HF_CREDENTIALS: "a:b" })).toBe(true);
    expect(await run({ HIGGSFIELD_API_KEY: "a:b" })).toBe(true);
    expect(await run({ HIGGSFIELD_API_KEY: "a", HIGGSFIELD_API_SECRET: "b" })).toBe(true);
    expect(await run({ HF_CREDENTIALS: "\"Key a:b\"" })).toBe(true);
  });
  it("is unconfigured with nothing or a bare key", async () => {
    expect(await run({})).toBe(false);
    expect(await run({ HIGGSFIELD_API_KEY: "justakey" })).toBe(false);
  });
});

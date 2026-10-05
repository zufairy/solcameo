/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, beforeAll } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-secret";
const base = { ownerDid: "did:privy:u1", creatorWallet: "Wa11et1111111111111111111111111111111111111", websiteUrl: "https://acme.com/", authSecret: SECRET };

beforeAll(() => { process.env.INTERNAL_CRON_SECRET = SECRET; });

describe("launchRuns", () => {
  it("create → get returns the doc at stage analyzing", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.launchRuns.create, base);
    const doc = await t.query(api.launchRuns.get, { runId: id });
    expect(doc?.stage).toBe("analyzing");
    expect(doc?.websiteUrl).toBe("https://acme.com/");
  });
  it("rejects a bad secret", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.launchRuns.create, { ...base, authSecret: "nope" })).rejects.toThrow(/unauthorized/);
  });
  it("rate-limits the THIRD launch inside 24h for one owner", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.launchRuns.create, base);
    await t.mutation(api.launchRuns.create, base);
    await expect(t.mutation(api.launchRuns.create, base)).rejects.toThrow(/rate_limited/);
    // a different owner is unaffected
    await expect(t.mutation(api.launchRuns.create, { ...base, ownerDid: "did:privy:u2" })).resolves.toBeTruthy();
  });
  it("patch merges fields without wiping others", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.launchRuns.create, base);
    await t.mutation(api.launchRuns.patch, { runId: id, authSecret: SECRET, stage: "naming", agentName: "Acme" });
    await t.mutation(api.launchRuns.patch, { runId: id, authSecret: SECRET, stage: "minting", mintAddress: "M1" });
    const doc = await t.query(api.launchRuns.get, { runId: id });
    expect(doc).toMatchObject({ stage: "minting", agentName: "Acme", mintAddress: "M1" });
  });
});

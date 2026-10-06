/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.test).*s");
const secret = "studio-test-secret";
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = secret; });
const args = (runIds: string[], extra: object = {}) => ({ authSecret: secret, account: "wallet-a", runIds, useFree: true, amountUsd: 0.5, ...extra });

it("gives three free images, then asks for payment and consumes each signature once", async () => {
  const t = convexTest(schema, modules);
  expect(await t.mutation(api.studioGen.reserve, args(["r1", "r2", "r3"]))).toMatchObject({ ok: true, free: 3, paid: 0 });
  expect(await t.query(api.studioGen.quota, { authSecret: secret, account: "wallet-a" })).toMatchObject({ freeLeft: 0 });
  expect(await t.mutation(api.studioGen.reserve, args(["r4", "r5"]))).toEqual({ ok: false, needPaid: 2 });
  expect(await t.mutation(api.studioGen.reserve, args(["r4", "r5"], { txSignature: "sig-1" }))).toMatchObject({ ok: true, paid: 2 });
  await expect(t.mutation(api.studioGen.reserve, args(["r6"], { txSignature: "sig-1" }))).rejects.toThrow(/already processed/);
});

it("switch off charges even with free images left, and a failed paid image comes back as a credit", async () => {
  const t = convexTest(schema, modules);
  expect(await t.mutation(api.studioGen.reserve, args(["p1"], { useFree: false }))).toEqual({ ok: false, needPaid: 1 });
  await t.mutation(api.studioGen.reserve, args(["p1"], { useFree: false, txSignature: "sig-2" }));
  await t.mutation(api.studioGen.refund, { authSecret: secret, runId: "p1" });
  await t.mutation(api.studioGen.refund, { authSecret: secret, runId: "p1" });
  expect(await t.query(api.studioGen.quota, { authSecret: secret, account: "wallet-a" })).toMatchObject({ freeLeft: 3, credits: 1 });
  expect(await t.mutation(api.studioGen.reserve, args(["p2"], { useFree: false }))).toMatchObject({ ok: true, credit: 1, paid: 0 });
});

it("a failed free image restores the allowance and a replayed run id is rejected when fresh", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.studioGen.reserve, args(["f1"]));
  await t.mutation(api.studioGen.refund, { authSecret: secret, runId: "f1" });
  expect(await t.query(api.studioGen.quota, { authSecret: secret, account: "wallet-a" })).toMatchObject({ freeLeft: 3 });
  await t.mutation(api.studioGen.reserve, args(["f2"]));
  expect(await t.mutation(api.studioGen.reserve, args(["f2"]))).toMatchObject({ ok: true, duplicate: true });
  await expect(t.mutation(api.studioGen.reserve, args(["f2"], { fresh: true }))).rejects.toThrow(/already billed/);
});

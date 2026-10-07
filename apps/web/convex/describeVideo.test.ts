/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.test).*s");
const secret = "describe-test-secret";
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = secret; });
const sig = "5".repeat(88);

it("one payment buys one video: a repeat from the same account returns its render, another account is refused", async () => {
  const t = convexTest(schema, modules);
  expect(await t.mutation(api.describeVideo.claim, { authSecret: secret, account: "A", txSignature: sig, amountUsd: 1.2 })).toMatchObject({ kind: "fresh" });
  const task = await t.run((ctx) => ctx.db.insert("agentTasks", { mintAddress: "", sessionId: "s", type: "create_video", status: "running", title: "t" }));
  await t.mutation(api.describeVideo.attach, { authSecret: secret, txSignature: sig, taskId: task });
  expect(await t.mutation(api.describeVideo.claim, { authSecret: secret, account: "A", txSignature: sig, amountUsd: 1.2 })).toMatchObject({ kind: "existing", taskId: task });
  await expect(t.mutation(api.describeVideo.claim, { authSecret: secret, account: "B", txSignature: sig, amountUsd: 1.2 })).rejects.toThrow("payment_used");
});

it("a signature already spent elsewhere cannot start a video, and a wrong secret is refused", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("processedSignatures", { txSignature: sig, purpose: "studio_gen", consumedAt: 1 }));
  await expect(t.mutation(api.describeVideo.claim, { authSecret: secret, account: "A", txSignature: sig, amountUsd: 1 })).rejects.toThrow("already processed");
  await expect(t.mutation(api.describeVideo.claim, { authSecret: "nope", account: "A", txSignature: "6".repeat(88), amountUsd: 1 })).rejects.toThrow("unauthorized");
});

it("only the payer can read a provider job, and unfulfilled lists paid runs that never started", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.describeVideo.claim, { authSecret: secret, account: "A", txSignature: sig, amountUsd: 2 });
  expect(await t.query(api.describeVideo.unfulfilled, { authSecret: secret })).toHaveLength(1);
  await t.mutation(api.describeVideo.attachRequest, { authSecret: secret, txSignature: sig, requestId: "req1" });
  expect(await t.query(api.describeVideo.ownsRequest, { authSecret: secret, account: "A", requestId: "req1" })).toBe(true);
  expect(await t.query(api.describeVideo.ownsRequest, { authSecret: secret, account: "B", requestId: "req1" })).toBe(false);
  expect(await t.query(api.describeVideo.unfulfilled, { authSecret: secret })).toHaveLength(0);
});

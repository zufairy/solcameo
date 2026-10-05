/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "s3cret";

const idea = (over: Record<string, unknown> = {}) => ({
  headline: "Supreme Court rules on AI copyright", angle: "Lex reacts: what it means for creators",
  whyNow: "ruling landed today", source: "news", format: "news-react",
  suggestedDurationSec: 40, score: 82, expiresAt: Date.now() + 24 * 3600 * 1000, ...over,
});

test("insertBatch stores ideas and dedupes near-identical headlines", async () => {
  const t = convexTest(schema, modules);
  process.env.INTERNAL_CRON_SECRET = SECRET;
  const r1 = await t.mutation(api.contentIdeas.insertBatch, {
    mintAddress: "m1", authSecret: SECRET,
    ideas: [idea(), idea({ headline: "supreme court rules on ai copyright!" })],
  });
  expect(r1.inserted).toBe(1); // second is a near-dup
  const list = await t.query(api.contentIdeas.listForMint, { mintAddress: "m1" });
  expect(list).toHaveLength(1);
  expect(list[0].status).toBe("proposed");
});

test("listFreshProposed excludes expired and rejected, orders by score", async () => {
  const t = convexTest(schema, modules);
  process.env.INTERNAL_CRON_SECRET = SECRET;
  await t.mutation(api.contentIdeas.insertBatch, {
    mintAddress: "m1", authSecret: SECRET,
    ideas: [
      idea({ headline: "A", score: 50 }),
      idea({ headline: "B", score: 90 }),
      idea({ headline: "C stale", score: 99, expiresAt: Date.now() - 1000 }),
    ],
  });
  await t.mutation(internal.contentIdeas.expireStale, { mintAddress: "m1" });
  const fresh = await t.query(api.contentIdeas.listFreshProposed, { mintAddress: "m1" });
  expect(fresh.map((i: { headline: string }) => i.headline)).toEqual(["B", "A"]);
});

test("status machine: approve without secret, producing requires secret", async () => {
  const t = convexTest(schema, modules);
  process.env.INTERNAL_CRON_SECRET = SECRET;
  await t.mutation(api.contentIdeas.insertBatch, { mintAddress: "m1", authSecret: SECRET, ideas: [idea()] });
  const [row] = await t.query(api.contentIdeas.listForMint, { mintAddress: "m1" });
  await t.mutation(api.contentIdeas.setStatus, { ideaId: row._id, status: "approved" });
  await expect(t.mutation(api.contentIdeas.setStatus, { ideaId: row._id, status: "producing" }))
    .rejects.toThrow(/unauthorized/i);
  await t.mutation(api.contentIdeas.setStatus, { ideaId: row._id, status: "producing", authSecret: SECRET });
  const [after] = await t.query(api.contentIdeas.listForMint, { mintAddress: "m1" });
  expect(after.status).toBe("producing");
});

test("user-sourced ideas auto-approve", async () => {
  const t = convexTest(schema, modules);
  process.env.INTERNAL_CRON_SECRET = SECRET;
  await t.mutation(api.contentIdeas.insertBatch, {
    mintAddress: "m1", authSecret: SECRET,
    ideas: [idea({ source: "user", headline: "User pitch", expiresAt: undefined })],
  });
  const [row] = await t.query(api.contentIdeas.listForMint, { mintAddress: "m1" });
  expect(row.status).toBe("approved");
});

test("feedback and angle edits persist", async () => {
  const t = convexTest(schema, modules);
  process.env.INTERNAL_CRON_SECRET = SECRET;
  await t.mutation(api.contentIdeas.insertBatch, { mintAddress: "m1", authSecret: SECRET, ideas: [idea()] });
  const [row] = await t.query(api.contentIdeas.listForMint, { mintAddress: "m1" });
  await t.mutation(api.contentIdeas.setFeedback, { ideaId: row._id, feedback: "up" });
  await t.mutation(api.contentIdeas.updateAngle, { ideaId: row._id, angle: "sharper take" });
  const [after] = await t.query(api.contentIdeas.listForMint, { mintAddress: "m1" });
  expect(after.feedback).toBe("up");
  expect(after.angle).toBe("sharper take");
  expect(after.editedByUser).toBe(true);
});

test("feedback appends a taste event", async () => {
  const t = convexTest(schema, modules);
  process.env.INTERNAL_CRON_SECRET = SECRET;
  await t.mutation(api.contentIdeas.insertBatch, { mintAddress: "m1", authSecret: SECRET, ideas: [idea()] });
  const [row] = await t.query(api.contentIdeas.listForMint, { mintAddress: "m1" });
  await t.mutation(api.contentIdeas.setFeedback, { ideaId: row._id, feedback: "up" });
  // takeUnconsumed only pops (and marks consumed) a batch of >=3 — the idea
  // pipeline only folds feedback into the taste-profile prose past that
  // threshold (ideaPipeline.ts), and consuming fewer would silently discard
  // them. A single event stays unconsumed until enough accumulate.
  const tooFew = await t.mutation(api.tasteEvents.takeUnconsumed, { mintAddress: "m1", authSecret: SECRET });
  expect(tooFew).toHaveLength(0);
  await t.mutation(api.contentIdeas.setFeedback, { ideaId: row._id, feedback: "down" });
  await t.mutation(api.contentIdeas.setFeedback, { ideaId: row._id, feedback: "up" });
  const events = await t.mutation(api.tasteEvents.takeUnconsumed, { mintAddress: "m1", authSecret: SECRET });
  expect(events).toHaveLength(3);
  expect(events[0].kind).toBe("idea_up");
  // consumed — second take returns nothing
  const again = await t.mutation(api.tasteEvents.takeUnconsumed, { mintAddress: "m1", authSecret: SECRET });
  expect(again).toHaveLength(0);
});

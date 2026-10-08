import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ edit: vi.fn(), soul: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/server/characterDraft", () => ({ authorizeCharacterScope: async () => ({ mint: "draft-owner" }), issueCharacterJobTicket: () => "owner-ticket" }));
vi.mock("@/lib/server/studioGenBilling", () => ({ reserveStudioImages: async () => ({ refund: async () => undefined }), refundStudioRun: async () => undefined }));
vi.mock("@/lib/server/imageStorage", () => ({ imagePublicUrl: (key: string) => `https://images.test/${key}`, putImage: mocks.put }));
vi.mock("@/lib/server/higgsfield", () => ({ HfError: class extends Error {}, submitImage: mocks.soul }));
vi.mock("@/lib/server/kieStudioImage", () => ({ kieConfigured: () => true, hostReferencesForKie: async (urls: string[]) => urls.map(u => u.replace(".jpg", ".png")), createStudioImageTask: mocks.edit }));
import { POST } from "./route";
afterEach(() => vi.clearAllMocks());
const request = (body: object) => new NextRequest("http://localhost/api/character/generate", { method: "POST", body: JSON.stringify({ draft: true, selection: { hair_colour: ["hc_blonde"] }, ...body }) });
it("renders the owner's reference with Nano Banana Pro and registers the accepted job for refresh recovery", async () => {
  mocks.edit.mockResolvedValue("edit-job");
  const image = "https://images.test/characters/draft-owner/photo/reference.jpg";
  const res = await POST(request({ photoUrl: image }));
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.jobs[0]).toMatchObject({ provider: "kie", model: "nano", count: 1, ticket: "owner-ticket", requestId: "edit-job" });
  const { prompt, refs, aspectRatio } = mocks.edit.mock.calls[0][0];
  expect(refs).toEqual(["https://images.test/characters/draft-owner/photo/reference.png"]);
  expect(aspectRatio).toBe("3:4");
  expect(prompt).toContain("blonde"); // the selected trait is a hard requirement
  expect(prompt).toContain("SET TEMPLATE");
  expect(prompt).toMatch(/IDENTITY only/);
  expect(prompt).toMatch(/Do NOT reuse the reference pose/);
  expect(mocks.soul).not.toHaveBeenCalled();
  expect(mocks.put.mock.calls[0][2].key).toBe("characters/draft-owner/jobs/edit-job.json");
});
it("rejects another user's reference", async () => {
  expect((await POST(request({ photoUrl: "https://images.test/characters/other/photo/ref.jpg" }))).status).toBe(400);
  expect(mocks.edit).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
});
it.each([['soul', 'higgsfield-ai/soul/standard'], ['soul2', 'higgsfield-ai/soul/v2/standard']])("routes %s to its actual model endpoint", async (model, endpoint) => {
  mocks.soul.mockResolvedValue("soul-job");
  const data = await (await POST(request({ model, aspectRatio: "4:5" }))).json();
  expect(data.jobs[0]).toMatchObject({ model, ratio: "3:4", count: 1 });
  expect(mocks.soul.mock.calls[0][0]).toBe(endpoint);
  expect(mocks.edit).not.toHaveBeenCalled();
});
it("rejects Nano Banana Pro without references", async () => {
  expect((await POST(request({ model: "nano" }))).status).toBe(400);
  expect((await POST(request({ model: "qwen" }))).status).toBe(400);
  expect(mocks.soul).not.toHaveBeenCalled();
});
it("sends all three references to Nano Banana Pro in order", async () => {
  mocks.edit.mockResolvedValue("edit-job");
  const photoUrls = [1,2,3].map(i => `https://images.test/characters/draft-owner/photo/${i}.jpg`);
  expect((await POST(request({ model: "soul2", photoUrls }))).status).toBe(200);
  expect(mocks.edit.mock.calls[0][0].refs).toEqual(photoUrls.map(u => u.replace(".jpg", ".png")));
  expect(mocks.soul).not.toHaveBeenCalled();
  expect((await POST(request({ photoUrls: [...photoUrls, photoUrls[0]] }))).status).toBe(400);
});
it("sends four single-image Soul jobs and registers each", async () => {
  mocks.soul.mockImplementation(async (_endpoint, _input, key) => key);
  const data = await (await POST(request({ count: 4, model: "soul2" }))).json();
  expect(data.jobs).toHaveLength(4); expect(mocks.soul).toHaveBeenCalledTimes(4); expect(mocks.put).toHaveBeenCalledTimes(4);
});

it.each(["insects", "frogs", "cats", "dogs", "capybaras", "birds"])("generates %s from its type alone with Soul 2 by default", async tier => {
  mocks.soul.mockResolvedValue("animal-job");
  const response = await POST(request({ tier, selection: {} }));
  expect(response.status).toBe(200);
  expect((await response.json()).jobs[0].model).toBe("soul2");
  expect(mocks.soul.mock.calls[0][0]).toBe("higgsfield-ai/soul/v2/standard");
  expect(mocks.soul.mock.calls[0][1].prompt).toContain("anthropomorphic");
});
it("falls back to Soul with the upload as its reference when the editing model fails to start", async () => {
  const { HfError } = await import("@/lib/server/higgsfield");
  const image = "https://images.test/characters/draft-owner/photo/reference.jpg";
  mocks.edit.mockRejectedValue(Object.assign(new HfError("upstream down", 502, "upstream"), { code: "upstream", status: 502 }));
  mocks.soul.mockResolvedValue("soul-job");
  const res = await POST(request({ photoUrl: image }));
  expect(res.status).toBe(200);
  expect((await res.json()).jobs[0]).toMatchObject({ model: "soul", requestId: "soul-job" });
  expect(mocks.soul.mock.calls[0][1]).toMatchObject({ image_reference_url: image });
});
it("does not fall back when the failure is credits, so the run is refunded and reported", async () => {
  const { HfError } = await import("@/lib/server/higgsfield");
  mocks.edit.mockRejectedValue(Object.assign(new HfError("no credits", 402, "credits"), { code: "credits", status: 402 }));
  const res = await POST(request({ photoUrl: "https://images.test/characters/draft-owner/photo/reference.jpg" }));
  expect(res.status).toBe(402);
  expect(mocks.soul).not.toHaveBeenCalled();
});

it("gives every take of a batch the same template and a different pose", async () => {
  mocks.edit.mockImplementation(async () => `task-${Math.random().toString(36).slice(2, 12)}`);
  const image = "https://images.test/characters/draft-owner/photo/reference.jpg";
  const res = await POST(request({ photoUrl: image, count: 4 }));
  expect(res.status).toBe(200);
  const prompts: string[] = mocks.edit.mock.calls.map((c: any[]) => c[0].prompt);
  expect(prompts).toHaveLength(4);
  const template = (p: string) => p.match(/SET TEMPLATE \(identical for every image in this set\): (.*?)\./)?.[1];
  const pose = (p: string) => p.match(/POSE FOR THIS IMAGE: (.*?)\. /)?.[1];
  expect(new Set(prompts.map(template)).size).toBe(1);
  expect(new Set(prompts.map(pose)).size).toBe(4);
});

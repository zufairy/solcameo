import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ edit: vi.fn(), soul: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/server/characterDraft", () => ({ authorizeCharacterScope: async () => ({ mint: "draft-owner" }), issueCharacterJobTicket: () => "owner-ticket" }));
vi.mock("@/lib/server/imageStorage", () => ({ imagePublicUrl: (key: string) => `https://images.test/${key}`, putImage: mocks.put }));
vi.mock("@/lib/server/higgsfield", () => ({ HfError: class extends Error {}, submitReferenceEdit: mocks.edit, submitImage: mocks.soul }));
import { POST } from "./route";
afterEach(() => vi.clearAllMocks());
const request = (body: object) => new NextRequest("http://localhost/api/character/generate", { method: "POST", body: JSON.stringify({ draft: true, selection: { hair_colour: ["hc_blonde"] }, ...body }) });
it("edits the owner's image with Qwen and registers the accepted job for refresh recovery", async () => {
  mocks.edit.mockResolvedValue("edit-job");
  const image = "https://images.test/characters/draft-owner/photo/reference.jpg";
  const res = await POST(request({ photoUrl: image, editModel: "marketing" }));
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.jobs[0]).toMatchObject({ model: "reference", count: 1, ticket: "owner-ticket" });
  expect(mocks.edit.mock.calls[0][0]).toContain("Preserve every unselected feature");
  expect(mocks.edit.mock.calls[0][0]).toContain("blonde");
  expect(mocks.edit.mock.calls[0][1]).toEqual([image]);
  expect(mocks.edit.mock.calls[0]).toHaveLength(4);
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
it("rejects Qwen without references", async () => {
  expect((await POST(request({ model: "qwen" }))).status).toBe(400);
  expect(mocks.soul).not.toHaveBeenCalled();
});
it("sends all three references to Qwen in order", async () => {
  mocks.edit.mockResolvedValue("edit-job");
  const photoUrls = [1,2,3].map(i => `https://images.test/characters/draft-owner/photo/${i}.jpg`);
  expect((await POST(request({ model: "soul2", photoUrls }))).status).toBe(200);
  expect(mocks.edit.mock.calls[0][1]).toEqual(photoUrls);
  expect(mocks.soul).not.toHaveBeenCalled();
  expect((await POST(request({ photoUrls: [...photoUrls, photoUrls[0]] }))).status).toBe(400);
});
it("sends four single-image Soul jobs and registers each", async () => {
  mocks.soul.mockImplementation(async (_endpoint, _input, key) => key);
  const data = await (await POST(request({ count: 4, model: "soul2" }))).json();
  expect(data.jobs).toHaveLength(4); expect(mocks.soul).toHaveBeenCalledTimes(4); expect(mocks.put).toHaveBeenCalledTimes(4);
});

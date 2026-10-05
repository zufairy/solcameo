import { describe, it, expect, vi, beforeEach } from "vitest";

const callClaudeJSON = vi.fn();
vi.mock("@/lib/server/kie-claude", () => ({ callClaudeJSON }));
vi.mock("@/lib/server/nftKie", () => ({
  fetchWithTimeout: vi.fn(), pollNftTaskOnce: vi.fn(), persistStill: vi.fn(),
  sleep: vi.fn(), MAX_ATTEMPTS: 3,
}));

const { buildImagePrompt, fallbackImagePrompt } = await import("./imagePost");

const persona = {
  name: "Vesper",
  characterBible: "a deadpan barista who reviews gadgets",
  niche: "coffee gear",
  aesthetic: "warm film grain, shallow depth of field",
  brandColor: "#C86A2B",
  memories: ["posted about the new grinder", "answered a question about tamping"],
};

beforeEach(() => {
  callClaudeJSON.mockReset();
  callClaudeJSON.mockResolvedValue({ prompt: "overhead shot of a grinder beside a cortado, warm window light" });
});

describe("buildImagePrompt", () => {
  it("leads with the persona, then the operator's brief", async () => {
    await buildImagePrompt({ persona, idea: "always shot from above" });
    const user = callClaudeJSON.mock.calls[0][0].user as string;
    expect(user.indexOf("ACCOUNT: Vesper")).toBeLessThan(user.indexOf("OPERATOR'S BRIEF"));
    expect(user).toContain("warm film grain");
    expect(user).toContain("always shot from above");
  });

  // Repeating an image is the failure this feature is most likely to have, so what
  // the account posted recently goes in as something to build ON, not copy.
  it("passes recent posts as context to avoid repeats", async () => {
    await buildImagePrompt({ persona });
    const user = callClaudeJSON.mock.calls[0][0].user as string;
    expect(user).toContain("don't repeat these");
    expect(user).toContain("new grinder");
  });

  it("returns the generated prompt", async () => {
    expect(await buildImagePrompt({ persona })).toContain("cortado");
  });

  it("returns '' when the model is unreachable, so the caller can fall back", async () => {
    callClaudeJSON.mockRejectedValue(new Error("kie down"));
    expect(await buildImagePrompt({ persona })).toBe("");
  });
});

describe("fallbackImagePrompt", () => {
  // A plain on-brand still beats skipping the post entirely.
  it("still produces an on-brand prompt with no model call", () => {
    const out = fallbackImagePrompt(persona, "the new grinder");
    expect(out).toContain("the new grinder");
    expect(out).toContain("warm film grain");
    expect(out).toContain("#C86A2B");
  });

  it("works with nothing but a name", () => {
    expect(fallbackImagePrompt({ name: "Vesper" })).toContain("Vesper");
  });
});

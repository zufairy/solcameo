import { expect, it, vi } from "vitest";
vi.mock("./staticFace", () => ({ ensureStaticFace: vi.fn(async (u: string) => ({ url: u.replace(/\.gif.*$/, ".png") })) }));
import { identityStills } from "./identityStill";

it("uses the agent's own minted still for its avatar", async () => {
  const agent = { avatarUrl: "https://x.test/a.gif", avatarStills: ["https://x.test/still.png"] };
  expect(await identityStills(["https://x.test/a.gif"], agent)).toEqual(["https://x.test/still.png"]);
});
it("cuts any other animated picture down to a still frame", async () => {
  expect(await identityStills(["https://x.test/other.gif"], null)).toEqual(["https://x.test/other.png"]);
});
it("leaves static images alone", async () => {
  expect(await identityStills(["https://x.test/b.jpg"], null)).toEqual(["https://x.test/b.jpg"]);
});

// @vitest-environment happy-dom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CameoPrompt } from "./CameoPrompt";

const agents = [
  { mintAddress: "me", name: "Me", avatarUrl: "https://x/me.png" },
  { mintAddress: "a", name: "Luna Star", avatarUrl: "https://x/luna.png" },
  { mintAddress: "b", name: "Kai", avatarUrl: "https://x/kai.png" },
];
vi.mock("convex/react", () => ({ useQuery: () => agents }));
vi.mock("@/convex/_generated/api", () => ({ api: { influencers: { listSearchable: "x" } } }));

const item = { id: "r", title: "Rap", description: "", previewUrl: "", videoUrl: "https://v", duration: 8, category: "Performance" };

describe("CameoPrompt", () => {
  it("reports mentioned agents (excluding the primary) as cast, in mention order", async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "off" }), { status: 502 })) as typeof fetch;
    const onCast = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => createRoot(host).render(
      <CameoPrompt mint="me" primaryName="Me" item={item} value="@Kai chats with @LunaStar and @Nobody" onChange={() => {}} onCast={onCast} />,
    ));
    const last = onCast.mock.calls.at(-1)![0] as Array<{ token: string }>;
    expect(last.map((c) => c.token)).toEqual(["Kai", "LunaStar"]);
  });
});

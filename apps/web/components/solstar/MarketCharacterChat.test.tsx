// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  live: {
    messages: [] as {
      _id: string;
      createdAt: number;
      role: string;
      author: string;
      body: string;
      authorImage?: string;
      agentReaction?: string;
      hint?: string;
    }[],
    plot: null,
  },
  older: {
    messages: [] as {
      _id: string;
      createdAt: number;
      role: string;
      author: string;
      body: string;
    }[],
    plot: null,
  },
}));
vi.mock("convex/react", () => ({
  useQuery: (_fn: unknown, args: { before?: number } | string) =>
    args === "skip"
      ? undefined
      : typeof args === "object" && args.before
        ? m.older
        : m.live,
}));
vi.mock("@/providers/supabase-auth-provider", () => ({
  useSupabaseAuth: () => ({ authenticated: false, login: vi.fn() }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string;
    variant?: string;
  }) => {
    void _size;
    void _variant;
    return <button {...props}>{children}</button>;
  },
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));
import { MarketCharacterChat } from "./MarketCharacterChat";
let root: Root, host: HTMLDivElement;
const message = (id: string, createdAt: number) => ({
  _id: id,
  createdAt,
  role: "fan",
  author: "fan",
  body: id,
});
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
  m.live = { messages: [message("latest message", 200)], plot: null };
  m.older = { messages: [message("older message", 100)], plot: null };
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("keeps history and live updates in one conversation without the removed header", async () => {
  await act(async () =>
    root.render(<MarketCharacterChat characterId="coin" />),
  );
  expect(host.textContent).not.toContain("Community chat");
  await act(async () =>
    (host.querySelector("button") as HTMLButtonElement).click(),
  );
  expect(host.textContent).toContain("older message");
  expect(host.textContent).toContain("latest message");
  m.live = { messages: [message("incoming message", 300)], plot: null };
  await act(async () =>
    root.render(<MarketCharacterChat characterId="coin" />),
  );
  expect(host.textContent).toContain("older message");
  expect(host.textContent).toContain("latest message");
  expect(host.textContent).toContain("incoming message");
  expect(host.textContent).not.toContain("Load earlier messages");
});

it("shows profile pictures, falls back to the Solcameo star, and renders the agent's reaction and next-video hint", async () => {
  m.live = {
    messages: [
      { ...message("with picture", 100), author: "Fan 1", authorImage: "https://img.test/p.png", agentReaction: "🔥" },
      { ...message("without picture", 200), author: "Fan 2" },
      { ...message("agent reply", 300), role: "agent", author: "agent", hint: "Expect neon rooftops." },
    ],
    plot: null,
  };
  host.id = "root"; document.body.append(host);
  await act(async () => root.render(<MarketCharacterChat characterId="coin" agentName="Nova" agentImageUrl="https://img.test/nova.png" />));
  const text = host.textContent ?? "";
  expect(text).toContain("Next video hint");
  expect(text).toContain("Expect neon rooftops.");
  expect(host.querySelector('[aria-label="Nova reacted with 🔥"]')).toBeTruthy();
  // The star mark stands in wherever a picture is missing (the fan without one, and every avatar until images load).
  expect(host.querySelectorAll('img[src="/brand/solcameo-mark.png"]').length).toBeGreaterThanOrEqual(1);
  expect(text).not.toContain("top of each hour");
  host.remove();
});

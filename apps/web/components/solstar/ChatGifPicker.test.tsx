// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

class IO { observe() {} disconnect() {} unobserve() {} }
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.resetModules(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("IntersectionObserver", IO); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const gif = (id: string) => ({ id, title: `gif ${id}`, images: { fixed_width: { url: `https://media1.giphy.com/media/${id}/200w.gif`, width: "200", height: "150" }, downsized_medium: { url: `https://media1.giphy.com/media/${id}/giphy.gif` } } });

it("falls back to quick reactions without a GIPHY key and sends the picked GIF", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ apiKey: null }) })));
  const { ChatGifPicker } = await import("./ChatGifPicker");
  const onPick = vi.fn();
  await act(async () => root.render(<ChatGifPicker onPick={onPick} onClose={() => undefined} />));
  await act(async () => { await Promise.resolve(); });
  const first = host.querySelector<HTMLButtonElement>("button[aria-label^='Add GIF']");
  expect(first).not.toBeNull();
  expect(host.textContent).toContain("Add a GIPHY key");
  await act(async () => first!.click());
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/^https:\/\/media\.giphy\.com\//) }));
});
it("lists trending GIPHY results, keeps only GIPHY-hosted GIFs and picks the full-size one", async () => {
  const fetchMock = vi.fn(async (url: string) => url.startsWith("/api/") ? ({ ok: true, json: async () => ({ apiKey: "k" }) }) : ({ ok: true, json: async () => ({ data: [gif("a"), { ...gif("b"), images: { fixed_width: { url: "https://evil.example/b.gif", width: "1", height: "1" } } }], pagination: { total_count: 2 } }) }));
  vi.stubGlobal("fetch", fetchMock);
  const { ChatGifPicker } = await import("./ChatGifPicker");
  const onPick = vi.fn();
  await act(async () => root.render(<ChatGifPicker onPick={onPick} onClose={() => undefined} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const buttons = host.querySelectorAll<HTMLButtonElement>("button[aria-label^='Add GIF']");
  expect(buttons).toHaveLength(1);
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/trending"))).toBe(true);
  await act(async () => buttons[0].click());
  expect(onPick).toHaveBeenCalledWith({ url: "https://media1.giphy.com/media/a/giphy.gif", alt: "gif a" });
});

// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("next/image", () => ({ default: (p: { alt: string }) => React.createElement("img", { alt: p.alt }) }));
vi.mock("@solana/wallet-adapter-react-ui", () => ({ useWalletModal: () => ({ setVisible: vi.fn() }) }));
vi.mock("@/hooks/use-solana-wallet", () => ({ useUnifiedSolanaWallet: () => ({ publicKey: { toBase58: () => "WALLET" } }) }));
vi.mock("@/hooks/use-siws-session", () => ({ useSiwsSession: () => ({ ensureSiwsSession: async () => "tok" }) }));
vi.mock("@/assets/logoblack.png", () => ({ default: { src: "/x.png", width: 1, height: 1 } }));
// happy-dom can't decode SVG images; the real rasteriser is checked in Chromium separately.
vi.mock("./avatar-art", async (orig) => ({ ...(await orig<typeof import("./avatar-art")>()), avatarPng: async () => "data:image/png;base64,AAAA" }));
import AgentSetupFlow from "./AgentSetupFlow";

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.sessionStorage.clear(); replace.mockReset();
  window.matchMedia = window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); };
const btn = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text));
const setInput = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 700)); });

it("walks the clipper flow: generic names blocked, 1-3 min deep cuts, free avatar, mint call", async () => {
  const mint = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("save-draft")) return new Response(JSON.stringify({ avatarUrls: ["https://cdn/x.png"] }), { status: 200 });
    if (u.includes("/api/nft/mint")) return new Response(JSON.stringify({ mintAddress: "MINT1" }), { status: 200 });
    throw new Error("unexpected fetch " + u + init);
  });
  vi.stubGlobal("fetch", mint);
  await act(async () => root.render(<AgentSetupFlow initialType="clipping" />));
  await settle();

  // niche
  expect((btn("Next") as HTMLButtonElement).disabled).toBe(true);
  await click(host.querySelector('button[aria-haspopup="listbox"]'));
  await click([...host.querySelectorAll('[role="option"] button')].find((b) => b.textContent?.includes("Finance")));
  await click(btn("Next")); await settle();

  // name: generic blocked
  const input = host.querySelector("#agent-name") as HTMLInputElement;
  await setInput(input, "New agent");
  expect((btn("Next") as HTMLButtonElement).disabled).toBe(true);
  expect(host.textContent).toContain("Give it a name");
  await setInput(input, "FinanceClips");
  expect((btn("Next") as HTMLButtonElement).disabled).toBe(false);
  await click(btn("Next")); await settle();

  // clips
  expect(host.textContent).toContain("1 to 3 minutes");
  expect(host.textContent).toContain("30 seconds to 1 minute");
  await click(btn("Next")); await settle();

  // look: no generation needed, can continue immediately
  expect(host.textContent).toContain("No credits used");
  await click(btn("Looks good")); await settle();

  // launch
  await click(btn("Create agent"));
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  const urls = mint.mock.calls.map((c) => String(c[0]));
  expect(urls.some((u) => u.includes("generate-nft-images"))).toBe(false);
  expect(urls.some((u) => u.includes("/api/nft/mint"))).toBe(true);
  expect(replace).toHaveBeenCalledWith(expect.stringContaining("mint=MINT1"));
});

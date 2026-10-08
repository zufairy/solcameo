// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CharacterTab } from "./CharacterTab";

vi.mock("convex/react", () => ({ useQuery: () => ({ coinTicker: "ORBIT" }) }));
vi.mock("@/providers/supabase-auth-provider", () => ({ useSupabaseAuth: () => ({ authenticated: true, accessToken: "test" }) }));

vi.mock("@/hooks/use-solana-wallet", () => ({ useUnifiedSolanaWallet: () => ({ publicKey: null, signTransaction: undefined, connected: false, connecting: false }) }));
vi.mock("@/lib/client/usdcClient", () => ({ useWalletUsdc: () => ({ usdc: 0, refresh: async () => 0 }), useWalletSol: () => ({ sol: 0, refresh: async () => 0 }), sendUsdc: vi.fn() }));
vi.mock("@/components/wallet/AddFundsButton", () => ({ default: () => null }));

let root: Root;
let host: HTMLDivElement;
const calls: { url: string; init?: RequestInit }[] = [];
let saved: unknown = null;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url.startsWith("/api/character?")) return json({ character: saved });
    if (url === "/api/character/generate") return json({ jobs: [{ model: "soul", requestId: "req_soul_1" }] });
    return json({ error: "nope" }, 404);
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); saved = null; });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

it("shows the builder for an agent without a character and enables Generate after a pick", async () => {
  await act(async () => root.render(<CharacterTab mintAddress="mint_abc" />));
  await flush();
  expect(host.textContent).toContain("AI Influencer");
  const gen = [...host.querySelectorAll("button")].find((b) => /Generate|Pick a trait/.test(b.textContent ?? ""))!;
  expect(gen.disabled).toBe(true);
  const female = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Female")!;
  await act(async () => female.click());
  expect(female.getAttribute("aria-pressed")).toBe("true");
  expect(gen.disabled).toBe(false);
  const selector = host.querySelector<HTMLSelectElement>('select[aria-label="Higgsfield model"]')!;
  expect(selector.value).toBe("soul2");
  expect([...selector.options].map(option => option.value)).toEqual(["soul", "soul2", "nano"]);
  expect(selector.options[2].disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Upload reference images"]')?.multiple).toBe(true);
});

it("shows the saved character instead of the builder, with an Edit action", async () => {
  saved = {
    version: 1, tier: "normal", selection: { gender: ["female"] }, prompt: "p", model: "soul",
    image: { model: "soul", url: "https://cdn.test/characters/mint_abc/a.png" }, candidates: [], updatedAt: 1,
  };
  await act(async () => root.render(<CharacterTab mintAddress="mint_abc" />));
  await flush();
  expect(host.textContent).toContain("Saved");
  expect(host.textContent).toContain("ORBIT");
  expect(host.querySelector("img[src='https://cdn.test/characters/mint_abc/a.png']")).toBeTruthy();
  const edit = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Edit character"))!;
  await act(async () => edit.click());
  await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
  expect(host.textContent).toContain("AI Influencer");
});

it("asks to mint first when there is no mint address", async () => {
  await act(async () => root.render(<CharacterTab />));
  expect(host.textContent).toContain("Mint your agent");
});

it("uses Nano Banana Pro for multiple references and restores Soul after removing them", async () => {
  await act(async () => root.render(<CharacterTab onboarding initialCharacter={{version:1,tier:"normal",selection:{gender:["female"]},prompt:"p",model:"soul2",image:{model:"soul2",url:"https://test/image.jpg"},candidates:[],photoUrls:["https://test/one.jpg","https://test/two.jpg"],updatedAt:1}} />));
  const selector = host.querySelector<HTMLSelectElement>('select[aria-label="Higgsfield model"]')!;
  expect(selector.value).toBe("nano");
  expect(selector.disabled).toBe(true);
  expect(host.querySelectorAll('img[alt^="Reference"]')).toHaveLength(2);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Remove reference 2"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Remove reference 1"]')!.click());
  expect(selector.value).toBe("soul2");
  expect(selector.disabled).toBe(false);
});

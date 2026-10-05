// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: { alt: string }) => React.createElement("img", { alt: p.alt }) }));
vi.mock("@/assets/logoblack.png", () => ({ default: { src: "/x.png", width: 1, height: 1 } }));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn(), useQuery: () => [] }));
vi.mock("@/convex/_generated/api", () => ({ api: { campaigns: { create: "c", generateUploadUrl: "g", listDraftsByCreator: "l" } } }));
vi.mock("@/hooks/use-solana-wallet", () => ({ useUnifiedSolanaWallet: () => ({ publicKey: { toBase58: () => "W" }, signTransaction: vi.fn(), connected: true, connecting: false }) }));
vi.mock("@/hooks/use-siws-session", () => ({ useSiwsSession: () => ({ ensureSiwsSession: async () => "t" }) }));
vi.mock("@/providers/supabase-auth-provider", () => ({ useSupabaseAuth: () => ({ promptLogin: vi.fn() }) }));
vi.mock("@/lib/escrow", () => ({ buildEscrowProgram: vi.fn(), createCampaignTx: vi.fn(), checkVaultFunded: vi.fn(), getCampaignPda: vi.fn() }));
vi.mock("@/lib/client/usdcClient", () => ({ useWalletUsdc: () => ({ usdc: 500, refresh: vi.fn() }), useWalletSol: () => ({ sol: 1, refresh: vi.fn() }), checkFunding: vi.fn() }));
vi.mock("@privy-io/react-auth/solana", () => ({ useFundWallet: () => ({ fundWallet: vi.fn() }) }));
import { CampaignForm } from "./campaign-form";

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
  window.scrollTo = (() => {}) as never;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ videos: [{ url: "https://y/1", name: "a" }] }), { status: 200 })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 450)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const btn = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t));
const type = async (sel: string, v: string) => {
  const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
  expect(el).toBeTruthy();
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  });
};

it("walks all seven screens to the review and opens the deposit sheet", async () => {
  await act(async () => root.render(<CampaignForm />));
  await settle();
  expect(host.textContent).toContain("What kind of campaign?");
  await click(btn("Continue"));

  // basics: validation blocks empty
  await click(btn("Continue"));
  expect(host.textContent).toContain("Who is it for?");
  await type("#brandName", "Northwind");
  await type("#title", "Raya 2026 launch");
  await click(btn("Continue"));

  // brief: needs 50 chars + a requirement
  expect(host.textContent).toContain("What should the content say?");
  await type("#brief", "Make short punchy clips that show the product in use, keep the tone upbeat and clear.");
  await click(btn("Continue"));
  expect(host.textContent).toContain("Add at least one requirement");
  await type('input[placeholder^="clip along"]', "Tag the brand");
  await click(btn("Continue"));

  // source: clipping needs a link + rights
  expect(host.textContent).toContain("What should agents clip?");
  await type('input[type="url"]', "https://www.youtube.com/watch?v=abc");
  await click(btn("Continue"));
  expect(host.textContent).toContain("permission");
  await click(host.querySelector('input[type="checkbox"]'));
  await click(btn("Continue"));

  // audience
  expect(host.textContent).toContain("Who should see it, and where?");
  await click(btn("Continue"));

  // reward
  expect(host.textContent).toContain("Set the reward and see the reach");
  await click(btn("Continue"));

  // launch
  expect(host.textContent).toContain("Ready to go live?");
  expect(host.textContent).toContain("Northwind");
  expect(host.textContent).toContain("Raya 2026 launch");
  await click(btn("Review deposit"));
  expect(document.body.textContent).toContain("Sign one transaction");
}, 60_000);

it("blocks budgets under $1,000 on the reward screen", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ videos: [{ url: "https://y/1", name: "a" }] }), { status: 200 })));
  await act(async () => root.render(<CampaignForm />));
  await settle();
  // jump straight to the reward screen via the step rail is gated, so walk quickly
  await click(btn("Continue"));
  await type("#brandName", "Northwind"); await type("#title", "Raya 2026 launch"); await click(btn("Continue"));
  await type("#brief", "Make short punchy clips that show the product in use, keep the tone upbeat and clear."); 
  await type('input[placeholder^="clip along"]', "Tag the brand"); await click(btn("Continue"));
  await type('input[type="url"]', "https://www.youtube.com/watch?v=abc");
  await click(host.querySelector('input[type="checkbox"]')); await click(btn("Continue"));
  await click(btn("Continue")); // audience
  expect(host.textContent).toContain("Set the reward and see the reach");
  expect(host.textContent).toContain("Your budget buys about");
  await type("#budget", "500");
  await click(btn("Continue"));
  expect(host.textContent).toContain("Minimum campaign budget is $1,000");
  expect(host.textContent).toContain("Set the reward and see the reach");
}, 60_000);

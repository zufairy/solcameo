// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: mocks.query }));
vi.mock("@/components/builder/DepositModal", () => ({ default: ({ open }: { open: boolean }) => (open ? <div>Deposit modal</div> : null) }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
import { LaunchReady } from "./LaunchReady";
let root: Root; let host: HTMLDivElement;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function mount(balance: number, onNavigate = vi.fn()) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, usdc: balance }))));
  mocks.query.mockReturnValue({ agentWallet: "AgentWallet1111111111111111111111111111111111" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<LaunchReady open characterId="char1" name="Nova" ticker="nova" live onClose={() => undefined} onNavigate={onNavigate} />));
  await act(async () => { await Promise.resolve(); });
}
it("asks an unfunded creator to add funds and opens the deposit flow", async () => {
  await mount(0);
  expect(host.textContent).toContain("Nova is ready");
  expect(host.textContent).not.toMatch(/mainnet/i);
  const add = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.includes("Add funds"))!;
  await act(async () => { add.click(); });
  expect(host.textContent).toContain("Deposit modal");
});
it("offers the first video once the agent wallet holds enough USDC", async () => {
  const onNavigate = vi.fn();
  await mount(5, onNavigate);
  const go = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.includes("Generate first video"))!;
  expect(go).toBeTruthy();
  await act(async () => { go.click(); });
  expect(onNavigate).toHaveBeenCalledWith("/control?agent=char1");
});

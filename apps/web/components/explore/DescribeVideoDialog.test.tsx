// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: m.query, useMutation: () => vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ children }: { children: unknown }) => <span>{typeof children === "function" ? (children as (v: string) => React.ReactNode)("mint1") : null}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/builder/FundAgentDialog", () => ({ FundAgentDialog: ({ open }: { open: boolean }) => (open ? <div>Fund dialog</div> : null) }));
vi.mock("@/components/builder/AgentPayStatus", () => ({ AgentPayStatus: () => null }))
vi.mock("@/components/builder/generate/MentionTextarea", () => ({
  MentionTextarea: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <textarea aria-label="Prompt" value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("@/hooks/use-solana-wallet", () => ({ useUnifiedSolanaWallet: () => ({ publicKey: null, signTransaction: undefined }) }));
vi.mock("@/lib/client/usdcClient", () => ({ sendUsdc: vi.fn() }));
import { DescribeVideoDialog } from "./DescribeVideoDialog";

let root: Root; let host: HTMLDivElement;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const agents = [{ mintAddress: "mint1", name: "Nova", coinTicker: "NOVA", avatarUrl: "https://cdn.test/n.png", agentWallet: "Wallet1" }];

async function mount(fetchBody: unknown, status = 200, list: typeof agents | never[] = agents) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(fetchBody), { status }));
  vi.stubGlobal("fetch", fetchMock);
  m.query.mockReturnValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<DescribeVideoDialog open onOpenChange={() => undefined} agents={list as typeof agents} />));
  const box = host.querySelector("textarea")!;
  await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!; set.call(box, "A day in Tokyo"); box.dispatchEvent(new Event("input", { bubbles: true })); });
  return fetchMock;
}
const generateButton = () => Array.from(host.querySelectorAll("button")).find((b) => /\$|Generate/.test(b.textContent ?? "") && !b.disabled)!;

it("starts a create_video task for the chosen agent with the engine, quality and length", async () => {
  const fetchMock = await mount({ ok: true, taskId: "task1" });
  await act(async () => { generateButton().click(); });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/agents/run-task");
  const body = JSON.parse(init.body as string);
  expect(body).toMatchObject({ mintAddress: "mint1", taskType: "create_video", triggeredBy: "explore" });
  expect(body.input.topic).toBe("A day in Tokyo");
  expect(typeof body.input.videoEngine).toBe("string");
});
it("opens the fund dialog when the agent wallet cannot pay", async () => {
  await mount({ ok: false, error: "insufficient_funds", code: "needs_funding", agentWallet: "Wallet1" }, 402);
  await act(async () => { generateButton().click(); });
  expect(host.textContent).toContain("Fund dialog");
  expect(host.textContent).toContain("wallet");
});

it("offers posting to X only for an agent with X connected, and sends it with the render", async () => {
  const fetchMock = await mount({ ok: true, taskId: "task1" }, 200, [{ ...agents[0], connectedPlatforms: ["x"] }] as never);
  const toggle = Array.from(host.querySelectorAll("label")).find((l) => /Post to X/.test(l.textContent ?? ""))!.querySelector("input")!;
  await act(async () => { toggle.click(); });
  await act(async () => { generateButton().click(); });
  const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.input.autoPost).toEqual({ platforms: ["x"] });
});
it("does not offer X when the agent has not connected it", async () => {
  await mount({ ok: true }, 200);
  expect(host.textContent).not.toContain("Post to X");
});
it("makes a video without an influencer: the form shows, and it needs a reference image before it can be paid for", async () => {
  await mount({ ok: true }, 200, []);
  expect(host.textContent).toContain("No influencer");
  expect(host.textContent).toContain("Add a reference image");
  expect(host.textContent).not.toContain("Skip storyboard");
  expect(Array.from(host.querySelectorAll("button")).some((b) => /\$/.test(b.textContent ?? "") && !b.disabled)).toBe(false);
});

it("lists influencers you do not own as a wallet-paid choice, and uses their portrait with no upload", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ taskId: "t9" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  m.query.mockImplementation((_ref: unknown, args: unknown) => (args === "skip" ? undefined : [{ mintAddress: "other1", name: "Zed", ticker: "ZED", avatarUrl: "https://cdn.test/z.png" }]));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<DescribeVideoDialog open onOpenChange={() => undefined} agents={agents} />));
  expect(host.textContent).toContain("Anyone else");
  expect(host.textContent).toContain("Zed");
});

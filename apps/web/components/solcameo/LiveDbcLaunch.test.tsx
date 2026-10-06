// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sign: vi.fn(), complete: vi.fn(), modal: vi.fn() }));
vi.mock("@/hooks/use-solana-wallet", () => ({ useUnifiedSolanaWallet: () => ({ publicKey: { toBase58: () => "wallet" }, signTransaction: m.sign }) }));
vi.mock("@solana/wallet-adapter-react-ui", () => ({ useWalletModal: () => ({ setVisible: m.modal }) }));
vi.mock("@/lib/client/siwsIdentity", () => ({ ensureSiwsViaRegistered: async () => true }));
vi.mock("@solana/web3.js", () => ({ Keypair: { generate: () => ({ publicKey: { toBase58: () => "mint" }, secretKey: [1] }), fromSecretKey: () => ({}) }, VersionedTransaction: { deserialize: () => ({ sign: vi.fn(), serialize: () => new Uint8Array([1]) }) } }));
import { LiveDbcLaunch } from "./LiveDbcLaunch";
import { DEFAULT_DBC } from "@/lib/meteora/options";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); sessionStorage.clear(); });
it("resumes the platform pool through its dedicated endpoint without paying for another configuration", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const actions: string[] = [];
  m.sign.mockImplementation(async tx => tx);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/meteora/readiness")) return new Response(JSON.stringify({ ready: true, balanceLamports: 100000000 }));
    expect(url).toBe("/api/tokenomics/launch");
    const body = JSON.parse(init!.body as string); actions.push(body.action);
    return new Response(JSON.stringify(body.action === "recover" ? { mode: "resume", stage: "pool", transaction: "AQ==", receipt: "receipt" } : body.action === "submit" ? { signature: "signature" } : body.action === "confirm" ? { complete: true } : { transaction: "AQ==", receipt: "receipt" }));
  }));
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<LiveDbcLaunch characterId="platform" endpoint="/api/tokenomics/launch" platform options={{ ...DEFAULT_DBC, autopilot: false }} autoStart onComplete={m.complete} />); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(actions).toEqual(["recover", "refresh", "submit", "confirm"]);
  expect(m.sign).toHaveBeenCalledTimes(1);
  expect(m.complete).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
it("continues into both wallet approvals automatically after the network check", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stages: string[] = []; let confirmations = 0;
  m.sign.mockImplementation(async tx => tx);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/meteora/readiness")) return new Response(JSON.stringify({ ready: true, balanceLamports: 100000000 }));
    const body = JSON.parse(init!.body as string); stages.push(body.action);
    const prepared = { transaction: "AQ==", receipt: "receipt" };
    return new Response(JSON.stringify(body.action === "submit" ? { signature: "confirmed-signature" } : body.action === "confirm" && ++confirmations === 2 ? { complete: true } : prepared));
  }));
  const host = document.createElement("div"); const root = createRoot(host);
  await act(async () => { root.render(<LiveDbcLaunch characterId="coin" options={DEFAULT_DBC} autoStart onComplete={m.complete} />); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(m.sign).toHaveBeenCalledTimes(2);
  expect(stages).toEqual(["prepare", "refresh", "submit", "confirm", "refresh", "submit", "confirm"]);
  expect(m.complete).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
it("refreshes an expired wallet approval and resumes the same launch", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let submissions = 0, confirmations = 0;
  m.sign.mockImplementation(async tx => tx);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/meteora/readiness")) return new Response(JSON.stringify({ready: true, balanceLamports: 100000000}));
    const body = JSON.parse(init!.body as string);
    if (body.action === "submit" && ++submissions === 1) return new Response(JSON.stringify({error: "Approval expired", code: "BLOCKHASH_EXPIRED"}), {status:409});
    if (body.action === "submit") return new Response(JSON.stringify({signature: "confirmed-signature"}));
    if (body.action === "confirm" && ++confirmations === 2) return new Response(JSON.stringify({complete: true}));
    return new Response(JSON.stringify({transaction: "AQ==", receipt: "updated-receipt"}));
  }));
  const host=document.createElement("div"),root=createRoot(host);
  await act(async()=>{root.render(<LiveDbcLaunch characterId="coin" options={DEFAULT_DBC} autoStart onComplete={m.complete}/>);});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  expect(m.sign).toHaveBeenCalledTimes(3);expect(m.complete).toHaveBeenCalledTimes(1);
  expect(sessionStorage.length).toBe(0);
  await act(async()=>root.unmount());
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { encodePaymentSignatureHeader, decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { SOLANA_DEVNET, DEVNET_USDC } from "@/lib/server/x402/config";
const mocked = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), verify: vi.fn(), settle: vi.fn(), report: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = mocked.query; mutation = mocked.mutation; } }));
const mint = "So11111111111111111111111111111111111111112";
const resource = `https://vello.test/api/intelligence/solana?mint=${mint}`;
const requirement = { scheme:"exact", network:SOLANA_DEVNET, asset:DEVNET_USDC, amount:"10000", payTo:mint, maxTimeoutSeconds:60, extra:{feePayer:mint} };
vi.mock("@/lib/server/x402/resourceServer", () => ({ getResourceServer: async () => ({
  config: {network:SOLANA_DEVNET,asset:DEVNET_USDC,payTo:mint,facilitatorUrl:"https://facilitator.test"}, requirements:[requirement],
  server: { createPaymentRequiredResponse: async () => ({x402Version:2,resource:{url:resource},accepts:[requirement]}), verifyPayment:mocked.verify,settlePayment:mocked.settle },
}) }));
vi.mock("@/lib/server/solami", () => ({ buildSolamiReport:mocked.report }));
import { GET } from "./route";
const payment = () => encodePaymentSignatureHeader({x402Version:2,resource:{url:resource},accepted:requirement,payload:{transaction:"AQID"}});
function req(header?: string) { return new NextRequest(resource,{headers:header?{"PAYMENT-SIGNATURE":header}:{}}); }
beforeEach(() => {
  vi.clearAllMocks();
  for (const [k,v] of Object.entries({X402_ENABLED:"true",X402_RESOURCE_ORIGIN:"https://vello.test",NEXT_PUBLIC_CONVEX_URL:"https://convex.test",INTERNAL_CRON_SECRET:"secret",SOLAMI_API_KEY:"key"})) vi.stubEnv(k,v);
  mocked.query.mockResolvedValue(null); mocked.mutation.mockResolvedValue(true); mocked.verify.mockResolvedValue({isValid:true});
  mocked.settle.mockResolvedValue({success:true,transaction:"tx",network:SOLANA_DEVNET,payer:mint}); mocked.report.mockResolvedValue({provider:"solami",mint,evidence:[{signature:"source-tx"}]});
});
afterEach(() => vi.unstubAllEnvs());
describe("agent-facing x402 Solami API", () => {
  it("returns interoperable v2 challenge without accessing paid data", async () => {
    const res = await GET(req()); expect(res.status).toBe(402);
    expect(decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!).accepts[0].amount).toBe("10000");
    expect(mocked.report).not.toHaveBeenCalled(); expect(mocked.settle).not.toHaveBeenCalled();
  });
  it("validates live data before settlement and returns a receipt", async () => {
    const res = await GET(req(payment())); expect(res.status).toBe(200);
    expect(mocked.report.mock.invocationCallOrder[0]).toBeLessThan(mocked.settle.mock.invocationCallOrder[0]);
    expect(decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE")!).transaction).toBe("tx");
  });
  it("never settles again on cached receipt replay", async () => {
    const first = await GET(req(payment())); const receipt = first.headers.get("PAYMENT-RESPONSE")!;
    mocked.settle.mockClear(); mocked.query.mockResolvedValue({state:"paid",resource,report:'{"cached":true}',receipt});
    const res = await GET(req(payment())); expect(res.status).toBe(200); expect(await res.json()).toEqual({cached:true}); expect(mocked.settle).not.toHaveBeenCalled();
  });
  it("keeps settlement ambiguity pending and does not disclose the unpaid report", async () => {
    mocked.settle.mockRejectedValue(new Error("timeout"));
    const res = await GET(req(payment())); expect(res.status).toBe(202); expect(await res.json()).not.toHaveProperty("provider");
    mocked.settle.mockClear(); mocked.query.mockResolvedValue({state:"unknown",resource,report:"{}"});
    expect((await GET(req(payment()))).status).toBe(202); expect(mocked.settle).not.toHaveBeenCalled();
  });
  it("never settles a permanently cancelled proof", async () => {
    mocked.query.mockResolvedValue({state:"cancelled",resource,report:"{}"});
    const res=await GET(req(payment())); expect(res.status).toBe(409); expect(mocked.settle).not.toHaveBeenCalled();
  });
  it("refuses stale data before attempting payment", async () => {
    mocked.report.mockRejectedValue(new Error("stale"));
    expect((await GET(req(payment()))).status).toBe(503); expect(mocked.settle).not.toHaveBeenCalled();
  });
  it("refuses client-chosen prices and resource substitution", async () => {
    const bad = encodePaymentSignatureHeader({x402Version:2,resource:{url:resource},accepted:{...requirement,amount:"1"},payload:{transaction:"AQID"}});
    expect((await GET(req(bad))).status).toBe(400); expect(mocked.verify).not.toHaveBeenCalled();
  });
  it("rejects cross-resource proof reuse", async () => {
    mocked.query.mockResolvedValue({state:"paid",resource:"different",report:"{}",receipt:"receipt"});
    expect((await GET(req(payment()))).status).toBe(409); expect(mocked.settle).not.toHaveBeenCalled();
  });
});

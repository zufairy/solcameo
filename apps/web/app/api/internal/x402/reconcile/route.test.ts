// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encodePaymentSignatureHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { SOLANA_DEVNET, DEVNET_USDC } from "@/lib/server/x402/config";
const mocks = vi.hoisted(() => ({ auth:vi.fn(), query:vi.fn(), mutation:vi.fn(), genesis:vi.fn(), transaction:vi.fn() }));
vi.mock("@/lib/server/requireAuth",()=>({checkInternalSecret:mocks.auth}));
vi.mock("convex/browser",()=>({ConvexHttpClient:class {query=mocks.query;mutation=mocks.mutation;}}));
vi.mock("@solana/web3.js",async original=>{const actual=await original<typeof import("@solana/web3.js")>();return {...actual,Connection:class {getGenesisHash=mocks.genesis;getTransaction=mocks.transaction;}};});
vi.mock("@solana/kit",async original=>{const actual=await original<typeof import("@solana/kit")>();return {...actual,getTransactionDecoder:()=>({decode:()=>({messageBytes:new Uint8Array([1,2,3]),signatures:{agent:new Uint8Array([1])}})})};});
import { POST } from "./route";
const mint="So11111111111111111111111111111111111111112";
const paymentHeader=encodePaymentSignatureHeader({x402Version:2,accepted:{scheme:"exact",network:SOLANA_DEVNET,asset:DEVNET_USDC,payTo:mint,amount:"10000",maxTimeoutSeconds:60,extra:{}},payload:{transaction:"AQID"}});
const request=()=>new NextRequest("https://vello.test/api/internal/x402/reconcile",{method:"POST",body:JSON.stringify({proofHash:"a".repeat(64),txSignature:"1".repeat(64)})});
beforeEach(()=>{
  vi.clearAllMocks();
  for(const [k,v] of Object.entries({X402_ENABLED:"true",X402_NETWORK:SOLANA_DEVNET,X402_PAY_TO:mint,X402_FACILITATOR_URL:"https://facilitator.test",NEXT_PUBLIC_CONVEX_URL:"https://convex.test",INTERNAL_CRON_SECRET:"secret"}))vi.stubEnv(k,v);
  mocks.auth.mockReturnValue(true);mocks.query.mockResolvedValue({state:"unknown",paymentHeader});mocks.genesis.mockResolvedValue(SOLANA_DEVNET.slice(7)+"fullGenesisSuffix");
  mocks.transaction.mockResolvedValue({meta:{err:null},transaction:{message:{serialize:()=>new Uint8Array([1,2,3])}}});mocks.mutation.mockResolvedValue(null);
});
afterEach(()=>vi.unstubAllEnvs());
describe("x402 recovery verifies chain evidence without sending funds",()=>{
  it("requires internal authorization before any chain read",async()=>{mocks.auth.mockReturnValue(false);expect((await POST(request())).status).toBe(401);expect(mocks.transaction).not.toHaveBeenCalled();});
  it("records the receipt for the exact confirmed transaction",async()=>{const res=await POST(request());expect(res.status).toBe(200);const json=await res.json();expect(decodePaymentResponseHeader(json.receipt).success).toBe(true);expect(mocks.mutation).toHaveBeenCalledTimes(1);});
  it("rejects an unrelated transfer",async()=>{mocks.transaction.mockResolvedValue({meta:{err:null},transaction:{message:{serialize:()=>new Uint8Array([4,5,6])}}});expect((await POST(request())).status).toBe(409);expect(mocks.mutation).not.toHaveBeenCalled();});
  it("rejects wrong-chain and failed transaction proofs",async()=>{mocks.genesis.mockResolvedValue("wrongchain");expect((await POST(request())).status).toBe(503);expect(mocks.transaction).not.toHaveBeenCalled();mocks.genesis.mockResolvedValue(SOLANA_DEVNET.slice(7));mocks.transaction.mockResolvedValue({meta:{err:{failure:true}}});expect((await POST(request())).status).toBe(409);expect(mocks.mutation).not.toHaveBeenCalled();});
});

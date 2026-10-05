import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({
  query: vi.fn(),
  candidates: vi.fn(() => ["https://rpc.example"]),
}));
vi.mock("@/lib/server/solstarRoute", () => ({
  convexClient: () => ({ query: mock.query }),
  isConvexIdString: (id: unknown) =>
    typeof id === "string" && /^[a-z0-9]{1,64}$/i.test(id),
}));
vi.mock("@/lib/solana/network", () => ({ getRpcCandidates: mock.candidates }));
import { GET } from "./route";
describe("token chain reads", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());
  it("rejects invalid character ids before querying the backend", async () => {
    const res = await GET(
      new NextRequest(
        "http://localhost/api/solstar/token-chain?characterId=invalid-id",
      ),
    );
    expect(res.status).toBe(400);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it("never calls RPC for paper characters", async () => {
    mock.query.mockResolvedValue({ token: { network: "paper" } });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const res = await GET(
      new NextRequest(
        "http://localhost/api/solstar/token-chain?characterId=abc",
      ),
    );
    expect(await res.json()).toMatchObject({ available: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the mint's mainnet cluster and returns confirmed RPC results", async () => {
    mock.query.mockResolvedValue({
      token: {
        network: "mainnet",
        mint: "So11111111111111111111111111111111111111112",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: 2,
              result: {
                context: { slot: 20 },
                value: [
                  { address: "account", amount: "100", uiAmountString: "100" },
                ],
              },
            },
            {
              id: 1,
              result: {
                context: { slot: 21 },
                value: { amount: "1000", decimals: 0, uiAmountString: "1000" },
              },
            },
          ]),
        ),
      ),
    );
    const res = await GET(
      new NextRequest(
        "http://localhost/api/solstar/token-chain?characterId=abc",
      ),
    );
    expect(mock.candidates).toHaveBeenCalledWith("mainnet-beta");
    expect(await res.json()).toMatchObject({
      available: true,
      network: "mainnet",
      slot: 20,
      supply: { amount: "1000" },
    });
  });
  it("reports failed RPC reads instead of showing zero supply", async () => {
    mock.query.mockResolvedValue({
      token: {
        network: "devnet",
        mint: "So11111111111111111111111111111111111111112",
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const res = await GET(
      new NextRequest(
        "http://localhost/api/solstar/token-chain?characterId=abc",
      ),
    );
    expect(res.status).toBe(502);
  });
  it("resolves holder wallets and recovers swaps directly from confirmed RPC transactions", async () => {
    const mint = "So11111111111111111111111111111111111111112";
    mock.query.mockResolvedValue({token:{network:"devnet",mint,dbcPool:"pool"}});
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body);
      const result = Array.isArray(request) ? [{id:1,result:{context:{slot:1},value:{amount:"1000",decimals:6}}},{id:2,result:{context:{slot:1},value:[{address:"ata",amount:"100",uiAmountString:"0.0001"}]}}] : {result: request.method === "getMultipleAccounts" ? {value:[{data:{parsed:{info:{owner:"buyer"}}}}]} : request.method === "getSignaturesForAddress" ? [{signature:"confirmed-swap",blockTime:10,err:null}] : {blockTime:10,transaction:{message:{accountKeys:[{pubkey:"buyer",signer:true}]}},meta:{err:null,fee:5000,preBalances:[1000000],postBalances:[895000],preTokenBalances:[],postTokenBalances:[{mint,owner:"buyer",uiTokenAmount:{amount:"100"}}]}}};
      return new Response(JSON.stringify(result));
    }));
    const response = await GET(new NextRequest("http://localhost/api/solstar/token-chain?characterId=abc"));
    const body = await response.json();
    expect(body.holders).toEqual([{wallet:"buyer",units:"100",supplyPct:10}]);
    expect(body.trades[0]).toMatchObject({signature:"confirmed-swap",wallet:"buyer",side:"buy",units:"100",lamports:"100000"});
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ wallet: "owner", mutation: vi.fn(), query: vi.fn(), launch: vi.fn(), mint: vi.fn() }));
vi.mock("@/lib/server/solstarRoute", () => ({
  prepareAuthedJson: async (req: NextRequest) => ({ ok: true, wallet: m.wallet, secret: "test", body: await req.json() }),
  convexClient: () => ({ mutation: m.mutation, query: m.query }),
}));
vi.mock("@/lib/server/dbcLaunchRoute", () => ({ handleDbcLaunch: m.launch }));
vi.mock("@/lib/server/platformLaunchOwner", () => ({ platformLaunchOwner: () => "owner" }));
vi.mock("@/lib/server/platformTokenChain", () => ({ platformTokenMint: m.mint }));
vi.mock("@/lib/server/meteoraLaunch", () => ({ dbcReadiness: () => ({ ready: true, network: "devnet" }) }));
import { POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); m.wallet = "owner"; m.mint.mockResolvedValue(null); });
const request = (body: unknown) => new NextRequest("https://solcameo.com/api/tokenomics/launch", { method: "POST", body: JSON.stringify(body) });
const draft = { action: "draft", name: "Solcameo", description: "Platform", image: "https://solcameo.com/logo.png", initialCapSol: 30, graduationCapSol: 250 };
it("rejects another wallet before preparing any transaction", async () => {
  m.wallet = "visitor";
  expect((await POST(request({ action: "prepare" }))).status).toBe(403);
  expect(m.launch).not.toHaveBeenCalled();
});
it("saves a platform draft with fixed fee ownership and no autopilot", async () => {
  const response = await POST(request({ ...draft, options: { economy: "sustainable-v1", autopilot: true } }));
  expect(response.status).toBe(200);
  const stored = m.mutation.mock.calls[0][1];
  expect(stored.wallet).toBe("owner");
  expect(JSON.parse(stored.optionsJson)).toMatchObject({ economy: "creator-only", autopilot: false, initialCapSol: 30, graduationCapSol: 250 });
  expect(m.launch).not.toHaveBeenCalled();
});
it("blocks a second platform launch and invalid graduation caps", async () => {
  m.mint.mockResolvedValue({ toBase58: () => "live-mint" });
  expect((await POST(request(draft))).status).toBe(409);
  m.mint.mockResolvedValue(null);
  expect((await POST(request({ ...draft, graduationCapSol: 40 }))).status).toBe(400);
  expect(m.mutation).not.toHaveBeenCalled();
});
it("delegates transaction actions to the platform-bound verified launch handler", async () => {
  m.launch.mockResolvedValue(new Response("{}"));
  await POST(request({ action: "confirm", receipt: "signed-receipt" }));
  expect(m.launch.mock.calls[0][1]).toBe(true);
});

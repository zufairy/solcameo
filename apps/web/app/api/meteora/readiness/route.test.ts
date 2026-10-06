// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair } from "@solana/web3.js";
const m = vi.hoisted(() => ({
  configured: vi.fn(), storage: vi.fn(), treasury: vi.fn(),
  rpc: { getGenesisHash: vi.fn(), getSlot: vi.fn(), getAccountInfo: vi.fn(), getBalance: vi.fn() },
}));
vi.mock("@/lib/server/meteoraLaunch", () => ({ dbcReadiness: m.configured, dbcConnection: () => m.rpc }));
vi.mock("@/lib/server/imageStorage", () => ({ r2ImageConfigured: m.storage }));
vi.mock("@/lib/server/dbcTreasury", () => ({ dbcTreasury: m.treasury }));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  m.configured.mockReturnValue({ ready: true, network: "devnet" });
  m.storage.mockReturnValue(true);
  m.treasury.mockReturnValue({ publicKey: Keypair.generate().publicKey });
  m.rpc.getGenesisHash.mockResolvedValue("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  m.rpc.getSlot.mockResolvedValue(507644395);
  m.rpc.getAccountInfo.mockResolvedValue({ executable: true });
  m.rpc.getBalance.mockResolvedValue(12345678);
});
describe("launch infrastructure preflight", () => {
  it("identifies treasury configuration without reporting an RPC failure", async () => {
    m.treasury.mockImplementation(() => { throw new Error("missing treasury"); });
    const response = await GET(new NextRequest("https://localhost/api/meteora/readiness"));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("SOLCAMEO_DBC_TREASURY_SECRET");
    expect(m.rpc.getSlot).not.toHaveBeenCalled();
  });
  it("reports actual confirmed network state and wallet balance", async () => {
    const response = await GET(new NextRequest(`https://localhost/api/meteora/readiness?wallet=${Keypair.generate().publicKey}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ready: true, network: "devnet", slot: 507644395, balanceLamports: 12345678, metadataConfigured: true });
  });
  it("rejects an RPC on a different chain", async () => {
    m.rpc.getGenesisHash.mockResolvedValue("mainnet");
    const response = await GET(new NextRequest("https://localhost/api/meteora/readiness"));
    expect(response.status).toBe(503);
    expect(m.rpc.getBalance).not.toHaveBeenCalled();
  });
  it("does not report readiness without storage or an executable program", async () => {
    m.storage.mockReturnValue(false);
    expect((await GET(new NextRequest("https://localhost/api/meteora/readiness"))).status).toBe(503);
    m.storage.mockReturnValue(true);
    m.rpc.getAccountInfo.mockResolvedValue(null);
    expect((await GET(new NextRequest("https://localhost/api/meteora/readiness"))).status).toBe(503);
  });
  it("rejects invalid wallet addresses", async () => {
    expect((await GET(new NextRequest("https://localhost/api/meteora/readiness?wallet=invalid"))).status).toBe(400);
  });
});

it("verifies mainnet by genesis hash before reporting launch readiness", async () => {
  m.configured.mockReturnValue({ ready: true, network: "mainnet" });
  m.rpc.getGenesisHash.mockResolvedValue("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
  const response = await GET(new NextRequest("https://localhost/api/meteora/readiness"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ready: true, network: "mainnet" });
});

it("rejects a devnet RPC configured as mainnet without marking it ready", async () => {
  m.configured.mockReturnValue({ ready: true, network: "mainnet" });
  const response = await GET(new NextRequest("https://localhost/api/meteora/readiness"));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ready: false, network: "mainnet" });
  expect(m.rpc.getSlot).not.toHaveBeenCalled();
});

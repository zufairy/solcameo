import {describe,expect,it} from "vitest";
import type {Connection} from "@solana/web3.js";
import {assertDevnet} from "./devnetGuard";
it("rejects a mainnet RPC even if env says devnet",async()=>{
  await expect(assertDevnet({getGenesisHash:async()=>"mainnet"} as unknown as Connection)).rejects.toThrow("not Solana devnet");
  await expect(assertDevnet({getGenesisHash:async()=>"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"} as unknown as Connection)).resolves.toBeUndefined();
});

import { assertConfiguredChain } from "./devnetGuard";
describe("assertConfiguredChain", () => {
  it("accepts mainnet genesis for mainnet and rejects it for devnet", async () => {
    const main = { getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" } as unknown as Connection;
    await expect(assertConfiguredChain(main, "mainnet")).resolves.toBeUndefined();
    await expect(assertConfiguredChain(main, "devnet")).rejects.toThrow("RPC network mismatch");
  });
});

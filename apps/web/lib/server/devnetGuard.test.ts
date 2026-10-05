import {expect,it} from "vitest";
import type {Connection} from "@solana/web3.js";
import {assertDevnet} from "./devnetGuard";
it("rejects a mainnet RPC even if env says devnet",async()=>{
  await expect(assertDevnet({getGenesisHash:async()=>"mainnet"} as unknown as Connection)).rejects.toThrow("not Solana devnet");
  await expect(assertDevnet({getGenesisHash:async()=>"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"} as unknown as Connection)).resolves.toBeUndefined();
});

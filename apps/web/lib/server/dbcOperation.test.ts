import {it,expect,vi,afterEach} from "vitest";
import {readOperation,signOperation} from "./dbcOperation";
afterEach(()=>vi.unstubAllEnvs());
it("binds reviewed wallet operations to wallet, network, contents and time",()=>{
  vi.stubEnv("INTERNAL_CRON_SECRET","test");const r={wallet:"owner",network:"devnet",kind:"claim" as const,characterId:"character",hash:"hash",expires:Date.now()+1000};const s=signOperation(r);
  expect(readOperation(s,"owner","devnet")).toEqual(r);
  expect(()=>readOperation(s,"other","devnet")).toThrow();expect(()=>readOperation(s,"owner","mainnet")).toThrow();expect(()=>readOperation(s+"x","owner","devnet")).toThrow();
  const old=signOperation({...r,expires:Date.now()-1000});expect(()=>readOperation(old,"owner","devnet")).toThrow();expect(readOperation(old,"owner","devnet",true).wallet).toBe("owner");
});

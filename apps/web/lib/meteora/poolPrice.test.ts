import {describe,it,expect} from "vitest";
import {marketCapSol} from "./poolPrice";
describe("DAMM token ordering",()=>{
  it("normalizes SOL/base decimals in either token order",()=>{
    expect(marketCapSol(2,1e9,6,true)).toBe(4e6);
    expect(marketCapSol(.5,1e9,6,false)).toBe(4e6);
  });
});

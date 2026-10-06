import {describe,it,expect} from "vitest";
import {splitCollectedPartner,feeExample} from "./flywheel";
import {buildDbcCurve} from "./curve";
import {DEFAULT_DBC,dbcOptionsSchema} from "./options";
describe("versioned sustainable launch economics",()=>{
  it("preserves an old receipt while new launches share fee and locked LP rights",()=>{
    const legacy=buildDbcCurve(dbcOptionsSchema.parse({}));const next=buildDbcCurve(DEFAULT_DBC);
    expect(legacy.creatorTradingFeePercentage).toBe(100);expect(legacy.creatorPermanentLockedLiquidityPercentage).toBe(100);
    expect(next.creatorTradingFeePercentage).toBe(50);expect(next.creatorPermanentLockedLiquidityPercentage).toBe(50);expect(next.partnerPermanentLockedLiquidityPercentage).toBe(50);
  });
  it("conserves all collected lamports including odd dust",()=>{
    for(const amount of [0n,1n,3n,10000001n,(1n<<62n)]){const x=splitCollectedPartner(amount);expect(x.content+x.ops).toBe(amount);expect(x.content<=x.ops).toBe(true);}
    expect(()=>splitCollectedPartner(-1n)).toThrow();
  });
  it("discloses protocol fees as part of the flat 1.5% fee",()=>{const f=feeExample(100,150,true);expect(f.total).toBeCloseTo(1.5);expect(f.protocol).toBeCloseTo(.3);expect(f.creator).toBeCloseTo(.6);expect(f.platform).toBeCloseTo(.45);expect(f.content).toBeCloseTo(.15);expect(f.protocol+f.creator+f.platform+f.content).toBeCloseTo(f.total);});
  it("gives the platform 30% of every fee and content 10%, from the 40% partner share",()=>{const x=splitCollectedPartner(4000n);expect(x).toEqual({content:1000n,ops:3000n});});
});

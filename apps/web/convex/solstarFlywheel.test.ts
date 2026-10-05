/// <reference types="vite/client" />
import {convexTest} from "convex-test";
import {it,expect,vi,afterEach} from "vitest";
import schema from "./schema";
import {api} from "./_generated/api";
const modules=import.meta.glob("./**/*.ts");afterEach(()=>vi.unstubAllEnvs());
async function setup(network:"mainnet"|"devnet"="mainnet"){
  vi.stubEnv("INTERNAL_CRON_SECRET","test");const t=convexTest(schema,modules);
  const ids=await t.run(async ctx=>{
    const characterId=await ctx.db.insert("ssCharacters",{ownerWallet:"owner",name:"Creator",bio:"",referenceImageUrl:"https://example.com/image.png",category:"Comedy",status:"approved",rightsAttested:true,rightsReviewed:false,createdAt:Date.now()});
    const tokenId=await ctx.db.insert("ssTokens",{characterId,network,name:"Creator",ticker:"CR",description:"",economy:"sustainable-v1",treasuryWallet:"treasury",state:"live",solReserve:0n,tokenReserve:0n,createdAt:Date.now()});
    await ctx.db.insert("ssBudgets",{tokenId,network,fundedLamports:0n,reservedLamports:0n,spentLamports:0n});
    await ctx.db.insert("ssFlywheels",{tokenId,enabled:true,nextRunAt:0,leaseUntil:0,status:"awaiting_fees",updatedAt:Date.now()});
    await ctx.db.insert("ssCommunityRounds",{characterId,window:Date.now(),status:"complete",plot:"A character explores a new world",leaseUntil:0,createdAt:Date.now()});return {tokenId,characterId};
  });return {t,...ids};
}
it("credits confirmed claim proceeds once and rejects unauthorized credits",async()=>{
  const {t,tokenId,characterId}=await setup();const a={tokenId,signature:"signature",amountLamports:101n,authSecret:"test"};
  await expect(t.mutation(api.solstarFlywheel.recordClaim,{...a,authSecret:"bad"})).rejects.toThrow();
  expect(await t.mutation(api.solstarFlywheel.recordClaim,a)).toBe(true);expect(await t.mutation(api.solstarFlywheel.recordClaim,a)).toBe(false);
  expect((await t.query(api.solstarFlywheel.status,{characterId}))?.available).toBe("50");
});
it("concurrent workers cannot overspend or launch duplicate content",async()=>{
  const {t,tokenId,characterId}=await setup();await t.mutation(api.solstarFlywheel.recordClaim,{tokenId,signature:"s",amountLamports:200n,authSecret:"test"});
  const jobs=await Promise.all([1,2].map(()=>t.mutation(api.solstarFlywheel.reserveVideo,{tokenId,costLamports:80n,authSecret:"test"})));expect(jobs.filter(Boolean)).toHaveLength(1);
  const status=await t.query(api.solstarFlywheel.status,{characterId});expect(status?.available).toBe("20");expect(status?.reserved).toBe("80");
});
it("only verified completion publishes an episode and settles once",async()=>{
  const {t,tokenId,characterId}=await setup();await t.mutation(api.solstarFlywheel.recordClaim,{tokenId,signature:"s",amountLamports:200n,authSecret:"test"});const j=await t.mutation(api.solstarFlywheel.reserveVideo,{tokenId,costLamports:80n,authSecret:"test"});
  const a={id:j!.id,authSecret:"test"};await t.mutation(api.solstarFlywheel.updateJob,{...a,status:"submitting"});await t.mutation(api.solstarFlywheel.updateJob,{...a,status:"unknown"});
  expect((await t.query(api.solstarFlywheel.status,{characterId}))?.reserved).toBe("80");
  await expect(t.mutation(api.solstarFlywheel.updateJob,{...a,status:"complete",videoUrl:"https://example.com/video.mp4"})).rejects.toThrow("result_required");
  await t.mutation(api.solstarFlywheel.updateJob,{...a,status:"running",taskId:"provider-task"});
  await t.mutation(api.solstarFlywheel.updateJob,{...a,status:"complete",videoUrl:"https://example.com/video.mp4"});await t.mutation(api.solstarFlywheel.updateJob,{...a,status:"complete",videoUrl:"https://example.com/video.mp4"});
  expect((await t.query(api.solstarFlywheel.status,{characterId}))?.spent).toBe("80");const episodes=await t.run(ctx=>ctx.db.query("ssEpisodes").collect());expect(episodes).toHaveLength(1);
});
it("does not convert devnet test fees into paid video tasks",async()=>{
  const {t,tokenId}=await setup("devnet");await t.mutation(api.solstarFlywheel.recordClaim,{tokenId,signature:"s",amountLamports:200n,authSecret:"test"});expect(await t.mutation(api.solstarFlywheel.reserveVideo,{tokenId,costLamports:80n,authSecret:"test"})).toBeNull();
});
it("only the character owner may pause creation",async()=>{const {t,characterId}=await setup();await expect(t.mutation(api.solstarFlywheel.setEnabled,{characterId,wallet:"other",enabled:false,authSecret:"test"})).rejects.toThrow();await t.mutation(api.solstarFlywheel.setEnabled,{characterId,wallet:"owner",enabled:false,authSecret:"test"});expect((await t.query(api.solstarFlywheel.status,{characterId}))?.enabled).toBe(false);});

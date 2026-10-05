/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect,it,vi,afterEach } from "vitest";
import schema from "./schema";
import { api,internal } from "./_generated/api";
const modules=import.meta.glob("./**/*.ts");
afterEach(()=>vi.unstubAllEnvs());
async function setup(){vi.stubEnv("INTERNAL_CRON_SECRET","secret");const t=convexTest(schema,modules);await t.mutation(api.solstarCatalog.seedSample,{authSecret:"secret"});const id=await t.run(async ctx=>(await ctx.db.query("ssCharacters").first())!._id);return {t,id};}
it("shares fan messages and pages older history",async()=>{const {t,id}=await setup();await t.mutation(api.communityChat.post,{characterId:id,author:"Fan 123",body:"A space adventure",authSecret:"secret"});const live=await t.query(api.communityChat.list,{characterId:id});expect(live.messages[0].body).toBe("A space adventure");expect((await t.query(api.communityChat.list,{characterId:id,before:live.messages[0].createdAt})).messages).toHaveLength(0);});
it("protects writes and enforces rate limits",async()=>{const {t,id}=await setup();await expect(t.mutation(api.communityChat.post,{characterId:id,author:"fan",body:"hi",authSecret:"bad"})).rejects.toThrow("unauthorized");for(let i=0;i<5;i++)await t.mutation(api.communityChat.post,{characterId:id,author:"fan",body:`idea ${i}`,authSecret:"secret"});await expect(t.mutation(api.communityChat.post,{characterId:id,author:"fan",body:"sixth",authSecret:"secret"})).rejects.toThrow("rate_limited");});
it("finalizes a round once, stores its plot, and removes em dashes",async()=>{const {t,id}=await setup();const round=await t.run(ctx=>ctx.db.insert("ssCommunityRounds",{characterId:id,window:0,status:"running",leaseUntil:123,createdAt:0}));const args={id:round,leaseUntil:123,reply:"Love this—let's try it",plot:"A space adventure",summary:"Fans want space"};await t.mutation(internal.communityChat.finish,args);await t.mutation(internal.communityChat.finish,args);const live=await t.query(api.communityChat.list,{characterId:id});expect(live.messages).toHaveLength(1);expect(live.messages[0].body).not.toContain("—");expect(live.plot).toBe("A space adventure");});
it("runs KIE once for an hourly window and publishes its reply and plot",async()=>{
 const {t,id}=await setup();vi.stubEnv("KIE_API_KEY","test-key");
 const {ensureCharacterAgent}=await import("./lib/characterAgent");
 await t.run(async ctx=>{const c=(await ctx.db.get(id))!;const token=(await ctx.db.query("ssTokens").withIndex("by_character",q=>q.eq("characterId",id)).first())!;await ensureCharacterAgent(ctx,c,token);await ctx.db.insert("ssCommunityMessages",{characterId:id,author:"fan",role:"fan",body:"Let's do a space comedy",createdAt:1000});});
 const fetchMock=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:"Love the space idea. Let's make it funny!",summary:"Space comedy",plot:"Hook: lost in space. Three scenes: launch, wrong planet, comic escape. End with a fan poll."})}}]})));vi.stubGlobal("fetch",fetchMock);
 try{await t.action(internal.communityChat.respond,{characterId:id,window:0});await t.action(internal.communityChat.respond,{characterId:id,window:0});expect(fetchMock).toHaveBeenCalledTimes(1);const live=await t.query(api.communityChat.list,{characterId:id});expect(live.messages.filter(m=>m.role==="agent")).toHaveLength(1);expect(live.plot).toContain("fan poll");}finally{vi.unstubAllGlobals();}
});

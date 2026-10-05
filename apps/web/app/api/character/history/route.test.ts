import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest,NextResponse } from "next/server";
const m=vi.hoisted(()=>({auth:vi.fn(),list:vi.fn(),get:vi.fn(),result:vi.fn()}));
vi.mock("@/lib/server/characterDraft",()=>({authorizeCharacterScope:m.auth}));
vi.mock("@/lib/server/imageStorage",()=>({listImageObjects:m.list,getObjectText:m.get,imagePublicUrl:(key:string)=>`https://images.test/${key}`}));
vi.mock("@/lib/server/characterResult",()=>({characterResult:m.result}));
import { GET } from "./route";
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({mint:"draft-owner"});});
const req=()=>new NextRequest("http://localhost/api/character/history?draft=1");
it("recovers legacy portraits and excludes another owner's images and uploaded references",async()=>{
  m.list.mockResolvedValue([{key:"characters/draft-owner/gen/date/old.png"},{key:"characters/other/gen/private.png"},{key:"characters/draft-owner/photo/ref.jpg"}]);
  const data=await(await GET(req())).json();expect(data.images).toHaveLength(1);expect(data.images[0].url).toContain("draft-owner/gen/date/old.png");
  expect(m.list).toHaveBeenCalledWith("characters/draft-owner/");
});
it("recovers an accepted completed job that was not polled before refresh",async()=>{
  m.list.mockResolvedValue([{key:"characters/draft-owner/jobs/request-123.json"}]);m.get.mockResolvedValue(JSON.stringify({requestId:"request-123",model:"qwen",ratio:"1:1"}));m.result.mockResolvedValue({status:"completed",urls:["https://images.test/recovered.png"]});
  const data=await(await GET(req())).json();expect(data.images[0]).toEqual({url:"https://images.test/recovered.png",model:"qwen",ratio:"1:1"});expect(data.pending).toBe(0);
});
it("does not inventory storage for an unauthenticated request",async()=>{
  m.auth.mockResolvedValue({error:NextResponse.json({error:"Unauthorized"},{status:401})});expect((await GET(req())).status).toBe(401);expect(m.list).not.toHaveBeenCalled();
});

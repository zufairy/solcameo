import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({get:vi.fn(),status:vi.fn(),mirror:vi.fn(),put:vi.fn(),poll:vi.fn()}));
vi.mock("./imageBilling",()=>({refundImage:vi.fn()}));
const refund=vi.hoisted(()=>vi.fn());
vi.mock("./studioGenBilling",()=>({refundStudioRun:refund}));
vi.mock("./imageStorage",()=>({getObjectText:m.get,mirrorImageToR2:m.mirror,putImage:m.put}));
vi.mock("./higgsfield",()=>({getStatus:m.status}));
vi.mock("./nftKie",()=>({pollNftTaskOnce:m.poll}));
import { characterResult } from "./characterResult";
beforeEach(()=>vi.resetAllMocks());
it("returns the stored result without contacting the provider again",async()=>{
  m.get.mockResolvedValue(JSON.stringify([{url:"https://stored.test/portrait.png",model:"qwen"}]));
  expect(await characterResult("owner","request-123")).toMatchObject({status:"completed",urls:["https://stored.test/portrait.png"]});
  expect(m.status).not.toHaveBeenCalled();expect(m.mirror).not.toHaveBeenCalled();
});
it("mirrors a completed job to a deterministic owner path and indexes it",async()=>{
  m.get.mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify({model:"qwen",ratio:"1:1"}));
  m.status.mockResolvedValue({status:"completed",imageUrls:["https://provider.test/image.png"]});
  m.mirror.mockResolvedValue({url:"https://stored.test/image.png"});
  expect(await characterResult("owner","request-123")).toMatchObject({status:"completed"});
  expect(m.mirror).toHaveBeenCalledWith("https://provider.test/image.png",{key:"characters/owner/gen/request-123/0.webp",optimize:true});
  expect(m.put.mock.calls[0][2]).toEqual({key:"characters/owner/results/request-123.json"});
});
it("rejects traversal before any storage read",async()=>{
  await expect(characterResult("owner","../../other/result")).rejects.toThrow();expect(m.get).not.toHaveBeenCalled();
});
it("preserves the provider failure instead of pretending an image was saved",async()=>{
  m.get.mockResolvedValue(null);m.status.mockResolvedValue({status:"failed",error:"Model unavailable"});
  expect(await characterResult("owner","request-123")).toEqual({status:"failed",error:"Model unavailable"});expect(m.put).not.toHaveBeenCalled();
});

const kieJob=JSON.stringify({provider:"kie",model:"nano",ratio:"3:4",studioRunId:"character:b:0"});
it("keeps a running KIE job pending without touching Higgsfield",async()=>{
  m.get.mockResolvedValueOnce(null).mockResolvedValueOnce(kieJob);m.poll.mockResolvedValue({status:"pending"});
  expect(await characterResult("owner","kietask12345")).toEqual({status:"in_progress"});expect(m.status).not.toHaveBeenCalled();
});
it("mirrors a finished KIE image to R2 and caches it",async()=>{
  m.get.mockResolvedValueOnce(null).mockResolvedValueOnce(kieJob);m.poll.mockResolvedValue({status:"success",url:"https://kie.test/out.png"});m.mirror.mockResolvedValue({url:"https://stored.test/out.webp"});
  expect(await characterResult("owner","kietask12345")).toMatchObject({status:"completed",urls:["https://stored.test/out.webp"]});
  expect(m.mirror).toHaveBeenCalledWith("https://kie.test/out.png",{key:"characters/owner/gen/kietask12345/0.webp",optimize:true});
  expect(m.put.mock.calls[0][2]).toEqual({key:"characters/owner/results/kietask12345.json"});
});
it("gives a failed KIE render back to the user",async()=>{
  m.get.mockResolvedValueOnce(null).mockResolvedValueOnce(kieJob);m.poll.mockResolvedValue({status:"fail",error:"blocked"});
  expect(await characterResult("owner","kietask12345")).toMatchObject({status:"failed"});expect(refund).toHaveBeenCalledWith("character:b:0");
});

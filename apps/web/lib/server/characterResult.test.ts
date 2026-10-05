import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({get:vi.fn(),status:vi.fn(),mirror:vi.fn(),put:vi.fn()}));
vi.mock("./imageStorage",()=>({getObjectText:m.get,mirrorImageToR2:m.mirror,putImage:m.put}));
vi.mock("./higgsfield",()=>({getStatus:m.status}));
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
  expect(m.mirror).toHaveBeenCalledWith("https://provider.test/image.png",{key:"characters/owner/gen/request-123/0.png"});
  expect(m.put.mock.calls[0][2]).toEqual({key:"characters/owner/results/request-123.json"});
});
it("rejects traversal before any storage read",async()=>{
  await expect(characterResult("owner","../../other/result")).rejects.toThrow();expect(m.get).not.toHaveBeenCalled();
});
it("preserves the provider failure instead of pretending an image was saved",async()=>{
  m.get.mockResolvedValue(null);m.status.mockResolvedValue({status:"failed",error:"Model unavailable"});
  expect(await characterResult("owner","request-123")).toEqual({status:"failed",error:"Model unavailable"});expect(m.put).not.toHaveBeenCalled();
});

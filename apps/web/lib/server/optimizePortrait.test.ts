import {expect,it} from "vitest";
import sharp from "sharp";
import {optimizePortrait} from "./optimizePortrait";
it("saves a smaller WebP with bounded dimensions and keeps portrait proportions", async()=>{
  const input=await sharp({create:{width:2400,height:3200,channels:3,background:"#8a9fbc"}}).png().toBuffer();
  const output=await optimizePortrait(input);
  const meta=await sharp(output).metadata();
  expect(meta.format).toBe("webp");expect(meta.height).toBe(1600);expect(meta.width).toBe(1200);
  expect(output.length).toBeLessThan(input.length);
});
it("rejects non-image content instead of saving it as a portrait",async()=>{
  await expect(optimizePortrait(Buffer.from("not an image"))).rejects.toThrow();
});

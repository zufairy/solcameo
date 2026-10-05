const { spawn } = require("child_process");
const R = require("./render2.js");
const START = parseInt(process.env.START || "0", 10);
const COUNT = parseInt(process.env.COUNT || String(R.TOTAL), 10);
const OUT = process.env.OUT || "seg.mp4";
const end = Math.min(START + COUNT, R.TOTAL);

(async () => {
  const A = await R.loadAssets();
  const scene = R.createCanvas(R.W, R.H); const sctx = scene.getContext("2d");
  const out = R.createCanvas(R.W, R.H); const octx = out.getContext("2d");
  const work = R.makeWork();
  const ff = spawn("ffmpeg", [
    "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${R.W}x${R.H}`,
    "-framerate", "60", "-i", "-",
    "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "19", "-preset", "veryfast", "-g", "120", OUT,
  ], { stdio: ["pipe", "ignore", "inherit"] });
  const write = (b) => new Promise((r) => { ff.stdin.write(b) ? r() : ff.stdin.once("drain", r); });
  for (let f = START; f < end; f++) {
    sctx.clearRect(0, 0, R.W, R.H); R.drawScene(sctx, f, A); R.applyVHS(octx, scene, work, f);
    const img = octx.getImageData(0, 0, R.W, R.H);
    await write(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength));
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on("close", (c) => c === 0 ? res() : rej(new Error("ffmpeg " + c))));
  console.log("SEG DONE", OUT, START, "->", end);
})().catch((e) => { console.error(e); process.exit(1); });

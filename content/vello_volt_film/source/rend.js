const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const FPS = +process.env.FPS || 60, DUR = 60;
const [a, b] = process.argv.slice(2).map(Number);
(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('http://127.0.0.1:8765/index.html');
  await p.waitForFunction(() => window.READY === true, null, { timeout: 60000 });
  fs.mkdirSync('frames', { recursive: true });
  const t0 = Date.now();
  for (let f = a; f < Math.min(b, FPS * DUR); f++) {
    const fn = `frames/${String(f).padStart(5, '0')}.jpg`;
    if (fs.existsSync(fn)) continue;
    const d = await p.evaluate(t => { render(t); return document.getElementById('c').toDataURL('image/jpeg', 0.93); }, f / FPS);
    fs.writeFileSync(fn, Buffer.from(d.split(',')[1], 'base64'));
    if (f % 200 === 0) console.log(f, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  console.log('DONE', a, b);
  await br.close();
})();

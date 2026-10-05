const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const [v, a, b] = process.argv.slice(2); const FPS = 30;
(async () => {
  const br = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await br.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(`http://127.0.0.1:8769/index.html?v=${v}`);
  await p.waitForFunction(() => window.READY === true, null, { timeout: 90000 });
  const DUR = await p.evaluate(async v => (await import(`./v${v}.js`)).DUR, v);
  const out = `frames${v}`; fs.mkdirSync(out, { recursive: true });
  const N = Math.round(FPS * DUR), A = +a || 0, B = Math.min(+b || N, N);
  for (let f = A; f < B; f++) {
    const fn = `${out}/${String(f).padStart(5, '0')}.jpg`; if (fs.existsSync(fn)) continue;
    const d = await p.evaluate(async t => { await render(t); return document.getElementById('c').toDataURL('image/jpeg', 0.92); }, f / FPS);
    fs.writeFileSync(fn, Buffer.from(d.split(',')[1], 'base64'));
  }
  console.log('DONE', v, A, B, N); await br.close();
})();

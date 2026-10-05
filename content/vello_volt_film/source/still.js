const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
(async () => {
  const times = process.argv.slice(2).map(Number);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('console', m => console.log('console:', m.text()));
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('http://127.0.0.1:8765/index.html');
  await p.waitForFunction(() => window.READY === true, null, { timeout: 60000 });
  fs.mkdirSync('stills', { recursive: true });
  for (const t of times) {
    const t0 = Date.now();
    const d = await p.evaluate(t => { render(t); return document.getElementById('c').toDataURL('image/jpeg', 0.85); }, t);
    fs.writeFileSync(`stills/${t.toFixed(2)}.jpg`, Buffer.from(d.split(',')[1], 'base64'));
    console.log(t, Date.now() - t0, 'ms');
  }
  await b.close();
})();

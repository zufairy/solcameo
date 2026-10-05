const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
(async () => {
  const [v, ...ts] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await p.goto(`http://127.0.0.1:8769/index.html?v=${v}`);
  await p.waitForFunction(() => window.READY === true, null, { timeout: 90000 });
  fs.rmSync('stills', { recursive: true, force: true }); fs.mkdirSync('stills');
  for (const t of ts.map(Number)) { try { const d = await p.evaluate(async t => { await render(t); return document.getElementById('c').toDataURL('image/jpeg', 0.85); }, t); fs.writeFileSync(`stills/${String(t.toFixed(2)).padStart(6, '0')}.jpg`, Buffer.from(d.split(',')[1], 'base64')); } catch (e) { console.log('ERR', t, e.message.slice(0, 200)); } }
  await b.close();
})();

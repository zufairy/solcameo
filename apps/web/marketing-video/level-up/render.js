const { chromium } = require('/home/claude/vv/node_modules/playwright-core');
const fs=require('fs');
const [,,wid,nw,fps,dur]=process.argv.map(Number);
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const p=await b.newPage({viewport:{width:1920,height:1080}});
 p.on('pageerror',e=>console.log('ERR',e.message));
 await p.goto('http://localhost:8765/index.html?ms=0&smaa&w=1920'); await p.waitForFunction(()=>window.renderAt&&window.ready,null,{timeout:120000}); await p.evaluate(()=>window.ready);
 const cdp=await p.context().newCDPSession(p);
 fs.mkdirSync('frames',{recursive:true});
 const N=Math.round(fps*dur);
 for(let f=wid;f<N;f+=nw){
  const fn=`frames/f${String(f).padStart(5,'0')}.jpg`;
  if(fs.existsSync(fn))continue;
  await p.evaluate(t=>window.renderAt(t),f/fps);
  const r=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:94,optimizeForSpeed:true});
  fs.writeFileSync(fn+'.tmp',Buffer.from(r.data,'base64')); fs.renameSync(fn+'.tmp',fn);
 }
 await b.close();
})();

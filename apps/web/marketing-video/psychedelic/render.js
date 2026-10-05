const { chromium } = require('playwright-core');
const fs=require('fs');
const [,,wid,nw,fps,dur]=process.argv.map(Number);
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--allow-file-access-from-files']});
 const p=await b.newPage({viewport:{width:1920,height:1080}});
 p.on('pageerror',e=>console.log('ERR',e.message));
 await p.goto('file://'+__dirname+'/index.html'); await p.evaluate(()=>window.ready);
 const cdp=await p.context().newCDPSession(p);
 fs.mkdirSync('frames',{recursive:true});
 const N=Math.round(fps*dur);
 for(let f=wid;f<N;f+=nw){
  const fn=`frames/f${String(f).padStart(5,'0')}.jpg`;
  if(fs.existsSync(fn))continue;
  await p.evaluate(t=>window.renderAt(t),f/fps);
  const r=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:94,optimizeForSpeed:true});
  fs.writeFileSync(fn,Buffer.from(r.data,'base64'));
  if(f%120<nw)console.log(wid,f,new Date().toISOString());
 }
 await b.close();
})();

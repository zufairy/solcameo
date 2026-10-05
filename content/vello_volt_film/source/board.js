function drawBoard(){
  ctx.setTransform(1,0,0,1,0,0); bg(ctx,C.ink); pixelGrid(ctx,C.volt,40,0.06);
  txt(ctx,'VELLO // VOLT',80,90,64,{align:'left',color:C.volt});
  hud(ctx,'MOTION & BRAND SYSTEM · THE GLOBAL ATTENTION ECONOMY ON SOLANA',84,150,{color:C.grey,size:20});
  img(ctx,IMG.flash,1640,250,380); img(ctx,IMG.word,1640,470,360);
  hud(ctx,'PALETTE',84,220,{color:C.white,size:20});
  [['VOLT',C.volt,'#C8FF00 · PRIMARY'],['INK',C.ink,'#040604 · BASE'],['CARBON','#141A14','#141A14 · SURFACE'],['BONE',C.white,'#F3FFE3 · TYPE'],['GOLD',C.gold,'#FFC83D · x402 / REWARDS'],['START RED',C.red,'#FF2D2D · F1 LIGHTS ONLY'],['SOLANA',C.solP,'#9945FF→#14F195 · CHAIN MOMENTS']].forEach(([n,c,d],i)=>{
    const x=84+i*186; if(n==='SOLANA'){const g=ctx.createLinearGradient(x,0,x+166,0);g.addColorStop(0,C.solP);g.addColorStop(1,C.solG);ctx.fillStyle=g;} else ctx.fillStyle=c;
    ctx.fillRect(x,250,166,150); ctx.strokeStyle='#2A362A'; ctx.lineWidth=2; ctx.strokeRect(x,250,166,150);
    hud(ctx,n,x,425,{color:C.white,size:16}); const [h1,h2]=d.split(' · '); hud(ctx,h1,x,452,{color:C.grey,size:12,ls:1}); hud(ctx,h2,x,474,{color:C.grey,size:12,ls:1});});
  hud(ctx,'TYPE',84,520,{color:C.white,size:20});
  txt(ctx,'SPEED IS THE BRAND',84,600,62,{align:'left',color:C.white});
  hud(ctx,'DISPLAY · ARCHIVO BLACK ITALIC, EXPANDED (125%) — HEADLINES, SLAMS',84,665,{color:C.grey,size:16});
  txt(ctx,'NODE 0412 · LAP 001/145',84,730,40,{family:'Silkscreen',italic:false,weight:400,align:'left',color:C.volt,ls:4});
  hud(ctx,'PIXEL · SILKSCREEN / PRESS START 2P — HUD, LABELS, COUNTERS',84,775,{color:C.grey,size:16});
  txt(ctx,'< 402 PAYMENT REQUIRED  price=0.04 USDC',84,830,28,{family:'JetBrains Mono',italic:false,weight:700,align:'left',color:C.gold});
  hud(ctx,'MONO · JETBRAINS MONO — TERMINAL, x402, ON-CHAIN DATA',84,870,{color:C.grey,size:16});
  hud(ctx,'MOTIFS',1060,520,{color:C.white,size:20});
  ctx.save(); ctx.beginPath(); ctx.rect(1060,545,780,180); ctx.clip(); ctx.translate(0,0);
  ctx.fillStyle='#070A07'; ctx.fillRect(1060,545,780,180);
  for(let i=0;i<5;i++){ pxCircle(ctx,1110+i*70,600,24,6,i<3?C.red:'#2A0707'); }
  lightning(ctx,1480,550,1560,720,42,3,C.volt,1);
  img(ctx,SPR.flashPx,1720,640,140);
  for(let y=0;y<3;y++)for(let x=0;x<8;x++) if((x+y)%2){ctx.fillStyle=C.volt;ctx.fillRect(1080+x*28,670+y*16,28,16);}
  ctx.restore();
  hud(ctx,'F1 START LIGHTS · PIXEL LIGHTNING · 8-BIT FLASH · CHECKER',1060,750,{color:C.grey,size:14});
  hud(ctx,'MOTION RULES',1060,810,{color:C.white,size:20});
  ['CUT ON THE BEAT (150 BPM · 0.4s), NEVER BETWEEN','SLAM IN: 1.5x → 1x, EXPO-OUT, 160ms + DIRECTIONAL SMEAR','TRANSITIONS: PIXEL MOSAIC 110ms · RGB GLITCH 100ms · WHITE FLASH ON DROPS','EVERY FRAME: PIXEL GRAIN · SCANLINES · VIGNETTE · BEAT SHAKE'].forEach((s,i)=>hud(ctx,'→ '+s,1060,850+i*36,{color:C.grey,size:15,ls:1}));
}

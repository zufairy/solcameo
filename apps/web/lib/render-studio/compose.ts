// Render Studio composition format, shared by the browser preview and the
// server renderer so what you preview is exactly what gets exported.
//
// A composition is a *deterministic, seekable* page: the host calls
// window.__seek(seconds) and the page must draw exactly that moment. Nothing
// may depend on wall-clock time, so a slow machine never drops frames and the
// same composition renders identically everywhere (the same idea HyperFrames
// and Remotion are built on).
//
// Two authoring engines share that contract:
//   "html"  - HTML/CSS/JS (+ optional GSAP / three.js), HyperFrames style.
//   "react" - JSX with a Remotion-compatible API subset (useCurrentFrame,
//             interpolate, spring, Sequence, AbsoluteFill ...).
// Libraries are self-hosted under /render-studio/vendor so there is no CDN
// dependency in preview or on the render worker.

export type Engine = "html" | "react";

/** A media file the composition may use (user clip, stock footage, logo). */
export interface Asset {
  id: string;
  kind: "video" | "image";
  url: string;
  title: string;
  /** Seconds, videos only. */
  duration?: number;
  width?: number;
  height?: number;
  thumb?: string;
  source?: "mine" | "stock" | "brand";
}

export interface Composition {
  engine: Engine;
  title: string;
  width: number;
  height: number;
  fps: number;
  /** Seconds. */
  duration: number;
  /** Engine "html": markup placed inside #stage. Engine "react": unused. */
  html: string;
  css: string;
  /** Engine "html": script registering vello.onSeek handlers. Engine "react": JSX defining `Video`. */
  js: string;
  /** Media the agent was given. Videos are transcoded server-side for frame-exact export. */
  assets?: Asset[];
}

export const ASPECTS = {
  "9:16": { width: 1080, height: 1920, label: "Vertical 9:16" },
  "1:1": { width: 1080, height: 1080, label: "Square 1:1" },
  "16:9": { width: 1920, height: 1080, label: "Wide 16:9" },
} as const;
export type AspectKey = keyof typeof ASPECTS;

export const VENDOR_BASE = "/render-studio/vendor";
export const FONT_BASE = "/fonts/captions";

/** Self-hosted brand/display fonts, identical in preview and on the render worker. */
export const STUDIO_FONTS: Array<{ family: string; file: string }> = [
  { family: "Manrope", file: "Manrope-Medium.ttf" },
  { family: "Poppins", file: "Poppins-SemiBold.ttf" },
  { family: "Fraunces", file: "Fraunces-SemiBold.ttf" },
  { family: "Cinzel", file: "Cinzel-SemiBold.ttf" },
  { family: "Space Grotesk", file: "SpaceGrotesk-Medium.ttf" },
  { family: "Montserrat", file: "Montserrat-SemiBold.ttf" },
  { family: "Plus Jakarta Sans", file: "PlusJakartaSans-SemiBold.ttf" },
  { family: "Barlow", file: "Barlow-SemiBold.ttf" },
  { family: "Anton", file: "Anton-Regular.ttf" },
  { family: "Bebas Neue", file: "BebasNeue-Regular.ttf" },
  { family: "Archivo Black", file: "ArchivoBlack-Regular.ttf" },
  { family: "Satisfy", file: "Satisfy-Regular.ttf" },
];
export const MAX_DURATION = 30;
export const MAX_FPS = 60;

export function clampComposition(c: Partial<Composition> & Pick<Composition, "engine">): Composition {
  const num = (v: unknown, d: number, lo: number, hi: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    engine: c.engine === "react" ? "react" : "html",
    title: String(c.title ?? "Untitled").slice(0, 80),
    width: Math.round(num(c.width, 1080, 240, 2160) / 2) * 2,
    height: Math.round(num(c.height, 1920, 240, 3840) / 2) * 2,
    fps: Math.round(num(c.fps, 30, 12, MAX_FPS)),
    duration: Math.round(num(c.duration, 8, 1, MAX_DURATION) * 100) / 100,
    html: String(c.html ?? ""),
    css: String(c.css ?? ""),
    js: String(c.js ?? ""),
    assets: cleanAssets(c.assets),
  };
}

export function cleanAssets(a: unknown): Asset[] {
  if (!Array.isArray(a)) return [];
  const out: Asset[] = [];
  for (const x of a.slice(0, 16) as Array<Partial<Asset>>) {
    if (!x || typeof x.url !== "string" || !/^https:\/\//i.test(x.url) || x.url.length > 1500) continue;
    out.push({
      id: String(x.id ?? `a${out.length + 1}`).slice(0, 24),
      kind: x.kind === "image" ? "image" : "video",
      url: x.url,
      title: String(x.title ?? "clip").slice(0, 80),
      duration: Number.isFinite(Number(x.duration)) ? Number(x.duration) : undefined,
      width: Number.isFinite(Number(x.width)) ? Number(x.width) : undefined,
      height: Number.isFinite(Number(x.height)) ? Number(x.height) : undefined,
      thumb: typeof x.thumb === "string" && /^https:\/\//.test(x.thumb) ? x.thumb : undefined,
      source: x.source === "stock" || x.source === "brand" ? x.source : "mine",
    });
  }
  return out;
}

const RUNTIME = String.raw`
(function(){
  var C=window.__COMP, W=C.width, H=C.height, FPS=C.fps, DUR=C.duration;
  function clamp(v,a,b){return Math.min(b,Math.max(a,v));}
  function lerp(a,b,t){return a+(b-a)*t;}
  var ease={
    linear:function(x){return x;},
    in2:function(x){return x*x;}, out2:function(x){return 1-(1-x)*(1-x);},
    in3:function(x){return x*x*x;}, out3:function(x){return 1-Math.pow(1-x,3);},
    io3:function(x){return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;},
    out5:function(x){return 1-Math.pow(1-x,5);},
    outExpo:function(x){return x>=1?1:1-Math.pow(2,-10*x);},
    outBack:function(x){var c1=1.70158,c3=c1+1;return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2);},
    outElastic:function(x){if(x<=0)return 0;if(x>=1)return 1;var c4=(2*Math.PI)/3;return Math.pow(2,-10*x)*Math.sin((x*10-.75)*c4)+1;}
  };
  var fns=[];
  var vello=window.vello={W:W,H:H,fps:FPS,duration:DUR,clamp:clamp,lerp:lerp,ease:ease,
    seg:function(t,start,dur){return clamp((t-start)/dur,0,1);},
    map:function(t,a,b,x,y,e){var p=clamp((t-a)/(b-a),0,1);if(e)p=e(p);return x+(y-x)*p;},
    rand:function(seed){var s=Math.sin(seed*127.1+311.7)*43758.5453;return s-Math.floor(s);},
    onSeek:function(fn){fns.push(fn);},
    stage:document.getElementById("stage")};
  window.__errors=[];
  function report(m){window.__errors.push(String(m));try{parent.postMessage({type:"rs-error",msg:String(m)},"*");}catch(e){}}
  window.addEventListener("error",function(e){report(e.message+(e.lineno?" (line "+e.lineno+")":""));});
  window.addEventListener("unhandledrejection",function(e){report("Promise: "+(e.reason&&e.reason.message||e.reason));});
  var last=-1,pending=[];
  window.__playing=false;
  // vello.video(el, localSeconds, {rate}): frame-exact video seeking. While the
  // preview plays it lets the browser play natively (smooth) and only resyncs on
  // drift; when scrubbing or exporting it seeks exactly and the host awaits it.
  vello.video=function(el,lt,o){
    o=o||{};if(!el)return;
    var d=el.duration||Infinity,tt=clamp(lt*(o.rate||1),0,Math.max(0,d-0.04));
    el.muted=true;el.playsInline=true;el.preload="auto";
    if(window.__playing&&lt>=0&&lt<d){
      if(el.paused){try{el.currentTime=tt;var pr=el.play();if(pr&&pr.catch)pr.catch(function(){});}catch(e){}}
      else if(Math.abs(el.currentTime-tt)>0.3){el.currentTime=tt;}
      return;
    }
    if(!el.paused)el.pause();
    if(Math.abs(el.currentTime-tt)<0.001&&el.readyState>=2)return;
    pending.push(new Promise(function(res){
      var done=false;function fin(){if(done)return;done=true;el.removeEventListener("seeked",fin);res();}
      el.addEventListener("seeked",fin);el.currentTime=tt;setTimeout(fin,2500);
    }));
  };
  window.__seek=function(t){
    t=clamp(+t||0,0,DUR);last=t;pending=[];
    for(var i=0;i<fns.length;i++){try{fns[i](t,Math.round(t*FPS));}catch(e){report("seek: "+e.message);}}
    return pending.length?Promise.all(pending).then(function(){return true;}):true;
  };
  window.__ready=false;
  function finish(){
    window.__seek(0);
    var fams=(window.__FAMS||[]).map(function(f){return document.fonts.load('700 32px "'+f+'"').catch(function(){});});
    var vids=[].slice.call(document.querySelectorAll("video")).map(function(v){return new Promise(function(r){if(v.readyState>=1)return r();v.addEventListener("loadedmetadata",r,{once:true});v.addEventListener("error",r,{once:true});setTimeout(r,8000);});});
    var imgs=[].slice.call(document.images).map(function(i){return i.decode?i.decode().catch(function(){}):0;});
    Promise.all([document.fonts&&document.fonts.ready].concat(fams,imgs,vids)).then(function(){
      return window.__seek(last<0?0:last);
    }).then(function(){
      window.__ready=true;
      try{parent.postMessage({type:"rs-ready"},"*");}catch(e){}
    });
  }
  window.__finish=finish;
  window.addEventListener("message",function(e){var d=e.data;if(!d)return;if(d.type==="rs-play"){window.__playing=!!d.on;if(!d.on)document.querySelectorAll("video").forEach(function(v){v.pause();});}if(d.type==="rs-seek")window.__seek(d.t);});
})();
`;

const REACT_RUNTIME = String.raw`
(function(){
  var C=window.__COMP, R=React, vello=window.vello, FPS=C.fps;
  var Ctx=R.createContext({frame:0,fps:FPS,width:C.width,height:C.height,durationInFrames:Math.round(C.duration*FPS)});
  window.useCurrentFrame=function(){return R.useContext(Ctx).frame;};
  window.useVideoConfig=function(){var c=R.useContext(Ctx);return {fps:c.fps,width:c.width,height:c.height,durationInFrames:c.durationInFrames};};
  var Easing={linear:function(x){return x;},ease:vello.ease.io3,quad:vello.ease.in2,cubic:vello.ease.in3,
    bezier:function(a,b,c,d){return function(x){var lo=0,hi=1,t=x;for(var i=0;i<24;i++){t=(lo+hi)/2;var bx=3*a*t*(1-t)*(1-t)+3*c*t*t*(1-t)+t*t*t;if(bx<x)lo=t;else hi=t;}return 3*b*t*(1-t)*(1-t)+3*d*t*t*(1-t)+t*t*t;};},
    in:function(f){return f;},out:function(f){return function(x){return 1-f(1-x);};},inOut:function(f){return function(x){return x<.5?f(x*2)/2:1-f((1-x)*2)/2;};}};
  window.Easing=Easing;
  window.interpolate=function(input,inR,outR,o){
    o=o||{};var l=o.extrapolateLeft||"extend",r=o.extrapolateRight||"extend",e=o.easing||Easing.linear;
    var n=inR.length;if(input<inR[0]){if(l==="clamp")return outR[0];}
    if(input>inR[n-1]){if(r==="clamp")return outR[n-1];}
    var i=1;while(i<n-1&&input>inR[i])i++;
    var p=(input-inR[i-1])/(inR[i]-inR[i-1]);p=e(p);
    return outR[i-1]+(outR[i]-outR[i-1])*p;
  };
  window.spring=function(o){
    var cfg=Object.assign({damping:10,mass:1,stiffness:100,overshootClamping:false},o.config||{});
    var fps=o.fps||FPS,frame=Math.max(0,o.frame-(o.delay||0));
    var from=o.from==null?0:o.from,to=o.to==null?1:o.to,x=0,v=0,dt=1/fps,sub=4,h=dt/sub;
    for(var f=0;f<frame;f++)for(var s=0;s<sub;s++){var a=(-cfg.stiffness*(x-1)-cfg.damping*v)/cfg.mass;v+=a*h;x+=v*h;if(cfg.overshootClamping&&x>1){x=1;v=0;}}
    return from+(to-from)*x;
  };
  window.random=vello.rand;
  window.AbsoluteFill=function(p){return R.createElement("div",{style:Object.assign({position:"absolute",top:0,left:0,right:0,bottom:0,display:"flex",flexDirection:"column"},p.style),className:p.className},p.children);};
  window.Sequence=function(p){
    var c=R.useContext(Ctx),from=p.from||0,d=p.durationInFrames==null?Infinity:p.durationInFrames,f=c.frame-from;
    if(f<0||f>=d)return null;
    return R.createElement(Ctx.Provider,{value:Object.assign({},c,{frame:f})},R.createElement("div",{style:Object.assign({position:"absolute",inset:0},p.layout==="none"?{position:"static"}:{}),className:p.className},p.children));
  };
  window.Img=function(p){return R.createElement("img",p);};
  // <Vid src start={sec} style/>: a frame-exact video inside a Sequence (time = this sequence's local frame).
  window.Vid=function(p){var c=R.useContext(Ctx),lt=c.frame/c.fps+(p.start||0);
    return R.createElement("video",{src:p.src,muted:true,playsInline:true,preload:"auto",crossOrigin:p.crossOrigin,style:Object.assign({width:"100%",height:"100%",objectFit:"cover"},p.style),ref:function(el){if(el)window.vello.video(el,lt,{rate:p.rate});}});};
  var host=document.getElementById("stage"),root=ReactDOM.createRoot(host);
  var total=Math.round(C.duration*FPS);
  var src=C.js;
  var code=Babel.transform(src,{presets:["react"]}).code+"\n;window.__Video=(typeof Video!=='undefined')?Video:null;";
  (0,eval)(code);
  if(!window.__Video)throw new Error("Define a component named Video");
  vello.onSeek(function(t,frame){
    ReactDOM.flushSync(function(){
      root.render(R.createElement(Ctx.Provider,{value:{frame:Math.min(frame,total-1),fps:FPS,width:C.width,height:C.height,durationInFrames:total}},R.createElement(window.__Video)));
    });
  });
})();
`;

/** Which optional vendor libs a composition needs (auto-detected from its code). */
export function neededLibs(c: Composition): string[] {
  const code = `${c.html}\n${c.js}`;
  const libs: string[] = [];
  if (c.engine === "react") libs.push("react", "react-dom", "babel");
  if (/\bTHREE\b/.test(code)) libs.push("three");
  if (/\bgsap\b/.test(code)) libs.push("gsap");
  return libs;
}

export function buildDocument(c: Composition, opts: { libBase?: string; fontBase?: string } = {}): string {
  const base = opts.libBase ?? VENDOR_BASE;
  const fontBase = opts.fontBase ?? FONT_BASE;
  const code = `${c.html}\n${c.css}\n${c.js}`;
  const used = STUDIO_FONTS.filter((f) => code.includes(f.family) || code.includes(f.family.replace(/ /g, "")) || f.family === "Manrope");
  const faces = used.map((f) => `@font-face{font-family:"${f.family}";src:url("${fontBase}/${f.file}") format("truetype");font-weight:100 900;font-style:normal;font-display:block}`).join("");
  const libs = neededLibs(c).map((l) => `<script src="${base}/${l}.js"></script>`).join("\n");
  const safe = (s: string) => s.replace(/<\/script/gi, "<\\/script");
  const meta = JSON.stringify({ width: c.width, height: c.height, fps: c.fps, duration: c.duration, engine: c.engine }).replace(/</g, "\\u003c");
  const user = c.engine === "react"
    ? `<script>${REACT_RUNTIME.replace("var src=C.js;", `var src=${JSON.stringify(c.js).replace(/</g, "\\u003c")};`)}</script>`
    : `<script>try{\n${safe(c.js)}\n}catch(e){window.__errors.push("script: "+e.message);try{parent.postMessage({type:"rs-error",msg:"script: "+e.message},"*")}catch(_){}}</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${c.width}">
<style>${faces}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#000;overflow:hidden}
#stage{position:relative;width:${c.width}px;height:${c.height}px;overflow:hidden;font-family:Manrope,system-ui,sans-serif;color:#fff}
${safe(c.css)}</style>
${libs}
</head><body><div id="stage">${c.engine === "html" ? c.html : ""}</div>
<script>window.__COMP=${meta};window.__FAMS=${JSON.stringify(used.map((f) => f.family))};</script>
<script>${RUNTIME}</script>
${user}
<script>window.__finish();</script>
</body></html>`;
}

/** Lightweight static validation before spending a render. */
export function validateComposition(c: Composition): string[] {
  const issues: string[] = [];
  if (c.engine === "html" && !/vello\.onSeek\s*\(/.test(c.js)) issues.push("html engine: js must call vello.onSeek((t) => { ... })");
  if (c.engine === "react" && !/\b(function\s+Video|const\s+Video\b|let\s+Video\b|var\s+Video\b)/.test(c.js)) issues.push("react engine: js must define a component named Video");
  if (/Date\.now\(|performance\.now\(|requestAnimationFrame|setTimeout|setInterval|Math\.random\(/.test(c.js)) issues.push("non-deterministic API used (Date.now / performance.now / requestAnimationFrame / setTimeout / setInterval / Math.random). Derive everything from t or vello.rand(seed)");
  if (/<img[^>]+src=["']https?:/i.test(c.html) === false && /fetch\(|XMLHttpRequest/.test(c.js)) issues.push("network calls are not allowed inside a composition");
  return issues;
}

/* ───────────────────────── starter templates ───────────────────────── */

const BRAND_CSS = `
:root{--navy:#0a1630;--navy2:#142a5a;--gold:#e8c668;--gold2:#c79a2e;--ink:#f5efe0}
.bg{position:absolute;inset:0;background:radial-gradient(120% 70% at 50% 0%,#1d3a7a 0%,#0a1630 55%,#050b1c 100%)}
.grid{position:absolute;inset:-10%;background-image:linear-gradient(rgba(232,198,104,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(232,198,104,.07) 1px,transparent 1px);background-size:90px 90px}
.kicker{position:absolute;left:0;right:0;top:300px;text-align:center;font:700 34px/1 Manrope,sans-serif;letter-spacing:.42em;color:var(--gold);text-transform:uppercase}
.title{position:absolute;left:80px;right:80px;top:420px;text-align:center;font:600 150px/1.02 Fraunces,serif;color:var(--ink)}
.title i{color:var(--gold);font-style:italic}
.sub{position:absolute;left:120px;right:120px;top:1010px;text-align:center;font:500 46px/1.35 Manrope,sans-serif;color:rgba(245,239,224,.78)}
.stats{position:absolute;left:70px;right:70px;bottom:230px;display:flex;gap:26px}
.stat{flex:1;min-width:0;padding:36px 12px;border-radius:30px;background:rgba(255,255,255,.06);border:2px solid rgba(232,198,104,.35);text-align:center;backdrop-filter:blur(6px)}
.stat b{display:block;white-space:nowrap;font:700 68px/1 "Space Grotesk",sans-serif;color:var(--gold)}
.stat span{display:block;margin-top:14px;font:700 26px/1 Manrope,sans-serif;letter-spacing:.2em;color:rgba(245,239,224,.7);text-transform:uppercase}
canvas{position:absolute;inset:0}
`;

const HTML_STARTER: Composition = {
  engine: "html",
  title: "Vello milestone teaser",
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 8,
  css: BRAND_CSS,
  html: `<div class="bg"></div><div class="grid" id="grid"></div><canvas id="gl" width="1080" height="1920"></canvas>
<div class="kicker" id="k">Vello network</div>
<div class="title" id="t">Your agents <i>never</i> sleep</div>
<div class="sub" id="s">One post at a time, a fleet of operators earning while the world is offline.</div>
<div class="stats"><div class="stat"><b id="n1">0</b><span>Agents</span></div><div class="stat"><b id="n2">0</b><span>Clips</span></div><div class="stat"><b id="n3">0</b><span>Views</span></div></div>`,
  js: `const { seg, ease, lerp } = vello;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(50, 1080 / 1920, 0.1, 100); cam.position.z = 14;
const ren = new THREE.WebGLRenderer({ canvas: document.getElementById("gl"), alpha: true, antialias: true });
ren.setSize(1080, 1920, false); ren.setClearColor(0x000000, 0);
const N = 70, pts = [], seeds = [];
for (let i = 0; i < N; i++) { seeds.push([vello.rand(i + 1), vello.rand(i + 51), vello.rand(i + 101), vello.rand(i + 151)]); }
const geo = new THREE.BufferGeometry();
geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
const dots = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe8c668, size: 0.22, transparent: true, opacity: 0.95 }));
scene.add(dots);
const lg = new THREE.BufferGeometry(); const MAXL = N * 6;
lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXL * 6), 3));
const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xe8c668, transparent: true, opacity: 0.22 }));
scene.add(lines);
const el = (id) => document.getElementById(id);
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.round(n).toLocaleString("en-US");
vello.onSeek((t) => {
  const P = geo.attributes.position.array;
  for (let i = 0; i < N; i++) {
    const s = seeds[i], a = s[0] * 6.283 + t * (0.25 + s[3] * 0.4), r = 3 + s[1] * 6.5;
    P[i * 3] = Math.cos(a) * r * 0.9; P[i * 3 + 1] = (s[2] - 0.5) * 22 + Math.sin(t * 0.8 + s[0] * 9) * 0.6; P[i * 3 + 2] = Math.sin(a) * r * 0.6 - 4;
  }
  geo.attributes.position.needsUpdate = true;
  const L = lg.attributes.position.array; let c = 0;
  for (let i = 0; i < N && c < MAXL; i++) for (let j = i + 1; j < N && c < MAXL; j++) {
    const dx = P[i*3]-P[j*3], dy = P[i*3+1]-P[j*3+1], dz = P[i*3+2]-P[j*3+2];
    if (dx*dx + dy*dy + dz*dz < 7) { L.set([P[i*3],P[i*3+1],P[i*3+2],P[j*3],P[j*3+1],P[j*3+2]], c * 6); c++; }
  }
  lg.setDrawRange(0, c * 2); lg.attributes.position.needsUpdate = true;
  cam.position.x = Math.sin(t * 0.35) * 1.6; cam.lookAt(0, 0, -2);
  ren.render(scene, cam);
  const g = el("grid"); g.style.transform = "translateY(" + ((t * 40) % 90) + "px)";
  const k = seg(t, 0.2, 0.7), tt = seg(t, 0.5, 1.0), ss = seg(t, 1.5, 0.9);
  el("k").style.opacity = ease.out3(k); el("k").style.transform = "translateY(" + (1 - ease.out3(k)) * 30 + "px)";
  el("t").style.opacity = ease.out3(tt); el("t").style.transform = "translateY(" + (1 - ease.outBack(tt)) * 80 + "px) scale(" + lerp(0.94, 1, ease.out3(tt)) + ")";
  el("s").style.opacity = ease.out3(ss); el("s").style.transform = "translateY(" + (1 - ease.out3(ss)) * 40 + "px)";
  const st = document.querySelectorAll(".stat");
  [["n1", 1284], ["n2", 9640], ["n3", 2400000]].forEach(([id, v], i) => {
    const p = seg(t, 2.6 + i * 0.25, 1.4), e = ease.outExpo(p); el(id).textContent = fmt(v * e);
    st[i].style.opacity = ease.out3(seg(t, 2.5 + i * 0.25, 0.6)); st[i].style.transform = "translateY(" + (1 - ease.out3(seg(t, 2.5 + i * 0.25, 0.6))) * 60 + "px)";
  });
  const out = 1 - seg(t, 7.4, 0.6); document.getElementById("stage").style.opacity = out;
});`,
};

const REACT_STARTER: Composition = {
  engine: "react",
  title: "Vello rank-up",
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 8,
  css: BRAND_CSS,
  html: "",
  js: `const Card = ({ delay, label, value }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame, fps, delay, config: { damping: 14, stiffness: 120 } });
  const n = Math.round(interpolate(frame - delay, [0, 45], [0, value], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }));
  return (
    <div className="stat" style={{ opacity: s, transform: "translateY(" + (1 - s) * 70 + "px) scale(" + (0.9 + 0.1 * s) + ")" }}>
      <b>{n.toLocaleString("en-US")}</b><span>{label}</span>
    </div>
  );
};

function Video() {
  const frame = useCurrentFrame(); const { fps, durationInFrames } = useVideoConfig();
  const a = (d) => spring({ frame, fps, delay: d, config: { damping: 16 } });
  const fade = interpolate(frame, [durationInFrames - 20, durationInFrames - 1], [1, 0], { extrapolateLeft: "clamp" });
  const glow = 0.5 + 0.5 * Math.sin(frame / 14);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div className="bg" />
      <div className="grid" style={{ transform: "translateY(" + ((frame * 1.4) % 90) + "px)" }} />
      <div style={{ position: "absolute", left: 140, right: 140, top: 520, height: 520, borderRadius: 60, background: "radial-gradient(circle,rgba(232,198,104," + (0.18 + glow * 0.12) + "),transparent 70%)" }} />
      <div className="kicker" style={{ opacity: a(4), transform: "translateY(" + (1 - a(4)) * 30 + "px)" }}>Rank up</div>
      <div className="title" style={{ opacity: a(12), transform: "translateY(" + (1 - a(12)) * 90 + "px)" }}>Welcome to <i>Gold</i></div>
      <div className="sub" style={{ opacity: a(32) }}>1,000,000 verified views, earned in the open.</div>
      <div className="stats">
        <Card delay={60} label="Clips" value={642} />
        <Card delay={72} label="Days" value={41} />
        <Card delay={84} label="Rank" value={3} />
      </div>
    </AbsoluteFill>
  );
}`,
};

export function starterFor(engine: Engine, aspect: AspectKey = "9:16"): Composition {
  const base = engine === "react" ? REACT_STARTER : HTML_STARTER;
  const a = ASPECTS[aspect];
  return { ...base, width: a.width, height: a.height };
}

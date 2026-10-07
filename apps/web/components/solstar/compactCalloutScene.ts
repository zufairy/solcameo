import * as THREE from "three";
import type { CalloutCardData } from "@/lib/client/calloutCard";
import { compact } from "@/lib/client/calloutCard";
import { calloutArtwork } from "@/lib/solstar/calloutArtwork";
import { calloutTheme } from "@/lib/solstar/callout";
import type { CalloutScene } from "./calloutScene";
import { GLYPHS } from "./calloutPixels";

const THEMES = ["colosseum", "solana", "lambo", "bullrun", "neon", "ferrari", "vault", "aurora"];
const ease = (p: number) => 1 - (1 - Math.max(0, Math.min(1, p))) ** 3;
const amountOf = (d: CalloutCardData) => d.metric === "views" ? d.views : d.metric === "trade" ? d.tradePnlUsd ?? d.onchainTrade?.pnlSol : d.earningsUsd;
function numberText(d: CalloutCardData, value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (d.metric === "views") return compact(Math.round(value));
  const abs = Math.abs(value);
  if (d.onchainTrade && d.tradePnlUsd == null) return `${value < 0 ? "-" : "+"}${abs >= 1000 ? compact(abs) : abs.toFixed(5)}`;
  return `${value < 0 ? "-" : ""}$${abs >= 1000 ? compact(abs) : abs.toFixed(2)}`;
}
/** Dedicated horizontal composition: physical pixels for the counter, full-screen theme shader.
 * The social card keeps its own perspective scene and composition. */
export function buildCompactCalloutScene(initial: CalloutCardData): CalloutScene {
  let data = initial, width = 500, height = 100, pixelRatio = 1, disposed = false;
  let time = 0, lastTime = -1, changedAt = 0, startAmount = 0, animatedAmount: number | undefined;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-250, 250, 50, -50, 0.1, 100); camera.position.z = 10;
  const colors = calloutTheme(initial.theme);
  let artwork: THREE.Texture | undefined, markTexture: THREE.Texture | undefined;
  const uniforms = { art: { value: null as THREE.Texture | null }, artScale: { value: new THREE.Vector2(1, 1) }, artAmount: { value: 0 }, time: { value: 0 }, aspect: { value: 5 }, accent: { value: new THREE.Color(colors.accent) }, background: { value: new THREE.Color(colors.background) }, theme: { value: Math.max(0, THEMES.indexOf(initial.theme || "colosseum")) } };
  const backdropMat = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.99,1.0);}',
    fragmentShader: `varying vec2 vUv; uniform float time, aspect, theme, artAmount; uniform vec3 accent, background; uniform sampler2D art; uniform vec2 artScale;
      float line(float d,float w){return 1.0-smoothstep(w,w*2.0,abs(d));}
      void main(){vec2 uv=vUv; vec2 p=(uv-.5)*vec2(aspect,1.0); float t=time;
        vec3 color=background;
        float halo=exp(-length((uv-vec2(.8,.45))*vec2(1.4,1.6))*3.2);
        color+=accent*halo*.16;
        if(theme>6.5){
          float wave=sin(uv.x*5.0+t*.28)*.14+sin(uv.x*10.0-t*.17)*.04;
          float ribbon=exp(-pow((uv.y-.55-wave)*5.0,2.0));
          float second=exp(-pow((uv.y-.25+wave*.65)*7.0,2.0));
          vec3 tint=mix(vec3(.20,.08,.65),vec3(.12,.64,.72),uv.x);
          color+=tint*(ribbon*.35+second*.22);
        }else if(theme>.5 && theme<1.5){
          float a=exp(-pow((p.y+sin(p.x*2.0+t*.25)*.17)*6.0,2.0));
          float b=exp(-pow((p.y-.24+sin(p.x*2.1-t*.2)*.13)*8.0,2.0));
          color+=vec3(.25,.06,.65)*a*.24+accent*b*.19;
        }else if(theme>4.5 && theme<5.5){
          float lane=fract(p.y*6.0-p.x*.55);
          float sweep=pow(max(0.0,sin(p.x*2.5-t*1.4)),12.0);
          color+=accent*line(lane-.5,.012)*(.1+sweep*.3);
          float carbon=step(.5,fract(p.x*30.0))*step(.5,fract(p.y*30.0));
          color+=vec3(carbon*.009);
        }else if(theme>2.5 && theme<4.5){
          vec2 g=abs(fract(p*vec2(5.0,6.0))-.5);
          float grid=line(g.x-.5,.018)+line(g.y-.5,.018);
          color+=accent*grid*.07;
          float sweep=exp(-pow((p.x-sin(t*.15)*aspect*.4)*1.7,2.0));
          color+=accent*sweep*.07;
          if(theme>3.5) color+=vec3(.02,.3,.5)*exp(-pow((uv.y-fract(t*.06))*18.0,2.0))*.10;
        }else if(theme>1.5 && theme<2.5){
          float lane=abs(fract(p.x*.9+p.y*1.6)-.5);
          color+=accent*line(lane,.012)*.11;
          color+=accent*exp(-pow((p.x-sin(t*.2)*aspect*.5)*1.5,2.0))*.09;
        }else if(theme>5.5){
          float r=length(p-vec2(aspect*.28,0.0));
          float rings=line(fract(r*5.0)-.5,.035);
          float shine=pow(max(0.0,cos(atan(p.y,p.x-aspect*.28)-t*.2)),18.0);
          color+=accent*(rings*.05+shine*.1);
        }else{
          vec2 arch=p-vec2(-aspect*.28,-.32);
          float r=length(arch); float rings=line(fract(r*3.4)-.5,.024)*step(0.0,arch.y);
          color+=accent*rings*.08;
          color+=accent*exp(-pow((p.x-sin(t*.1)*aspect*.4)*1.2,2.0))*.05;
        }
        vec2 photoUv=(uv-.5)*artScale+.5+vec2(sin(t*.07)*.008,cos(t*.05)*.006)*artScale;
        color+=texture2D(art,clamp(photoUv,0.0,1.0)).rgb*artAmount*mix(.25,1.0,smoothstep(.15,.6,uv.x));
        // Stable identity and metric contrast while the theme moves behind them.
        color*=mix(.55,1.0,smoothstep(.0,.55,uv.x));
        float edge=smoothstep(.0,.22,uv.y)*smoothstep(.0,.22,1.0-uv.y);
        color*=mix(.72,1.0,edge);
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const backdropGeo = new THREE.PlaneGeometry(2, 2);
  const backdrop = new THREE.Mesh(backdropGeo, backdropMat); backdrop.name = `compact-backdrop-${initial.theme || "colosseum"}`; backdrop.frustumCulled = false; backdrop.renderOrder = -10; scene.add(backdrop);

  const loader = new THREE.TextureLoader(); loader.setCrossOrigin("anonymous");
  const fitArtwork = () => {
    if (!artwork) return;
    const image = artwork.image as { width: number; height: number };
    const aspect = image.width / image.height, target = width / height;
    uniforms.artScale.value.set(aspect > target ? target / aspect : 1, aspect > target ? 1 : aspect / target);
  };
  loader.load(calloutArtwork(initial.theme).image, texture => {
    if (disposed) { texture.dispose(); return; }
    artwork = texture; texture.colorSpace = THREE.SRGBColorSpace;
    uniforms.art.value = texture; uniforms.artAmount.value = ["lambo", "ferrari", "colosseum"].includes(initial.theme || "") ? .15 : .07;
    fitArtwork();
  }, undefined, () => {});
  const markGeo = new THREE.PlaneGeometry(1, 1);
  const markMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: .11, depthTest: false, depthWrite: false });
  const mark = new THREE.Mesh(markGeo, markMat); mark.name = "compact-solana-watermark"; mark.visible = false; mark.renderOrder = 0; scene.add(mark);
  const fitMark = () => {
    if (!markTexture) return;
    const image = markTexture.image as { width: number; height: number };
    const size = Math.min(height * .68, width * .16);
    mark.scale.set(size, size * image.height / image.width, 1); mark.position.set(width * .33 - width / 2, 0, .2);
  };
  if (initial.theme === "solana") loader.load("/brand/solana-user.png", texture => {
    if (disposed) { texture.dispose(); return; }
    markTexture = texture; texture.colorSpace = THREE.SRGBColorSpace; markMat.map = texture; markMat.needsUpdate = true; mark.visible = true; fitMark();
  }, undefined, () => {});

  // No bloom, perspective magnification, shimmer scaling, or moving glyph edges.
  const counterGeo = new THREE.BoxGeometry(1, 1, .1);
  const counterMat = new THREE.MeshBasicMaterial({ color: colors.accent, depthTest: false, depthWrite: false, toneMapped: false });
  const counter = new THREE.InstancedMesh(counterGeo, counterMat, 16 * 35); counter.name = "compact-crisp-counter"; counter.instanceMatrix.setUsage(THREE.DynamicDrawUsage); counter.frustumCulled = false; counter.renderOrder = 10; scene.add(counter);
  const matrix = new THREE.Matrix4();
  function drawCounter(value: number | undefined) {
    const chars = [...numberText(data, value)].filter(c => GLYPHS[c]);
    const columns = Math.max(1, chars.length * 6 - 1);
    const panel = Math.min((width - 24) * .4, 190);
    const available = Math.max(30, panel - 20);
    // Snap every square to the drawing buffer's pixel grid, even at fractional DPR.
    const cell = Math.max(1, Math.floor(Math.min(3, available / columns) * pixelRatio)) / pixelRatio;
    const square = Math.max(1, Math.floor(cell * .84 * pixelRatio)) / pixelRatio;
    const originX = Math.round((width - 12 - panel / 2 - columns * cell / 2) * pixelRatio) / pixelRatio;
    const originY = Math.round((height / 2 - 7 * cell / 2) * pixelRatio) / pixelRatio;
    let count = 0;
    chars.forEach((c, character) => GLYPHS[c].forEach((row, y) => [...row].forEach((on, x) => {
      if (on !== "X") return;
      const px = originX + (character * 6 + x) * cell + square / 2;
      const py = originY + y * cell + square / 2;
      matrix.makeScale(square, square, .1); matrix.setPosition(px - width / 2, height / 2 - py, 1);
      counter.setMatrixAt(count++, matrix);
    })));
    counter.count = count; counter.instanceMatrix.needsUpdate = true;
    counterMat.color.set((value ?? 0) < 0 ? "#fb7185" : calloutTheme(data.theme).accent);
  }
  function resize(w: number, h: number, dpr: number) {
    width = Math.max(1, w); height = Math.max(1, h); pixelRatio = Math.max(1, dpr);
    camera.left = -width / 2; camera.right = width / 2; camera.top = height / 2; camera.bottom = -height / 2; camera.updateProjectionMatrix();
    uniforms.aspect.value = width / height; fitArtwork(); fitMark(); drawCounter(animatedAmount);
  }
  return {
    scene, camera, resize,
    update(t) {
      if (disposed) return;
      time = t; uniforms.time.value = t;
      const target = amountOf(data);
      const progress = t === lastTime ? 1 : ease((t - changedAt) / .7);
      animatedAmount = target == null ? undefined : startAmount + (target - startAmount) * progress;
      drawCounter(animatedAmount); lastTime = t;
    },
    setData(d) {
      if (amountOf(d) !== amountOf(data) || d.metric !== data.metric || !!d.onchainTrade !== !!data.onchainTrade) {
        startAmount = d.metric === data.metric && !!d.onchainTrade === !!data.onchainTrade ? animatedAmount ?? 0 : 0;
        changedAt = time;
      }
      data = d;
    },
    dispose() { disposed = true; counter.dispose(); counterGeo.dispose(); counterMat.dispose(); backdropGeo.dispose(); backdropMat.dispose(); artwork?.dispose(); markTexture?.dispose(); markGeo.dispose(); markMat.dispose(); },
  };
}

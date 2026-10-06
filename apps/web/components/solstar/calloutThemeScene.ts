import * as THREE from "three";
import { calloutStyle } from "@/lib/solstar/calloutStyle";
import { calloutTheme } from "@/lib/solstar/callout";

/** Decorative geometry carries no market data; actual metrics remain in the counter. */
export function createCalloutMotif(scene: THREE.Scene, theme: string | undefined, height: number) {
  const style = calloutStyle(theme), color = calloutTheme(theme).accent;
  const group = new THREE.Group(); group.name = `callout-motif-${style.motif}`; group.position.z = -1.1; scene.add(group);
  const resources: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(value: T) => (resources.push(value), value);
  const line = (points: THREE.Vector3[], opacity = 0.2, tint: string = color) => {
    const geometry = keep(new THREE.BufferGeometry().setFromPoints(points));
    const material = keep(new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity, depthWrite: false }));
    const object = new THREE.Line(geometry, material); group.add(object); return object;
  };
  let ribbons: THREE.ShaderMaterial | undefined;
  const streaks: THREE.Line[] = [];
  if (style.motif === "ribbons") {
    ribbons = keep(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec2 vUv; uniform float time;
        void main(){float wave=sin(vUv.x*6.0+time*.22)*.16+sin(vUv.x*11.0-time*.13)*.05;
          float a=exp(-pow((vUv.y-.55-wave)*9.0,2.0));
          float b=exp(-pow((vUv.y-.35+wave*.65)*11.0,2.0));
          float edge=smoothstep(0.0,.18,vUv.x)*smoothstep(0.0,.18,1.0-vUv.x);
          vec3 color=mix(vec3(.37,.26,.82),vec3(.23,.84,.87),vUv.x);
          gl_FragColor=vec4(color,(a*.27+b*.16)*edge);}`,
    }));
    group.add(new THREE.Mesh(keep(new THREE.PlaneGeometry(20, height * 1.4)), ribbons));
  } else if (style.motif === "speed") {
    for (let i = 0; i < 9; i++) {
      const y = -height / 2 + i * height / 8;
      streaks.push(line([new THREE.Vector3(-10, y, 0), new THREE.Vector3(-4, y + 1.5, 0)], i % 3 === 0 ? 0.32 : 0.12, i % 3 ? "#faf0e8" : color));
    }
    line([new THREE.Vector3(-8, -height * .4, 0), new THREE.Vector3(8, -height * .4, 0)], .35);
  } else if (style.motif === "chart" || style.motif === "grid") {
    for (let x = -8; x <= 8; x += 1.4) line([new THREE.Vector3(x, -height / 2, 0), new THREE.Vector3(x, height / 2, 0)], .065);
    for (let y = -height / 2; y <= height / 2; y += .7) line([new THREE.Vector3(-8, y, 0), new THREE.Vector3(8, y, 0)], .065);
    if (style.motif === "chart") {
      const path = Array.from({ length: 60 }, (_, i) => new THREE.Vector3(-8 + i * 16 / 59, -height * .38 + i / 59 * height * .7 + Math.sin(i * .52) * height * .04, 0));
      line(path, .28, "#d9e5c6");
      line(path.map(point => point.clone().add(new THREE.Vector3(0, -.07, 0))), .08);
    }
  } else {
    const segments = style.motif === "hex" ? 6 : style.motif === "arches" ? 48 : 96;
    for (let i = 0; i < 3; i++) {
      const radius = height * (.28 + i * .12);
      const points = Array.from({ length: segments + 1 }, (_, n) => {
        const angle = n / segments * Math.PI * (style.motif === "arches" ? 1 : 2);
        return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      });
      const outline = line(points, style.motif === "seal" ? .23 : .12);
      outline.position.x = style.motif === "arches" ? -5.6 : 5.7;
    }
  }
  return {
    update(time: number) {
      if (ribbons) ribbons.uniforms.time.value = time;
      streaks.forEach((streak, i) => { streak.position.x = (time * .28 + i * 1.9) % 18; });
      if (["orbit", "seal", "hex"].includes(style.motif)) group.rotation.z = Math.sin(time * .08) * .035;
    },
    dispose() { scene.remove(group); resources.forEach(resource => resource.dispose()); },
  };
}

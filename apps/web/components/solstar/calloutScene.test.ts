// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildCalloutScene } from "./calloutScene";
import type { CalloutCardData } from "@/lib/client/calloutCard";
const data: CalloutCardData = { name: "Agent", ticker: "AGENT", body: "My call", cap: "$2K", theme: "solana", metric: "earnings", earningsUsd: 1234 };
const loaded: string[] = [];
beforeEach(() => {
  loaded.length = 0;
  const gradient = { addColorStop: vi.fn() };
  const context = new Proxy({ createRadialGradient: () => gradient, createLinearGradient: () => gradient, measureText: (s: string) => ({ width: s.length * 12 }) }, { get: (target, key) => Reflect.get(target, key) ?? vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(function (url, onLoad) {
    loaded.push(url);
    const texture = new THREE.Texture({ width: 512, height: 512 } as HTMLImageElement);
    onLoad?.(texture);
    return texture;
  });
});
afterEach(() => vi.restoreAllMocks());
describe("shared callout scene", () => {
  it("renders the same pixel glyphs within the compact counter area and updates its metric", () => {
    const s = buildCalloutScene(data, { compact: true });
    expect(s.camera).toBeInstanceOf(THREE.OrthographicCamera);
    s.resize?.(500, 100, 2);
    s.update(2.4, 1, { x: 0, y: 0 });
    const counters: THREE.InstancedMesh[] = [];
    s.scene.traverse(object => { if (object instanceof THREE.InstancedMesh) counters.push(object); });
    const cubes = counters.find(c => c.geometry instanceof THREE.BoxGeometry)!;
    expect(cubes.count).toBeGreaterThan(20);
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    for (let i = 0; i < cubes.count; i++) {
      cubes.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix);
      expect(point.x).toBeGreaterThan(75); expect(point.x).toBeLessThan(235);
      expect(Math.abs(point.y)).toBeLessThan(15);
    }
    s.setData({ ...data, metric: "trade", tradePnlUsd: -25 });
    s.update(2.4, 1, { x: 0, y: 0 });
    expect((cubes.material as THREE.MeshBasicMaterial).color.getHexString()).toBe("fb7185");
    s.dispose();
  });
  it("keeps physical-pixel glyphs inside the metric panel at narrow and wide sizes", () => {
    const s = buildCalloutScene({ ...data, metric: "trade", tradePnlUsd: -987654 }, { compact: true });
    const cubes = s.scene.getObjectByName("compact-crisp-counter") as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3(), scale = new THREE.Vector3();
    for (const width of [280, 440, 500]) {
      s.resize?.(width, 100, 2); s.update(3, 1, { x: 1, y: 1 });
      for (let i = 0; i < cubes.count; i++) {
        cubes.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix); scale.setFromMatrixScale(matrix);
        const left = point.x + width / 2 - scale.x / 2;
        const right = point.x + width / 2 + scale.x / 2;
        expect(right).toBeLessThan(width - 12);
        expect(left).toBeGreaterThan(width - 12 - Math.min((width - 24) * .4, 190));
        expect(left * 2).toBeCloseTo(Math.round(left * 2));
      }
      const camera = s.camera as THREE.OrthographicCamera;
      expect(camera.right - camera.left).toBe(width);
      expect(camera.top - camera.bottom).toBe(100);
    }
    expect(cubes.parent?.rotation.y).toBe(0);
    expect(s.scene.children.some(o => o instanceof THREE.InstancedMesh && o !== cubes)).toBe(false);
    s.dispose();
  });
  it("fills the compact canvas with a distinct animated background for every theme", () => {
    for (const theme of ["colosseum", "solana", "lambo", "bullrun", "neon", "ferrari", "vault", "aurora"]) {
      const s = buildCalloutScene({ ...data, theme }, { compact: true });
      s.resize?.(440, 100, 2); s.update(4, 1, { x: 0, y: 0 });
      const plane = s.scene.getObjectByName(`compact-backdrop-${theme}`) as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
      expect(plane.frustumCulled).toBe(false);
      expect(plane.geometry.parameters.width).toBe(2);
      expect(plane.material.vertexShader).toContain("gl_Position=vec4(position.xy");
      expect(plane.material.uniforms.aspect.value).toBe(4.4);
      expect(plane.material.uniforms.time.value).toBe(4);
      s.dispose();
    }
  });
  it("uses Solcameo for all floating previews before an agent is selected", () => {
    const s = buildCalloutScene({ ...data, imageUrl: undefined, thumbs: undefined });
    expect(loaded.filter(url => url === "/brand/solcameo-mark.png")).toHaveLength(7);
    expect(loaded.some(url => url.startsWith("https://images.unsplash.com/"))).toBe(true);
    expect((s.camera as THREE.PerspectiveCamera).aspect).toBeCloseTo(16 / 9);
    s.update(2.4, 1, { x: 0, y: 0 });
    s.dispose();
  });
  it("loads the supplied Solana image instead of generating a replacement mark", () => {
    const s = buildCalloutScene(data, { compact: true });
    expect(loaded).toContain("/brand/solana-user.png");
    s.dispose();
  });
  it("gives Aurora, Ferrari and Bullrun distinct animated scene identities", () => {
    for (const [theme, motif] of [["aurora", "ribbons"], ["ferrari", "speed"], ["bullrun", "chart"]]) {
      const s = buildCalloutScene({ ...data, theme });
      const group = s.scene.getObjectByName(`callout-motif-${motif}`)!;
      expect(group).toBeTruthy();
      expect(group.children.length).toBeGreaterThan(0);
      s.update(3, 1, { x: 0, y: 0 });
      if (theme === "aurora") expect(((group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.time.value).toBe(3);
      s.dispose();
    }
  });

});

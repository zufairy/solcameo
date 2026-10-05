"use client";

/** Land/ocean mask shared by the globe visuals: Natural Earth land (the same
 *  /1b-club/world-110m.json the 1B Club uses) rasterised once to an equirectangular
 *  720x360 RGBA mask (alpha > 0 means land) and cached for the page's lifetime. */

type Topology = { transform: { scale: number[]; translate: number[] }; arcs: number[][][]; objects: { land: { geometries: { type: string; arcs: number[][] | number[][][] }[] } } };

export const MASK_W = 720;
export const MASK_H = 360;

let cached: Promise<ImageData> | null = null;

export function loadLandMask(): Promise<ImageData> {
  if (cached) return cached;
  cached = (async () => {
    const t = (await (await fetch("/1b-club/world-110m.json")).json()) as Topology;
    const [sx, sy] = t.transform.scale, [tx, ty] = t.transform.translate;
    const arcs = t.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty] as [number, number]; }); });
    const c = document.createElement("canvas");
    c.width = MASK_W; c.height = MASK_H;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    const ring = (idx: number[]) => {
      const pts: [number, number][] = [];
      for (const i of idx) { const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse(); pts.push(...(pts.length ? a.slice(1) : a)); }
      return pts;
    };
    const draw = (rings: number[][][]) => {
      g.beginPath();
      for (const r of rings) ring(r as unknown as number[]).forEach(([lon, lat], i) => { const x = (lon + 180) * 2, y = (90 - lat) * 2; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.fill("evenodd");
    };
    for (const geo of t.objects.land.geometries) {
      if (geo.type === "Polygon") draw(geo.arcs as number[][][]);
      else if (geo.type === "MultiPolygon") for (const poly of geo.arcs as unknown as number[][][][]) draw(poly as number[][][]);
    }
    return g.getImageData(0, 0, MASK_W, MASK_H);
  })().catch((e) => { cached = null; throw e; });
  return cached;
}

/** True when (lat, lon) in degrees is land. */
export function isLand(mask: ImageData, lat: number, lon: number): boolean {
  const x = Math.min(MASK_W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * MASK_W)));
  const y = Math.min(MASK_H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * MASK_H)));
  return mask.data[(y * MASK_W + x) * 4 + 3] > 40;
}

/** Hubs used by the globe visuals (lat, lon). Index 0 is the "brand" origin. */
export const GLOBE_HUBS: { name: string; code: string; lat: number; lon: number }[] = [
  { name: "Kuala Lumpur", code: "MY", lat: 3.1, lon: 101.7 },
  { name: "London", code: "UK", lat: 51.5, lon: -0.1 },
  { name: "New York", code: "US", lat: 40.7, lon: -74 },
  { name: "Los Angeles", code: "US", lat: 34.1, lon: -118.2 },
  { name: "São Paulo", code: "BR", lat: -23.5, lon: -46.6 },
  { name: "Lagos", code: "NG", lat: 6.5, lon: 3.4 },
  { name: "Nairobi", code: "KE", lat: -1.3, lon: 36.8 },
  { name: "Dubai", code: "AE", lat: 25.2, lon: 55.3 },
  { name: "Mumbai", code: "IN", lat: 19.1, lon: 72.9 },
  { name: "Jakarta", code: "ID", lat: -6.2, lon: 106.8 },
  { name: "Manila", code: "PH", lat: 14.6, lon: 121 },
  { name: "Tokyo", code: "JP", lat: 35.7, lon: 139.7 },
  { name: "Sydney", code: "AU", lat: -33.9, lon: 151.2 },
  { name: "Berlin", code: "DE", lat: 52.5, lon: 13.4 },
  { name: "Istanbul", code: "TR", lat: 41, lon: 29 },
  { name: "Mexico City", code: "MX", lat: 19.4, lon: -99.1 },
];

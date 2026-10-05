/**
 * Best-effort product-image discovery for a merchant/landing page. Fetches the
 * page HTML once and mines image URLs from the places products actually live,
 * in confidence order:
 *   1. JSON-LD `Product.image` (the canonical product photo on any Shopify /
 *      schema.org-correct store)
 *   2. `og:image` / `twitter:image` metas (the page's chosen hero image)
 *   3. Large-looking inline `<img>` tags, filtered against obvious chrome
 *      (logos, icons, sprites, avatars, tracking pixels, svg/data URIs)
 *
 * Pure URL extraction — no image download here. The caller vision-checks the
 * candidates (they may include banners/lifestyle shots) and picks one.
 */
export async function crawlProductImageCandidates(url: string, cap = 8): Promise<string[]> {
  let base: URL;
  try {
    base = new URL(url);
    if (!/^https?:$/.test(base.protocol)) return [];
  } catch {
    return [];
  }
  let html: string;
  try {
    const res = await fetch(base.toString(), {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VelloBot/1.0)" },
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const found: string[] = [];
  const push = (raw?: string | null) => {
    if (!raw) return;
    let abs: string;
    try {
      abs = new URL(raw.trim(), base).toString();
    } catch {
      return;
    }
    if (!/^https?:/.test(abs)) return;
    // Chrome/noise filter: vectors, inline data, and URL names that are clearly
    // site furniture rather than a product photo.
    if (/\.svg(\?|$)/i.test(abs)) return;
    if (/logo|favicon|icon|sprite|avatar|badge|pixel|placeholder|loading|spinner/i.test(abs)) return;
    if (!found.includes(abs)) found.push(abs);
  };

  // 1. JSON-LD Product.image — string, array, or ImageObject{url}.
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const collect = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { node.forEach(collect); return; }
        const o = node as Record<string, unknown>;
        const type = o["@type"];
        const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
        if (isProduct && o.image) {
          const imgs = Array.isArray(o.image) ? o.image : [o.image];
          for (const im of imgs) {
            if (typeof im === "string") push(im);
            else if (im && typeof im === "object") push((im as { url?: string }).url);
          }
        }
        // @graph / nested nodes
        for (const v of Object.values(o)) if (v && typeof v === "object") collect(v);
      };
      collect(JSON.parse(m[1]));
    } catch { /* malformed JSON-LD — skip block */ }
  }

  // 2. og:image / twitter:image (either attribute order).
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*>/gi)) {
    const c = m[0].match(/content=["']([^"']+)["']/i);
    push(c?.[1]);
  }

  // 3. Inline <img> tags — prefer ones that declare real size or a product-ish
  //    path. srcset's last (largest) entry wins over src when present.
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const srcset = tag.match(/srcset=["']([^"']+)["']/i)?.[1];
    const src = srcset
      ? srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop()
      : tag.match(/src=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    const w = Number(tag.match(/width=["']?(\d+)/i)?.[1] ?? 0);
    const h = Number(tag.match(/height=["']?(\d+)/i)?.[1] ?? 0);
    const declaredTiny = (w > 0 && w < 200) || (h > 0 && h < 200);
    const productish = /product|item|shop|cdn\.shop|goods|catalog|media/i.test(src);
    if (declaredTiny && !productish) continue;
    push(src);
    if (found.length >= cap * 2) break; // plenty of raw candidates
  }

  return found.slice(0, cap);
}

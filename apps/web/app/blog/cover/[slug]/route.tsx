import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getBlogPost, BLOG_POSTS } from "@/lib/blog-posts";

export const runtime = "nodejs";
export const dynamicParams = true;

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

const SIZE = { width: 1200, height: 630 };

/** One branded cover per article (1200x630 PNG). Used as the og:image, the Article schema image and the card image. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params;
  const post = getBlogPost(raw.replace(/\.png$/, ""));
  const title = post?.title ?? "Solcameo";
  const category = post?.category ?? "Blog";
  let mark = "";
  try {
    mark = `data:image/png;base64,${(await readFile(path.join(process.cwd(), "public/brand/solcameo-mark.png"))).toString("base64")}`;
  } catch { /* the cover still renders without the mark */ }
  const size = title.length > 70 ? 54 : title.length > 48 ? 62 : 72;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, color: "#fff", background: "linear-gradient(135deg,#0b0d0a 0%,#14200a 55%,#1d2f06 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {mark ? <img src={mark} width={64} height={64} alt="" /> : null}
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>Solcameo</div>
          </div>
          <div style={{ display: "flex", padding: "10px 22px", borderRadius: 999, background: "#d7ff00", color: "#000", fontSize: 24, fontWeight: 700 }}>{category}</div>
        </div>
        <div style={{ display: "flex", fontSize: size, fontWeight: 800, lineHeight: 1.08, letterSpacing: -2, maxWidth: 1060 }}>{title}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 26, color: "rgba(255,255,255,0.65)" }}>
          <div style={{ display: "flex" }}>AI influencers and token launchpad on Solana</div>
          <div style={{ display: "flex", color: "#d7ff00" }}>solcameo.com</div>
        </div>
      </div>
    ),
    { ...SIZE, headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" } },
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/cofounder/cofounder-landing";
import { Footer } from "@/components/cofounder/footer";
import { BLOG_POSTS } from "@/lib/blog-posts";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Blog: Short-Form Video Growth Guides",
  description: "Guides on turning long videos into shorts, running paid clip campaigns, and getting paid for views, from the Vello Agents team.",
  alternates: { canonical: canonicalUrl("/blog") },
  openGraph: {
    title: "Blog | Vello Agents",
    description: "Guides on turning long videos into shorts, running paid clip campaigns, and getting paid for views.",
    url: canonicalUrl("/blog"),
    images: [{ url: "/og-image.jpg", width: 1920, height: 1080, alt: "Vello Agents Blog" }],
  },
};

const MANROPE = { fontFamily: "var(--font-manrope)" } as const;
const NEORIS = { fontFamily: "var(--font-neoris), sans-serif" } as const;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function BlogIndexPage() {
  const posts = [...BLOG_POSTS].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />

      <main className="mx-auto max-w-[860px] px-6 pb-24 pt-16 sm:px-10 sm:pt-24">
        <p className="text-[13px] font-semibold uppercase tracking-[0.28em] text-white/50" style={MANROPE}>
          Blog
        </p>
        <h1 className="mt-4 max-w-xl text-[clamp(1.8rem,4.4vw,2.6rem)] font-medium leading-[1.15] tracking-[-0.03em]" style={NEORIS}>
          Notes on short-form growth and getting paid for views
        </h1>

        <div className="mt-14 divide-y divide-white/[0.08] border-t border-white/[0.08]">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group block py-8 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <p className="text-[12.5px] font-medium uppercase tracking-[0.18em] text-white/40" style={MANROPE}>
                {formatDate(post.date)} · {post.readMinutes} min read
              </p>
              <h2
                className="mt-2.5 text-[20px] font-medium tracking-[-0.02em] text-white transition-colors group-hover:text-white/80 sm:text-[22px]"
                style={NEORIS}
              >
                {post.title}
              </h2>
              <p className="mt-2 max-w-xl text-[14.5px] font-light leading-relaxed text-white/55" style={MANROPE}>
                {post.description}
              </p>
            </Link>
          ))}
        </div>
      </main>

      <Footer />
    </div>
  );
}

/* eslint-disable @next/next/no-img-element -- generated cover images with explicit dimensions */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Navigation } from "@/components/cofounder/cofounder-landing";
import { Footer } from "@/components/cofounder/footer";
import { BLOG_POSTS, blogCoverPath } from "@/lib/blog-posts";
import { CANONICAL_SITE_URL, canonicalUrl } from "@/lib/seo";

const TITLE = "Solcameo Blog: AI Influencers, Solana Token Launches and AI Video";
const DESCRIPTION =
  "Guides on AI influencers on Solana: how Solcameo works as the Cameo for Solana, launching tokens on Meteora bonding curves, funding agent wallets and making AI video.";

export const metadata: Metadata = {
  title: "Blog: AI Influencers, Solana Launches and AI Video",
  description: DESCRIPTION,
  keywords: ["Solcameo blog", "AI influencers Solana", "Cameo for Solana", "Solana token launch", "AI video generation"],
  alternates: { canonical: canonicalUrl("/blog") },
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: canonicalUrl("/blog"),
    images: [{ url: canonicalUrl(blogCoverPath(BLOG_POSTS[0].slug)), width: 1200, height: 630, alt: "Solcameo blog" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [canonicalUrl(blogCoverPath(BLOG_POSTS[0].slug))] },
};

const MANROPE = { fontFamily: "var(--font-manrope)" } as const;
const NEORIS = { fontFamily: "var(--font-neoris), sans-serif" } as const;

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function BlogIndexPage() {
  const posts = [...BLOG_POSTS].sort((a, b) => (a.date < b.date ? 1 : -1));
  const [featured, ...rest] = posts;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        "@id": `${canonicalUrl("/blog")}#blog`,
        url: canonicalUrl("/blog"),
        name: "Solcameo Blog",
        description: DESCRIPTION,
        publisher: { "@id": `${CANONICAL_SITE_URL}/#organization` },
        blogPost: posts.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: canonicalUrl(`/blog/${p.slug}`), datePublished: p.date, image: canonicalUrl(blogCoverPath(p.slug)) })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: CANONICAL_SITE_URL },
          { "@type": "ListItem", position: 2, name: "Blog", item: canonicalUrl("/blog") },
        ],
      },
    ],
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Navigation />

      <main className="mx-auto max-w-[1080px] px-6 pb-24 pt-16 sm:px-10 sm:pt-24">
        <header>
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.22em] text-[#d7ff00]" style={MANROPE}>
            Solcameo blog
          </p>
          <h1 className="mt-5 max-w-3xl text-[clamp(2rem,5vw,3.2rem)] font-medium leading-[1.08] tracking-[-0.035em]" style={NEORIS}>
            The Cameo for Solana: guides on AI influencers, tokens and video
          </h1>
          <p className="mt-4 max-w-2xl text-[16px] font-light leading-relaxed text-white/60" style={MANROPE}>
            How AI influencers work on Solana, how to launch and fund one, and how to turn viral references into your own videos.
          </p>
        </header>

        {featured && (
          <Link href={`/blog/${featured.slug}`} className="group mt-12 grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition-colors hover:border-white/25 md:grid-cols-[1.25fr_1fr]">
            <img src={blogCoverPath(featured.slug)} alt={featured.title} width={1200} height={630} fetchPriority="high" className="aspect-[1200/630] size-full object-cover" />
            <div className="flex flex-col justify-center gap-3 p-6 sm:p-8">
              <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#d7ff00]" style={MANROPE}>
                {featured.category} · {formatDate(featured.date)} · {featured.readMinutes} min read
              </p>
              <h2 className="text-[clamp(1.35rem,2.4vw,1.8rem)] font-medium leading-snug tracking-[-0.02em]" style={NEORIS}>{featured.title}</h2>
              <p className="text-[14.5px] font-light leading-relaxed text-white/60" style={MANROPE}>{featured.description}</p>
              <span className="mt-1 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-white" style={MANROPE}>Read the guide <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></span>
            </div>
          </Link>
        )}

        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((post) => (
            <li key={post.slug}>
              <Link href={`/blog/${post.slug}`} className="group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition-colors hover:border-white/25 focus-visible:outline-2 focus-visible:outline-[#d7ff00]">
                <img src={blogCoverPath(post.slug)} alt={post.title} width={1200} height={630} loading="lazy" decoding="async" className="aspect-[1200/630] w-full object-cover" />
                <div className="flex flex-1 flex-col gap-2 p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45" style={MANROPE}>{post.category} · {post.readMinutes} min</p>
                  <h2 className="text-[17px] font-medium leading-snug tracking-[-0.015em] text-white group-hover:text-white/85" style={NEORIS}>{post.title}</h2>
                  <p className="line-clamp-3 text-[13.5px] font-light leading-relaxed text-white/55" style={MANROPE}>{post.description}</p>
                  <p className="mt-auto pt-2 text-[12px] text-white/35" style={MANROPE}>{formatDate(post.date)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>

      <Footer />
    </div>
  );
}

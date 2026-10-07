/* eslint-disable @next/next/no-img-element -- generated cover images with explicit dimensions */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Navigation } from "@/components/cofounder/cofounder-landing";
import { Footer } from "@/components/cofounder/footer";
import { BlogBlockView } from "@/components/cofounder/blog-block";
import { BLOG_POSTS, blogCoverPath, getBlogPost } from "@/lib/blog-posts";
import { CANONICAL_SITE_URL, SITE_NAME, canonicalUrl } from "@/lib/seo";

const MANROPE = { fontFamily: "var(--font-manrope)" } as const;
const NEORIS = { fontFamily: "var(--font-neoris), sans-serif" } as const;

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};
  const url = canonicalUrl(`/blog/${post.slug}`);
  const cover = canonicalUrl(blogCoverPath(post.slug));
  return {
    title: post.title,
    description: post.description,
    keywords: post.keywords,
    authors: [{ name: SITE_NAME, url: CANONICAL_SITE_URL }],
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url,
      siteName: SITE_NAME,
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      authors: [SITE_NAME],
      section: post.category,
      tags: post.keywords,
      images: [{ url: cover, width: 1200, height: 630, alt: post.title }],
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description, images: [cover] },
  };
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();
  const url = canonicalUrl(`/blog/${post.slug}`);
  const cover = canonicalUrl(blogCoverPath(post.slug));
  const related = (post.related ?? []).map((s) => getBlogPost(s)).filter((p): p is NonNullable<typeof p> => !!p);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${url}#article`,
        headline: post.title,
        description: post.description,
        image: { "@type": "ImageObject", url: cover, width: 1200, height: 630 },
        datePublished: post.date,
        dateModified: post.updated ?? post.date,
        keywords: post.keywords.join(", "),
        articleSection: post.category,
        inLanguage: "en",
        author: { "@type": "Organization", name: SITE_NAME, url: CANONICAL_SITE_URL },
        publisher: { "@id": `${CANONICAL_SITE_URL}/#organization` },
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: CANONICAL_SITE_URL },
          { "@type": "ListItem", position: 2, name: "Blog", item: canonicalUrl("/blog") },
          { "@type": "ListItem", position: 3, name: post.title, item: url },
        ],
      },
      ...(post.faq?.length
        ? [{ "@type": "FAQPage", mainEntity: post.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }]
        : []),
    ],
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Navigation />

      <main className="mx-auto max-w-[760px] px-6 pb-24 pt-16 sm:px-10 sm:pt-24">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] font-medium text-white/50" style={MANROPE}>
          <Link href="/blog" className="inline-flex items-center gap-1.5 transition-colors hover:text-white"><ArrowLeft className="size-3.5" />Blog</Link>
          <span aria-hidden>/</span>
          <span className="truncate text-white/35">{post.category}</span>
        </nav>

        <p className="mt-6 text-[12.5px] font-semibold uppercase tracking-[0.18em] text-[#d7ff00]" style={MANROPE}>
          {post.category} · <time dateTime={post.date}>{formatDate(post.date)}</time> · {post.readMinutes} min read
        </p>
        <h1 className="mt-3 text-[clamp(1.8rem,4.4vw,2.6rem)] font-medium leading-[1.12] tracking-[-0.03em]" style={NEORIS}>{post.title}</h1>
        <p className="mt-4 text-[17px] font-light leading-relaxed text-white/65" style={MANROPE}>{post.description}</p>

        <img src={blogCoverPath(post.slug)} alt={post.title} width={1200} height={630} fetchPriority="high" className="mt-8 aspect-[1200/630] w-full rounded-2xl border border-white/10 object-cover" />

        <article className="mt-10 border-t border-white/[0.08] pt-10">
          {post.content.map((block, i) => (
            <BlogBlockView key={i} block={block} />
          ))}
        </article>

        {post.faq && post.faq.length > 0 && (
          <section aria-labelledby="faq" className="mt-14 border-t border-white/[0.08] pt-10">
            <h2 id="faq" className="text-[22px] font-medium tracking-[-0.02em]" style={NEORIS}>Frequently asked questions</h2>
            <div className="mt-5 divide-y divide-white/[0.08] rounded-xl border border-white/10 bg-white/[0.03]">
              {post.faq.map((f) => (
                <details key={f.q} className="group px-5 py-4">
                  <summary className="cursor-pointer list-none text-[15.5px] font-medium text-white marker:hidden" style={MANROPE}>{f.q}</summary>
                  <p className="mt-2 text-[14.5px] font-light leading-relaxed text-white/60" style={MANROPE}>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <div className="mt-14 flex flex-wrap items-center gap-3 rounded-2xl border border-[#d7ff00]/30 bg-[#d7ff00]/[0.06] p-6">
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-medium" style={NEORIS}>Make your own AI influencer on Solana</p>
            <p className="mt-1 text-[13.5px] font-light text-white/60" style={MANROPE}>Create a character, fund its wallet and post its first video in minutes.</p>
          </div>
          <Link href="/create" className="inline-flex items-center gap-2 rounded-full bg-[#d7ff00] px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[#e4ff59]">
            Get started <ArrowRight className="size-4" />
          </Link>
        </div>

        {related.length > 0 && (
          <section aria-labelledby="related" className="mt-16">
            <h2 id="related" className="text-[20px] font-medium tracking-[-0.02em]" style={NEORIS}>Keep reading</h2>
            <ul className="mt-5 grid gap-4 sm:grid-cols-3">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link href={`/blog/${r.slug}`} className="group block overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition-colors hover:border-white/25">
                    <img src={blogCoverPath(r.slug)} alt={r.title} width={1200} height={630} loading="lazy" decoding="async" className="aspect-[1200/630] w-full object-cover" />
                    <p className="p-3.5 text-[13.5px] font-medium leading-snug text-white/85 group-hover:text-white" style={MANROPE}>{r.title}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}

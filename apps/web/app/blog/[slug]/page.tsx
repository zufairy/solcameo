import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Navigation } from "@/components/cofounder/cofounder-landing";
import { Footer } from "@/components/cofounder/footer";
import { BlogBlockView } from "@/components/cofounder/blog-block";
import { BLOG_POSTS, getBlogPost } from "@/lib/blog-posts";
import { CANONICAL_SITE_URL, canonicalUrl } from "@/lib/seo";

const MANROPE = { fontFamily: "var(--font-manrope)" } as const;
const NEORIS = { fontFamily: "var(--font-neoris), sans-serif" } as const;

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: canonicalUrl(`/blog/${post.slug}`) },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: canonicalUrl(`/blog/${post.slug}`),
      publishedTime: post.date,
      images: [{ url: "/og-image.jpg", width: 1920, height: 1080, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: ["/og-image.jpg"],
    },
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: { "@type": "Organization", name: "Vello" },
    publisher: { "@type": "Organization", name: "Vello", url: CANONICAL_SITE_URL },
    mainEntityOfPage: canonicalUrl(`/blog/${post.slug}`),
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Navigation />

      <main className="mx-auto max-w-[720px] px-6 pb-24 pt-16 sm:px-10 sm:pt-24">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white/50 transition-colors hover:text-white"
          style={MANROPE}
        >
          <ArrowLeft className="size-3.5" />
          Blog
        </Link>

        <p className="mt-6 text-[12.5px] font-medium uppercase tracking-[0.18em] text-white/40" style={MANROPE}>
          {formatDate(post.date)} · {post.readMinutes} min read
        </p>
        <h1 className="mt-3 text-[clamp(1.7rem,4.2vw,2.4rem)] font-medium leading-[1.15] tracking-[-0.03em]" style={NEORIS}>
          {post.title}
        </h1>
        <p className="mt-4 text-[16px] font-light leading-relaxed text-white/60" style={MANROPE}>
          {post.description}
        </p>

        <article className="mt-12 border-t border-white/[0.08] pt-10">
          {post.content.map((block, i) => (
            <BlogBlockView key={i} block={block} />
          ))}
        </article>

        <div className="mt-16 flex flex-wrap items-center gap-3 border-t border-white/[0.08] pt-10">
          <Link
            href="/builder"
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            Start a clipping campaign
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}

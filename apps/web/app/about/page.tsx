import type { Metadata } from "next";
import Link from "next/link";
import { CANONICAL_SITE_URL, SITE_ALTERNATE_NAMES, SITE_NAME, SOCIAL_LINKS, canonicalUrl } from "@/lib/seo";

/* /about — the brand-entity page. People search plain "vello", which is a
   crowded name (a 2D renderer, a vet-software product, a bike maker…), so this
   page states plainly who Vello Agents is, every name we go by, and what we're
   NOT — the disambiguation Google uses to tie the "vello" query to this site.
   Backed by AboutPage + Organization + FAQPage structured data. */

const TITLE = "About Vello: The Company Behind Vello Agents";
const DESCRIPTION =
  "Vello (Vello Agents, velloagents.com) builds AI agents that turn long videos into daily shorts and run creator channels on autopilot. Who we are and what we make.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: ["Vello", "Vello Agents", "VelloAgents", "velloagents.com", "vello.gg", "about Vello", "what is Vello"],
  alternates: { canonical: canonicalUrl("/about") },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: canonicalUrl("/about"),
    images: [{ url: "/og-image.jpg", width: 1920, height: 1080, alt: "About Vello Agents" }],
  },
};

const PRODUCTS = [
  { name: "Shorts Agent", href: "/clipping", body: "Paste a long video. Vello finds the best moments, frames the speaker, adds captions and posts vertical shorts to TikTok, Reels and YouTube Shorts every day." },
  { name: "AI Influencers", href: "/ai-influencer", body: "Describe a creator. Vello builds the persona, face and voice, then films and posts short videos on its own schedule." },
  { name: "Marketplace", href: "/agents", body: "Hire agents other people have built to make content for your brand, or list your own." },
  { name: "Campaigns", href: "/docs", body: "Brands fund a campaign; agents post; Vello pays out per verified view in USDC on Solana." },
];

const FAQ = [
  {
    q: "What is Vello?",
    a: "Vello, also called Vello Agents, is a platform at velloagents.com for AI agents that make and post short-form video: a Shorts Agent that clips long videos into daily shorts, and AI influencers that run a creator channel on autopilot.",
  },
  {
    q: "Are Vello, Vello Agents and vello.gg the same?",
    a: "Yes. Vello, Vello Agents and VelloAgents are one company and one product. vello.gg is our earlier domain and redirects to velloagents.com.",
  },
  {
    q: "Is Vello Agents related to the Vello 2D renderer, IDEXX Vello or VELLO Bike?",
    a: "No. Those are separate, unrelated projects that share the name. Vello Agents is the AI video-agent platform at velloagents.com.",
  },
  {
    q: "How much does Vello cost?",
    a: "Your first 3 videos are free when you sign up. Paid plans are listed on the pricing page at velloagents.com/pricing.",
  },
  {
    q: "Which platforms does Vello post to?",
    a: "TikTok, Instagram Reels, YouTube Shorts, X and Facebook, from one connected account per agent.",
  },
];

export default function AboutPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "AboutPage",
        "@id": `${canonicalUrl("/about")}#page`,
        url: canonicalUrl("/about"),
        name: TITLE,
        description: DESCRIPTION,
        about: { "@id": `${CANONICAL_SITE_URL}/#organization` },
        isPartOf: { "@id": `${CANONICAL_SITE_URL}/#website` },
      },
      {
        "@type": "Organization",
        "@id": `${CANONICAL_SITE_URL}/#organization`,
        name: SITE_NAME,
        alternateName: SITE_ALTERNATE_NAMES,
        url: CANONICAL_SITE_URL,
        logo: `${CANONICAL_SITE_URL}/vellosquare-hd.png`,
        description: DESCRIPTION,
        sameAs: SOCIAL_LINKS,
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ],
  };

  return (
    <main className="min-h-screen bg-[#08080a] text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-20 sm:pt-28">
        <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/45">About</p>
        <h1 className="mt-3 text-[36px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[48px]">
          Vello builds AI agents that make and post short-form video.
        </h1>
        <p className="mt-5 text-[17px] leading-relaxed text-white/60">
          Vello — also known as <strong className="font-semibold text-white/85">Vello Agents</strong> — lives at{" "}
          <Link href="/" className="text-white underline decoration-white/25 underline-offset-4">velloagents.com</Link>.
          Our agents turn long videos into daily shorts, run AI influencer channels, and post to every platform
          without anyone opening an editor.
        </p>

        <section className="mt-14">
          <h2 className="text-[22px] font-semibold">What Vello makes</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {PRODUCTS.map((p) => (
              <Link
                key={p.name}
                href={p.href}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.05]"
              >
                <h3 className="text-[16px] font-semibold">Vello {p.name}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-white/55">{p.body}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-[22px] font-semibold">Names you may know us by</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-white/60">
            Vello, Vello Agents, VelloAgents and vello.gg are all us. vello.gg was our first domain and now redirects
            here. Find us on{" "}
            <a href="https://x.com/velloagents" rel="me noopener" target="_blank" className="text-white underline decoration-white/25 underline-offset-4">X</a>{" "}
            and{" "}
            <a href="https://www.linkedin.com/company/velloagents" rel="me noopener" target="_blank" className="text-white underline decoration-white/25 underline-offset-4">LinkedIn</a>.
          </p>
        </section>

        <section className="mt-14">
          <h2 className="text-[22px] font-semibold">Questions about Vello</h2>
          <dl className="mt-5 divide-y divide-white/[0.08] border-y border-white/[0.08]">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="py-5">
                <dt className="text-[15.5px] font-medium text-white">{q}</dt>
                <dd className="mt-2 text-[14.5px] leading-relaxed text-white/55">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-14 flex flex-wrap gap-3">
          <Link href="/builder" className="rounded-lg bg-white px-5 py-3 text-[14px] font-semibold text-black transition-opacity hover:opacity-90">
            Try Vello free
          </Link>
          <Link href="/pricing" className="rounded-lg border border-white/15 px-5 py-3 text-[14px] font-medium text-white/80 transition-colors hover:bg-white/[0.06]">
            See pricing
          </Link>
        </div>
      </div>
    </main>
  );
}

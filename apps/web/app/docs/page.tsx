import type { Metadata } from "next";
import { DocsShell, DocVisual, Section, Bullets, Steps, Note, DocLink } from "@/components/docs/docs-shell";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Docs: Launch an AI Character With Its Own Coin | Solcameo",
  description:
    "The Solcameo handbook: create an AI influencer, launch its coin on a Meteora bonding curve, let fans steer the story in chat, and grow it with callouts and the leaderboard.",
  keywords: ["Solcameo docs", "launch AI character coin", "Meteora bonding curve", "AI influencer on Solana"],
  alternates: { canonical: canonicalUrl("/docs") },
  openGraph: {
    title: "Docs | Solcameo",
    description: "Create an AI influencer, launch its coin, and grow its community on Solana.",
    url: canonicalUrl("/docs"),
    images: [{ url: "/og-image.jpg", width: 1920, height: 1080, alt: "Solcameo Docs" }],
  },
};

export default function DocsOverviewPage() {
  return (
    <DocsShell
      slug=""
      lead={
        <>
          <p>
            Solcameo lets you launch an AI character with its own coin. You describe who it is, it gets
            a face and a persistent identity, and it launches on Solana with a Meteora bonding-curve coin.
            Its community talks to it in public chat, and the character turns their ideas into its next video.
          </p>
          <p>
            This handbook takes you from an empty account to a live influencer with a trading coin and a
            community. Read it in order, or jump to the stage you are on from the chapters on the left.
          </p>
        </>
      }
      figure={<DocVisual kind="hero" caption="One sentence in. A character, a coin and a community out." />}
    >
      <Section id="welcome" kicker="Start here" title="Introduction">
        <p>
          An <span className="font-medium text-neutral-900">AI influencer</span> on Solcameo is a character with a
          fixed look, a personality and a story. Its look is generated once and stays locked across every
          video, so the character is recognisable from one chapter to the next.
        </p>
        <p>
          Each influencer has its own coin. Holders and fans gather around it, and the community decides where the
          story goes next.
        </p>
      </Section>

      <Section id="what-is-solcameo" kicker="The concept" title="What is Solcameo?">
        <p>Three things are connected:</p>
        <Bullets
          items={[
            ["The character", "created in the builder from a sentence or reference images. It keeps one identity in chat and in video."],
            ["The coin", "launched on Solana through Meteora's Dynamic Bonding Curve. Fixed supply, mint authority revoked, and a locked liquidity pool after graduation."],
            ["The community", "holders and fans talk in the character's public market chat. The character reads the room and proposes the next scene."],
          ]}
        />
        <p>
          A small fee on every trade is split between the creator, the character&apos;s content budget, the platform and
          Meteora. The content share pays for the next videos. See{" "}
          <DocLink href="/docs/launch#fees">Where fees go</DocLink>.
        </p>
      </Section>

      <Section id="the-journey" kicker="The path" title="The four stages">
        <p>The docs follow the path every creator takes:</p>
        <Steps
          items={[
            <><DocLink href="/docs/start">Start</DocLink>: sign in, get a wallet and add a little SOL.</>,
            <><DocLink href="/docs/build">Create</DocLink>: design the character and make its first videos in the builder.</>,
            <><DocLink href="/docs/launch">Launch</DocLink>: name the coin, approve the launch in your wallet and open trading.</>,
            <><DocLink href="/docs/grow">Grow</DocLink>: use the market page, community chat, callouts and the leaderboard.</>,
          ]}
        />
      </Section>

      <Section id="prerequisites" kicker="Checklist" title="Before you start">
        <p>You only need two things:</p>
        <Bullets
          items={[
            ["A Solcameo account", "sign in with Google or a Solana wallet. Covered in Getting started."],
            ["A little SOL", "to cover the launch transactions. Solcameo currently runs on Solana devnet, where test SOL is free."],
          ]}
        />
        <Note>
          New to wallets? Sign in with Google and Solcameo creates an embedded Solana wallet for you. See{" "}
          <DocLink href="/docs/start#wallet">Your wallet</DocLink>.
        </Note>
      </Section>

      <Section id="using-these-docs" kicker="How to read" title="Using these docs">
        <p>
          The left rail is the table of contents. The chapter you are reading expands into its sections, the active
          section lights up as you scroll, and the bar on the right shows how far through the page you are.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 border-t border-black/[0.07] pt-8">
          <a href="/docs/start" className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800">Start the guide</a>
          <a href="/create" className="rounded-lg border border-black/[0.09] bg-white px-5 py-2.5 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50">Launch a character</a>
        </div>
      </Section>
    </DocsShell>
  );
}

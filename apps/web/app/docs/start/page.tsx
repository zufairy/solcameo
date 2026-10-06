import type { Metadata } from "next";
import { DocsShell, DocVisual, Section, Bullets, Steps, Note, DocLink } from "@/components/docs/docs-shell";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Getting Started With Solcameo",
  description: "Sign in to Solcameo, get a Solana wallet, add SOL and look around the market before you launch your first AI character.",
  keywords: ["Solcameo getting started", "Solana wallet setup", "Privy sign in", "devnet SOL"],
  alternates: { canonical: canonicalUrl("/docs/start") },
};

export default function StartPage() {
  return (
    <DocsShell
      slug="start"
      lead={
        <>
          <p>Getting started takes a few minutes: sign in, get a wallet, add a little SOL. After that you can build and launch.</p>
          <p>You do not need a Solana wallet in advance. Solcameo can create one for you.</p>
        </>
      }
      figure={<DocVisual kind="start" caption="Four quick steps before your first character." />}
    >
      <Section id="intro" kicker="Overview" title="Introduction">
        <p>
          Your account is your identity on Solcameo, and your wallet is how you approve launches, trade coins and
          receive earnings. The two are linked, so you only sign in once.
        </p>
      </Section>

      <Section id="sign-in" kicker="Step 1" title="Sign in">
        <p>Solcameo uses Privy, so there are two ways in:</p>
        <Bullets
          items={[
            ["Google", "the fastest path. Solcameo creates an embedded Solana wallet for you behind the scenes."],
            ["Solana wallet", "connect Phantom, Solflare or another wallet and sign a message. No email needed."],
          ]}
        />
        <Steps
          items={[
            <>Click <span className="font-medium text-neutral-900">Sign in</span> at the top right of any page.</>,
            <>Choose Google or your wallet.</>,
            <>Approve the prompt. You are signed in and your balance appears in the header.</>,
          ]}
        />
      </Section>

      <Section id="wallet" kicker="Step 2" title="Your wallet">
        <p>
          The balance in the header opens your wallet panel: your balance, your address (tap to copy), the wallet you
          are connected with, and tabs to send SOL or see recent activity. Your profile page also shows the connected
          address and when you joined.
        </p>
        <Bullets
          items={[
            ["Embedded wallet", "created for you when you sign in with Google. Nothing to install."],
            ["External wallet", "link Phantom or another wallet from the account menu. You can link more than one."],
            ["What it is for", "approving a coin launch, buying and selling coins, and receiving creator fees."],
          ]}
        />
        <Note>
          You approve every on-chain action in your own wallet. Solcameo never holds your keys.
        </Note>
      </Section>

      <Section id="deposit" kicker="Step 3" title="Add SOL">
        <p>
          Press <span className="font-medium text-neutral-900">Deposit</span> in the header. It shows your wallet address:
          send SOL there from any wallet or exchange and your balance updates on its own.
        </p>
        <Bullets
          items={[
            ["On devnet", "use the “Get 1 devnet SOL” button for free test SOL. Devnet SOL has no monetary value."],
            ["On mainnet", "buy SOL with a card from the same dialog."],
          ]}
        />
      </Section>

      <Section id="explore-first" kicker="Step 4" title="Look around first">
        <p>It helps to see what a finished character looks like before you make one:</p>
        <Bullets
          items={[
            ["Market", "every live coin with its market cap, change since launch, holders and videos. Open one to see its chart and chat."],
            ["Explore", "a library of motion references you can put your own character into."],
            ["Leaderboards", "the top influencers ranked by earnings and views."],
          ]}
        />
        <p>
          Ready? Continue to <DocLink href="/docs/build">Create your influencer</DocLink>.
        </p>
      </Section>
    </DocsShell>
  );
}

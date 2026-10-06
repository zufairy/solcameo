import type { Metadata } from "next";
import { DocsShell, DocVisual, Section, Bullets, Steps, Note, DocLink } from "@/components/docs/docs-shell";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Launch Your Character's Coin | Solcameo Docs",
  description: "How a Solcameo character coin launches on a Meteora Dynamic Bonding Curve: two wallet approvals, fixed supply, locked liquidity after graduation and the fee split.",
  keywords: ["Meteora Dynamic Bonding Curve", "launch coin on Solana", "bonding curve graduation", "Solcameo coin"],
  alternates: { canonical: canonicalUrl("/docs/launch") },
};

export default function LaunchPage() {
  return (
    <DocsShell
      slug="launch"
      lead={
        <>
          <p>
            Launching gives your character a coin that anyone can trade. It runs on Meteora&apos;s Dynamic Bonding Curve, so
            there is a price from the first trade with no liquidity to seed yourself.
          </p>
        </>
      }
      figure={<DocVisual kind="launch" caption="Trades follow the curve until it graduates. Fees are split four ways." />}
    >
      <Section id="intro" kicker="Overview" title="Introduction">
        <p>
          You do not buy your own coin to launch it. The launch creates the token and its pool on Solana, and trading opens
          on the curve. Everything after that is just people buying and selling.
        </p>
      </Section>

      <Section id="coin-details" kicker="Step 1" title="Name and ticker">
        <p>
          After you save your character, the builder moves on to coin details. The character&apos;s name becomes its ticker,
          for example <span className="font-medium text-neutral-900">Luna becomes $LUNA</span>. Add a short description and, if
          you want, links to the character&apos;s X profile and website. The X link also powers the live feed on the market page.
        </p>
      </Section>

      <Section id="approve" kicker="Step 2" title="Approve the launch">
        <p>Press <span className="font-medium text-neutral-900">Launch</span> and approve two transactions in your wallet:</p>
        <Steps
          items={[
            <>Your <span className="font-medium text-neutral-900">curve configuration</span>.</>,
            <>Your <span className="font-medium text-neutral-900">token and pool</span>.</>,
          ]}
        />
        <p>
          SOL is only used for account rent and network fees. No token is bought for you. If an approval expires before it lands,
          Solcameo asks you to confirm the refreshed transaction.
        </p>
      </Section>

      <Section id="the-curve" kicker="How it trades" title="The bonding curve">
        <Bullets
          items={[
            ["Fixed supply", "each coin has a fixed supply of 1 billion tokens, and the mint authority is revoked, so no more can ever be minted."],
            ["Curve shapes", "the launch settings let you pick a curve shape (Classic, Steady, Rocket or Whale) and a trading fee tier."],
            ["Price", "the price rises as people buy and falls as they sell, along the curve, until the graduation target is reached."],
          ]}
        />
      </Section>

      <Section id="graduation" kicker="What happens next" title="Graduation">
        <p>
          When the curve reaches its graduation target, liquidity migrates into a Meteora DAMM v2 pool and that liquidity is
          permanently locked. On the market page, the Meteora DBC panel shows the SOL reserve against the target and a
          progress bar, read from the chain.
        </p>
      </Section>

      <Section id="fees" kicker="Economics" title="Where fees go">
        <p>A small fee on every trade is split four ways:</p>
        <Bullets
          items={[
            ["Creator, 40%", "paid to the character's creator."],
            ["Content budget, 20%", "funds the character's next videos."],
            ["Platform, 20%", "runs Solcameo operations."],
            ["Meteora, 20%", "the protocol's share on the curve."],
          ]}
        />
        <p>
          The Creator fees panel on the market page tracks collected fees and the split. The home page has a calculator that
          shows the split for an example trading volume.
        </p>
      </Section>

      <Section id="devnet-risk" kicker="Please read" title="Devnet and risk">
        <Note>
          Solcameo currently runs on Solana devnet. Devnet coins are for testing and have no monetary value, and dollar values
          shown there use the SOL spot rate for illustration only.
        </Note>
        <p>
          Coins carry risk. Prices can fall as well as rise, fees depend on real trading, and nothing here is a promise of
          returns. Only trade what you can afford to lose.
        </p>
        <p>
          Next: <DocLink href="/docs/grow">community, callouts and growth</DocLink>.
        </p>
      </Section>
    </DocsShell>
  );
}

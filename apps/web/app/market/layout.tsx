import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";
import { legacyUiEnabled } from "@/lib/flags";
import { BRAND } from "@/lib/solstar/brand";

const legacyMetadata: Metadata = {
  title: "Agent Market: Live Channels and Earnings",
  description:
    "Browse live Vello Agents, see their content, followers, and campaign earnings, and back the channels that are growing.",
  keywords: [
    "Vello Agents market",
    "content agent marketplace",
    "creator channel earnings",
    "agent economy",
  ],
  alternates: { canonical: canonicalUrl("/market") },
  openGraph: {
    title: "Agent Market | Vello Agents",
    description:
      "Browse live Vello Agents, see their content, followers, and campaign earnings, and back the channels that are growing.",
    url: canonicalUrl("/market"),
  },
};

const solstarDescription =
  "Simulated paper market of AI characters on Solana. Prices come from paper trades only, not on-chain.";

// NEXT_PUBLIC_LEGACY_UI is inlined at build time, so choosing at module load is safe.
export const metadata: Metadata = legacyUiEnabled()
  ? legacyMetadata
  : {
      title: `Market | ${BRAND.name}`,
      description: solstarDescription,
      alternates: { canonical: canonicalUrl("/market") },
      openGraph: {
        title: `Market | ${BRAND.name}`,
        description: solstarDescription,
        url: canonicalUrl("/market"),
      },
    };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

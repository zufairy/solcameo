import type { Metadata } from "next";
import { BRAND } from "@/lib/solstar/brand";
import { SolstarHome } from "@/components/solstar/SolstarHome";
import { legacyUiEnabled } from "@/lib/flags";
import { CofounderLanding } from "@/components/cofounder/cofounder-landing";
import { HOME_DESCRIPTION, HOME_KEYWORDS, HOME_TITLE, canonicalUrl } from "@/lib/seo";

const legacyMetadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  keywords: HOME_KEYWORDS,
  alternates: { canonical: canonicalUrl("/") },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: canonicalUrl("/"),
    images: [{ url: "/og-image.jpg", width: 1920, height: 1080, alt: "Vello Agents: long videos into viral shorts, posted daily" }],
  },
};

const SOLSTAR_TITLE = `${BRAND.name} — ${BRAND.tagline}`;
const SOLSTAR_DESCRIPTION = "Solana characters with recurring videos. Watching is free. Trading is optional and risky.";

const solstarMetadata: Metadata = {
  title: { absolute: SOLSTAR_TITLE },
  description: SOLSTAR_DESCRIPTION,
  alternates: { canonical: canonicalUrl("/") },
  openGraph: { title: SOLSTAR_TITLE, description: SOLSTAR_DESCRIPTION, url: canonicalUrl("/") },
};

export const metadata: Metadata = legacyUiEnabled() ? legacyMetadata : solstarMetadata;

export default function HomePage() {
  if (!legacyUiEnabled()) return <SolstarHome />;
  return <CofounderLanding />;
}

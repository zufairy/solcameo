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
    images: [{ url: "/og-image.jpg", width: 1920, height: 1080, alt: "Solcameo AI influencers" }],
  },
};

const SOLSTAR_TITLE = HOME_TITLE;
const SOLSTAR_DESCRIPTION = HOME_DESCRIPTION;

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

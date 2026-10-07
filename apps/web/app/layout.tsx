import type { Metadata } from "next";
import { burnFontFaceCss } from "@/lib/builder/burnFonts";
import Script from "next/script";
import { geistSans, geistMono, spaceGrotesk, inter, newsreader, manrope } from "@/lib/siteFonts";
import "./globals.css";
import { ShellGate } from "@/components/layout/shell-gate";
import { ThemeProvider, THEME_NO_FLASH_SCRIPT } from "@/providers/theme-provider";
import { SolanaWalletProvider } from "@/providers/wallet-provider";
import { ConvexClientProvider } from "@/providers/convex-provider";
import { AgentFundingGate } from "@/components/builder/AgentFundingGate";
import { SupabaseAuthProvider } from "@/providers/supabase-auth-provider";
import { ErrorBoundary } from "@/components/error/error-boundary";
import {
  CANONICAL_SITE_URL,
  HOME_DESCRIPTION,
  HOME_KEYWORDS,
  HOME_TITLE,
  SITE_NAME,
  SITE_ALTERNATE_NAMES,
  SOCIAL_LINKS,
  GOOGLE_SITE_VERIFICATION,
  PRODUCT_INFLUENCER,
  SITE_NAV,
  canonicalUrl,
} from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_SITE_URL),
  title: {
    default: HOME_TITLE,
    template: "%s | Solcameo",
  },
  description: HOME_DESCRIPTION,
  applicationName: "Solcameo",
  category: "technology",
  keywords: HOME_KEYWORDS,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: "/og-solcameo.jpg",
        width: 1600,
        height: 900,
        alt: "Solcameo AI influencers and token launchpad on Solana",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    images: ["/og-solcameo.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  // Google Search Console ownership proof — renders the
  // google-site-verification meta tag on every page.
  verification: { google: GOOGLE_SITE_VERIFICATION },
  // Favicon + app icons are served via Next's file conventions:
  //   app/favicon.ico   → classic favicon (/favicon.ico, multi-size 16/32/48)
  //   app/icon.png      → modern PNG icon (192×192 — a multiple of 48 as Google requires;
  //                       light-green gradient tile with the dark Vello mark centred)
  //   app/apple-icon.png → iOS home-screen icon (180×180)
  // No explicit `icons` config here — it would override the file conventions.
};

// Structured data — tells Google exactly what Vello is. Organization +
// WebSite + SoftwareApplication cover the brand panel, sitelinks, and app
// rich results respectively.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${CANONICAL_SITE_URL}/#organization`,
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAMES,
      url: CANONICAL_SITE_URL,
      logo: `${CANONICAL_SITE_URL}/brand/solcameo-mark.png`,
      description: HOME_DESCRIPTION,
      // sameAs ties the official social profiles to this domain — the single
      // strongest signal Google uses to disambiguate "Vello" the brand entity.
      sameAs: SOCIAL_LINKS,
    },
    {
      "@type": "WebSite",
      "@id": `${CANONICAL_SITE_URL}/#website`,
      url: CANONICAL_SITE_URL,
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAMES,
      publisher: { "@id": `${CANONICAL_SITE_URL}/#organization` },
    },
    // Two distinct products under the one brand — Google reads these as the
    // "what does Vello make" answer for the brand panel.
    {
      "@type": "SoftwareApplication",
      name: PRODUCT_INFLUENCER.name,
      url: canonicalUrl(PRODUCT_INFLUENCER.path),
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: PRODUCT_INFLUENCER.description,
      publisher: { "@id": `${CANONICAL_SITE_URL}/#organization` },
    },
    // Site menu — one SiteNavigationElement ItemList; a signal Google can use
    // when picking sitelinks for the brand result.
    {
      "@type": "ItemList",
      "@id": `${CANONICAL_SITE_URL}/#sitenav`,
      itemListElement: SITE_NAV.map((item, i) => ({
        "@type": "SiteNavigationElement",
        position: i + 1,
        name: item.name,
        url: canonicalUrl(item.path),
      })),
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Theme no-flash — sets the light/dark class from localStorage BEFORE first
            paint so a light-preference reload never flashes dark. Must run first. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }} />
        <script
          type="application/ld+json"
          // Static, server-rendered structured data — no user input flows in.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {/* Bundled caption/hook burn fonts under their exact libass family names —
            previews render the same .ttf the export burns. Faces load lazily
            (only when some text actually uses the family). */}
        <style dangerouslySetInnerHTML={{ __html: burnFontFaceCss() }} />
        {/* Google tag (gtag.js) — Analytics for every page. Rendered once here
            in the root layout; do NOT add it anywhere else. */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-F386L3N3JH"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-F386L3N3JH');
          `}
        </Script>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${inter.variable} ${newsreader.variable} ${manrope.variable} antialiased bg-background text-foreground`}
      >
        <ErrorBoundary>
          <ThemeProvider>
            <ConvexClientProvider>
              <SupabaseAuthProvider>
                <SolanaWalletProvider>
                  {/* overflow-x-clip (NOT overflow-x-hidden) — `hidden` on only the
                      x-axis makes the CSS overflow computed-value pairing rule force
                      overflow-y to `auto` too ("if one axis is non-visible, the other
                      computes to auto instead of visible"), which silently turns this
                      div into the page's REAL scroll container instead of the window.
                      That broke every scroll-linked effect that assumes `window`
                      scrolls (framer-motion's useScroll() with no explicit `container`
                      listens to window scroll events, which then never fire) — CSS
                      `position: sticky` still worked (it scopes to whichever ancestor
                      is the real scroll container, so headers/pinned sections looked
                      fine), but any JS scroll-progress tracking silently stayed stuck
                      at its initial value. `clip` prevents horizontal overflow the same
                      as `hidden` without joining that visible/auto pairing rule. */}
                  <div className="flex min-h-screen flex-col overflow-x-clip">
                    <ShellGate>{children}</ShellGate>
                  </div>
                  <ErrorBoundary fallback={null}><AgentFundingGate /></ErrorBoundary>
                </SolanaWalletProvider>
              </SupabaseAuthProvider>
            </ConvexClientProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}

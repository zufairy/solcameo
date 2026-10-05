import localFont from "next/font/local";

// Checked-in fonts keep production builds independent of Google Fonts responses.
// Preserve the existing CSS variables so every page keeps its typography.
export const geistSans = localFont({
  src: [
    {
      path: "../assets/fonts/site/geist/Geist[wght].woff",
      weight: "100 900",
      style: "normal"
    }
  ],
  variable: "--font-geist-sans",
  display: "swap",
  fallback: [
    "Arial",
    "sans-serif"
  ],
  adjustFontFallback: "Arial"
});

export const geistMono = localFont({
  src: [
    {
      path: "../assets/fonts/site/geistmono/GeistMono[wght].woff",
      weight: "100 900",
      style: "normal"
    }
  ],
  variable: "--font-geist-mono",
  display: "swap",
  fallback: [
    "Arial",
    "sans-serif"
  ],
  adjustFontFallback: "Arial"
});

export const spaceGrotesk = localFont({
  src: [
    {
      path: "../assets/fonts/site/spacegrotesk/SpaceGrotesk[wght].woff",
      weight: "300 700",
      style: "normal"
    }
  ],
  variable: "--font-space",
  display: "swap",
  fallback: [
    "Arial",
    "sans-serif"
  ],
  adjustFontFallback: "Arial"
});

export const inter = localFont({
  src: [
    {
      path: "../assets/fonts/site/inter/Inter[opsz,wght].woff",
      weight: "100 900",
      style: "normal"
    }
  ],
  variable: "--font-inter",
  display: "swap",
  fallback: [
    "Arial",
    "sans-serif"
  ],
  adjustFontFallback: "Arial"
});

export const newsreader = localFont({
  src: [
    {
      path: "../assets/fonts/site/newsreader/Newsreader[opsz,wght].woff",
      weight: "200 800",
      style: "normal"
    },
    {
      path: "../assets/fonts/site/newsreader/Newsreader-Italic[opsz,wght].woff",
      weight: "200 800",
      style: "italic"
    }
  ],
  variable: "--font-newsreader",
  display: "swap",
  fallback: [
    "Times New Roman",
    "serif"
  ],
  adjustFontFallback: "Times New Roman"
});

export const manrope = localFont({
  src: [
    {
      path: "../assets/fonts/site/manrope/Manrope[wght].woff",
      weight: "200 800",
      style: "normal"
    }
  ],
  variable: "--font-manrope",
  display: "swap",
  fallback: [
    "Arial",
    "sans-serif"
  ],
  adjustFontFallback: "Arial"
});

export const jbMono = localFont({
  src: [
    {
      path: "../assets/fonts/site/jetbrainsmono/JetBrainsMono[wght].woff",
      weight: "100 800",
      style: "normal"
    }
  ],
  variable: "--font-jbmono",
  display: "swap",
  fallback: [
    "Arial",
    "sans-serif"
  ],
  adjustFontFallback: "Arial"
});

export const nodeDisplay = localFont({
  src: [
    {
      path: "../assets/fonts/site/cormorantsc/CormorantSC-Bold.woff",
      weight: "700",
      style: "normal"
    },
    {
      path: "../assets/fonts/site/cormorantsc/CormorantSC-Medium.woff",
      weight: "500",
      style: "normal"
    },
    {
      path: "../assets/fonts/site/cormorantsc/CormorantSC-Regular.woff",
      weight: "400",
      style: "normal"
    },
    {
      path: "../assets/fonts/site/cormorantsc/CormorantSC-SemiBold.woff",
      weight: "600",
      style: "normal"
    }
  ],
  variable: "--font-node-display",
  display: "swap",
  fallback: [
    "Times New Roman",
    "serif"
  ],
  adjustFontFallback: "Times New Roman"
});

export const nodeLabel = localFont({
  src: [
    {
      path: "../assets/fonts/site/cinzel/Cinzel[wght].woff",
      weight: "400 900",
      style: "normal"
    }
  ],
  variable: "--font-node-label",
  display: "swap",
  fallback: [
    "Times New Roman",
    "serif"
  ],
  adjustFontFallback: "Times New Roman"
});

export const nodeBody = localFont({
  src: [
    {
      path: "../assets/fonts/site/cormorantgaramond/CormorantGaramond[wght].woff",
      weight: "300 700",
      style: "normal"
    },
    {
      path: "../assets/fonts/site/cormorantgaramond/CormorantGaramond-Italic[wght].woff",
      weight: "300 700",
      style: "italic"
    }
  ],
  variable: "--font-node-body",
  display: "swap",
  fallback: [
    "Times New Roman",
    "serif"
  ],
  adjustFontFallback: "Times New Roman"
});

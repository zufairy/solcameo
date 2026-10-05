import localFont from "next/font/local";

/** Condensed display face for the How it works page headings. */
export const displayFont = localFont({
  src: [{ path: "../../../assets/fonts/BarlowCondensed-Bold.ttf", weight: "700", style: "normal" }],
  variable: "--font-how-display",
  display: "swap",
  fallback: ["Arial Narrow", "Arial", "sans-serif"],
});

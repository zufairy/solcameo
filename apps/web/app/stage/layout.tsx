import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Campaigns: Pay Per Verified View",
  description:
    "Post a content campaign with a reward pool and a rate per 1,000 verified views. Vello Agents flood TikTok, Reels, Shorts, and X with content about your brand.",
  keywords: [
    "pay per view campaigns",
    "clipping campaigns",
    "performance content marketing",
    "content bounty platform",
  ],
  alternates: { canonical: canonicalUrl("/stage") },
  openGraph: {
    title: "Campaigns | Vello Agents",
    description:
      "Post a content campaign with a reward pool and a rate per 1,000 verified views. Vello Agents flood TikTok, Reels, Shorts, and X with content about your brand.",
    url: canonicalUrl("/stage"),
  },
};

// `modal` is the @modal parallel-route slot (app/stage/@modal/) — intercepted
// campaign/reward detail navigations open there as an overlay on top of the
// grid instead of replacing the page, so a card click "stays" on /stage.
// LayoutProps<'/stage'> is the generated helper that types it from the
// directory structure (see next typegen / `next dev`).
export default function Layout({ children, modal }: LayoutProps<"/stage">) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}

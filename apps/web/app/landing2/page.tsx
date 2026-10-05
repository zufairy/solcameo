import type { Metadata } from "next";
import { jbMono } from "@/lib/siteFonts";
import {
  Navigation, Hero, Integrations, Capabilities, Citizens, ThreeDoors, CreatorTypes, ActivityFeed, Manifesto, Footer,
} from "@/components/mach/sections";


export const metadata: Metadata = {
  title: { absolute: "Solcameo | The AI Influencer Network" },
  description:
    "Vello is the AI influencer network. Launch an AI influencer with its own face, persona, and memory in minutes — it creates short videos, posts daily, takes brand campaign bounties, and earns for you. Brands pay only for verified views.",
  // Secondary presentation of the homepage — keep it out of the index so it
  // doesn't compete with `/` for the same terms.
  robots: { index: false, follow: true },
  openGraph: {
    title: "Solcameo | The AI Influencer Network",
    description:
      "The AI influencer network: launch AI creators that post daily and earn, or post a brand bounty and pay only for verified views.",
    images: [{ url: "/og-image.jpg", width: 1920, height: 1080, alt: "Solcameo AI agents that earn for you" }],
  },
};

export default function VelloLanding2Page() {
  return (
    <main
      className={`${jbMono.variable} relative min-h-screen bg-[#0a0a0f] text-white antialiased`}
      style={{ fontFamily: "var(--font-inter)" }}
    >
      {/* Shared cinematic background — the hero's atmosphere extended behind every
          section, fixed so it stays as you scroll. Sections are transparent. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0f]">
        <div className="absolute inset-0 [background:radial-gradient(55%_45%_at_50%_0%,rgba(0,255,209,0.07),transparent_60%),radial-gradient(50%_55%_at_85%_25%,rgba(124,77,255,0.10),transparent_60%),radial-gradient(55%_55%_at_12%_70%,rgba(0,120,255,0.09),transparent_60%),radial-gradient(60%_50%_at_50%_100%,rgba(124,77,255,0.08),transparent_60%)]" />
        <div className="city-grid absolute inset-0 opacity-40" />
      </div>

      <div className="relative z-10">
        <Navigation />
        <Hero />
        <Integrations />
        <Capabilities />
        <Citizens />
        <ThreeDoors />
        <CreatorTypes />
        <ActivityFeed />
        <Manifesto />
        <Footer />
      </div>
    </main>
  );
}

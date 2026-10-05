"use client";

import {
  AiEditorSection,
  FinalCta,
  Hero,
  HowItWorks,
  HowItWorksScroll,
  Navigation,
  SocialProof,
} from "./cofounder-landing";
import { HeroCarousel } from "./hero-video-carousel";
import { AnnouncementBar } from "./announcement-bar";
import { Footer } from "./footer";
import LiveChatWidget from "@/components/support/LiveChatWidget";

/* ── /clipping — the AI Clipping product page ────────────────────────────────
   The clipping-deep story that used to crowd the homepage lives here: the
   drop-a-link hero (clipping-specific copy), the edit-style bento, the
   step-by-step scroll timeline, and the AI editor — all reused straight from
   cofounder-landing so both pages stay in sync, closed by the same
   registration CTA. */
export function ClippingLanding() {
  return (
    <main className="relative bg-[#f4f3ef] text-neutral-900 antialiased">
      <AnnouncementBar />
      <Navigation />

      <section className="relative overflow-hidden bg-black text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[60vh] [background:radial-gradient(60%_60%_at_50%_0%,rgba(255,255,255,0.07),transparent_70%)]"
        />
        <Hero
          eyebrow="Shorts Agent"
          title="Drop a video. Watch it edit & post hundreds."
          sub="The AI editor finds your best moments, cuts them into clips, and posts them everywhere. First 3 videos free."
        />
        <HeroCarousel />
      </section>

      <SocialProof />

      {/* The editor — black-on-black straight after social proof (its own
          pt-0 is designed to continue a black section above it). */}
      <AiEditorSection />

      {/* Edit-style bento — what the output actually looks like. */}
      <HowItWorks />

      {/* Step-by-step scroll timeline. */}
      <HowItWorksScroll />

      <FinalCta />

      <Footer />
      <LiveChatWidget />
    </main>
  );
}

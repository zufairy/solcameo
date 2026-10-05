"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { AudioLines, Captions, Scissors, Share2 } from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { AuthForm } from "@/components/auth/auth-form";
import velloLogo from "@/assets/lo.png";

// Slide-up + blur-in stagger for the form column's contents on first paint —
// each child rises 14px and sharpens from a soft blur, staggered 60ms apart.
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: EASE_OUT } },
};

// Same real capabilities already sold on the landing page (CAPABILITIES in
// cofounder-landing.tsx) — not new claims, just reused here for the brief.
const BRIEF_FEATURES = [
  { label: "AI clipping, auto-posted everywhere", Icon: Scissors },
  { label: "Word-synced captions on every clip", Icon: Captions },
  { label: "Trending audio, or your own track", Icon: AudioLines },
  { label: "Publishes straight to TikTok, IG, YouTube, X", Icon: Share2 },
] as const;
// Same real case-study numbers already published on the landing page (CASES
// in case-studies.tsx) — reused, not new figures.
const BRIEF_STATS = [
  { value: "$30K/mo", label: "Cliphauz, AI clipping agency" },
  { value: "10,000", label: "JobTepi launch, first 7 days" },
] as const;

/** Animated abstract backdrop — layered blurred green blobs drifting on slow,
 *  staggered CSS keyframe loops (no JS animation loop) over a near-black
 *  field, plus a faint grid for texture. Used behind both page columns. */
function AnimatedBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden bg-[#07080a]">
      <style>{`
        @keyframes loginBlobA { 0%,100% { transform: translate(-8%,-8%) scale(1) rotate(0deg); } 50% { transform: translate(10%,6%) scale(1.2) rotate(20deg); } }
        @keyframes loginBlobB { 0%,100% { transform: translate(6%,4%) scale(1) rotate(0deg); } 50% { transform: translate(-12%,-6%) scale(1.15) rotate(-15deg); } }
        @keyframes loginBlobC { 0%,100% { transform: translate(0%,0%) scale(1); } 50% { transform: translate(-8%,10%) scale(1.25); } }
        @keyframes loginDrift { 0% { background-position: 0 0; } 100% { background-position: 120px 120px; } }
        .login-blob-a { animation: loginBlobA 18s ease-in-out infinite; }
        .login-blob-b { animation: loginBlobB 22s ease-in-out infinite; }
        .login-blob-c { animation: loginBlobC 26s ease-in-out infinite; }
        .login-grid { animation: loginDrift 40s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .login-blob-a, .login-blob-b, .login-blob-c, .login-grid { animation: none; }
        }
      `}</style>
      {/* Faint drifting grid for texture, masked to a soft vignette so it never fights the form. */}
      <div
        className="login-grid absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(190,242,100,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(190,242,100,0.6)_1px,transparent_1px)] [background-size:60px_60px] [mask-image:radial-gradient(80%_80%_at_50%_40%,#000_40%,transparent_100%)]"
      />
      <div className="login-blob-a absolute -left-[15%] -top-[20%] size-[60vw] rounded-full bg-[radial-gradient(circle_at_center,rgba(132,204,22,0.5),transparent_70%)] blur-[110px]" />
      <div className="login-blob-b absolute -bottom-[25%] -right-[15%] size-[65vw] rounded-full bg-[radial-gradient(circle_at_center,rgba(20,83,45,0.65),transparent_70%)] blur-[110px]" />
      <div className="login-blob-c absolute left-[35%] top-[30%] size-[38vw] rounded-full bg-[radial-gradient(circle_at_center,rgba(190,242,100,0.35),transparent_70%)] blur-[100px]" />
      {/* Edge vignette so the outer corners stay near-black and readable. */}
      <div className="absolute inset-0 [background:radial-gradient(120%_120%_at_50%_50%,transparent_35%,rgba(7,8,10,0.75)_100%)]" />
    </div>
  );
}

/** Left column — the "professional login" brief: logo, pitch, real feature
 *  list, and two real case-study numbers. Hidden below lg (form-only on
 *  mobile/tablet, matching the classic split-screen SaaS login pattern). */
function BriefPanel() {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="relative z-10 hidden flex-col justify-between px-14 py-16 lg:flex"
    >
      <motion.div variants={item}>
        <Link href="/" aria-label="Vello">
          <Image src={velloLogo} alt="Vello" className="h-8 w-auto object-contain" />
        </Link>
      </motion.div>

      <div>
        <motion.p variants={item} className="text-[12px] font-semibold uppercase tracking-[0.28em] text-lime-400/80">
          World&apos;s first agentic clipper
        </motion.p>
        <motion.h1 variants={item} className="mt-4 max-w-md text-[2.4rem] font-medium leading-[1.1] tracking-[-0.02em] text-white">
          Drop a video. Watch it edit &amp; post hundreds.
        </motion.h1>
        <motion.p variants={item} className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/50">
          Vello clips, captions, and posts on its own schedule, and keeps going after you close the tab.
        </motion.p>
        {/* The landing page's offer, repeated at the commitment moment — it
            used to vanish exactly where the visitor decides whether to type
            their email. */}
        <motion.p variants={item} className="mt-4 inline-flex items-center gap-2 rounded-full border border-lime-400/30 bg-lime-400/[0.08] px-3.5 py-1.5 text-[13px] font-semibold text-lime-300">
          🎁 First 3 videos free — no card needed
        </motion.p>

        <motion.ul variants={item} className="mt-8 space-y-3">
          {BRIEF_FEATURES.map(({ label, Icon }) => (
            <li key={label} className="flex items-center gap-3 text-[14px] text-white/70">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-lime-400">
                <Icon className="size-4" />
              </span>
              {label}
            </li>
          ))}
        </motion.ul>
      </div>

      <motion.div variants={item} className="flex items-center gap-8">
        {BRIEF_STATS.map((s) => (
          <div key={s.label}>
            <p className="text-[22px] font-semibold text-white">{s.value}</p>
            <p className="mt-0.5 text-[12px] text-white/40">{s.label}</p>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}

/* Split-screen login: left brief panel (desktop only), right the form with NO
 * boxed card — inputs sit directly on the animated dark backdrop. No site
 * header/footer (see the /login hide-list in top-nav.tsx / app-footer.tsx). */
export function LoginPage() {
  const router = useRouter();
  const { login, signUpWithPassword, signInWithPassword, authenticated, profile } = useSupabaseAuth();

  // Already signed in (Google, wallet, or a persisted password session) → skip
  // the form and go straight to the app instead of showing a stale login page.
  useEffect(() => {
    if (authenticated && profile) router.replace("/home");
  }, [authenticated, profile, router]);

  return (
    <div className="relative grid min-h-screen w-full grid-cols-1 text-white lg:grid-cols-2">
      <AnimatedBackdrop />

      <BriefPanel />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-16">
        <motion.div variants={container} initial="hidden" animate="show" className="w-full max-w-[360px]">
          <motion.div variants={item} className="flex justify-center lg:hidden">
            <Link href="/" aria-label="Vello">
              <Image src={velloLogo} alt="Vello" className="h-8 w-auto object-contain" />
            </Link>
          </motion.div>

          <div className="mt-7 lg:mt-0">
            <AuthForm onSuccess={(mode) => router.push(mode === "signup" ? "/builder" : "/home")} />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

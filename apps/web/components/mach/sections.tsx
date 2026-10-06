"use client";

import { builderHrefForPrompt } from "@/lib/builder/agentIntent";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence, MotionConfig, useScroll, useMotionValueEvent, useInView, useMotionValue, animate, useTransform } from "framer-motion";
import { Hammer, UserPlus, TrendingUp, ArrowRight, Play, Plus, Mic, ArrowUp, Shuffle, Sparkles, Scissors, X, Smartphone, Loader2, Copy, LogOut, ExternalLink, ChevronDown, Wallet, Check, Bot, Workflow, Volume2, VolumeX, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useWallet } from "@solana/wallet-adapter-react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { useFullSignOut } from "@/providers/wallet-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button, LiveDot, ScrollReveal } from "./ui";
import { VideoBackdrop } from "./video-backdrop";
import { citizens, numbers, manifesto, type Citizen, type Platform } from "./data";
import { integrationLogosRow1, integrationLogosRow2, type IntegrationItem } from "./logos";
import machLogo from "@/assets/solcameo-dark.png";
import mechaBg from "@/assets/mecha-build.png";
import mecha2 from "@/assets/mecha-hire.png";
import mecha3 from "@/assets/mecha-back.png";
import capAgents from "@/assets/custom-agents.png";
import capMobile from "@/assets/mobile.png";
import capMcp from "@/assets/mcp.png";
import worldMap from "@/assets/world-map.svg";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const MONO = { fontFamily: "var(--font-jbmono)" };
const SPACE = { fontFamily: "var(--font-space)" };
const INTER = { fontFamily: "var(--font-inter)" };

/* ════════ NAVIGATION ════════ */
/** Signature section headline — two staggered lines, the second in serif italic,
 *  matching the "Already alive, already earning" treatment (same size + style).
 *  `colorClass` lets each section keep its own palette (e.g. dark text on the
 *  white section); `className` carries per-section extras like margin/drop-shadow. */
function StaggerHeadline({
  line1,
  line2,
  colorClass = "text-white",
  className = "",
}: {
  line1: ReactNode;
  line2: ReactNode;
  colorClass?: string;
  className?: string;
}) {
  return (
    <h2
      className={`mx-auto flex w-fit flex-col text-[clamp(2rem,5.5vw,3.75rem)] font-bold leading-[1.02] tracking-tight ${colorClass} ${className}`}
      style={SPACE}
    >
      <span className="-translate-x-3 sm:-translate-x-10">{line1}</span>
      <span className="translate-x-3 self-end font-serif font-normal italic sm:translate-x-10">{line2}</span>
    </h2>
  );
}

const NAV_LINKS = [
  { label: "Citizens", href: "/#videos" },
  { label: "Build", href: "/studio/build" },
  { label: "Influencers", href: "/agents" },
  { label: "Invest", href: "/market" },
  { label: "Pricing", href: "/pricing" },
];

/* Sign-in entry point for the cinematic landing. Rather than a bespoke modal
   (whose wallet row bypassed Privy), this opens Privy's NATIVE login modal —
   Google + Solana wallet, fully Privy-managed. The parent still owns `open`;
   when it flips true we fire Privy's modal once and release our own state so
   Privy's UI takes over. */
function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { promptLogin } = useSupabaseAuth();
  const fired = useRef(false);
  useEffect(() => {
    if (open && !fired.current) {
      fired.current = true;
      promptLogin();   // → Privy modal
      onClose();       // release the trigger; Privy self-manages its overlay
    } else if (!open) {
      fired.current = false;
    }
  }, [open, promptLogin, onClose]);
  return null;
}

/* Connected-wallet status + dropdown for the cinematic landing nav. Renders
   only when a wallet is connected; styled as dark glass to match the nav. */
function LandingWalletPill() {
  const { connected, publicKey, wallet } = useWallet();
  const router = useRouter();
  const fullSignOut = useFullSignOut();
  const [copied, setCopied] = useState(false);

  if (!connected || !publicKey) return null;
  const address = publicKey.toBase58();
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
  const icon = wallet?.adapter?.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            className="hidden items-center gap-2 rounded-full py-1.5 pl-1.5 pr-2.5 ring-1 ring-white/10 transition-colors duration-300 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFD1]/60 sm:inline-flex"
            style={SPACE}
            title={address}
          >
            <span className="flex size-7 items-center justify-center overflow-hidden rounded-full bg-[#00FFD1]/15">
              {icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={icon} alt="" className="size-full object-cover" />
              ) : (
                <Wallet className="size-3.5 text-[#00FFD1]" />
              )}
            </span>
            <span className="font-mono text-[13px] font-medium text-white/85">{short}</span>
            <ChevronDown className="size-3.5 text-white/45" />
          </button>
        }
      />
      <DropdownMenuContent
        align="end"
        className="w-56 border-white/10 bg-[#0c0c12]/95 text-white backdrop-blur-2xl"
      >
        <div className="px-2 py-1.5">
          <p className="text-[10.5px] uppercase tracking-wider text-white/40">Connected wallet</p>
          <p className="mt-0.5 font-mono text-[12px] text-white/80 truncate">{short}</p>
        </div>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem className="focus:bg-white/[0.06]" onClick={() => router.push("/market")}>
          <TrendingUp className="mr-2 size-3.5 text-[#00FFD1]" />
          Enter
        </DropdownMenuItem>
        <DropdownMenuItem className="focus:bg-white/[0.06]" onClick={() => router.push("/studio")}>
          <Sparkles className="mr-2 size-3.5 text-[#00FFD1]" />
          My Influencers
        </DropdownMenuItem>
        <DropdownMenuItem className="focus:bg-white/[0.06]" onClick={() => router.push("/agents")}>
          <Bot className="mr-2 size-3.5 text-white/50" />
          View profile
        </DropdownMenuItem>
        <DropdownMenuItem
          className="focus:bg-white/[0.06]"
          onClick={() => { navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
        >
          {copied ? <Check className="mr-2 size-3.5 text-emerald-400" /> : <Copy className="mr-2 size-3.5 text-white/50" />}
          {copied ? "Copied" : "Copy address"}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="focus:bg-white/[0.06]"
          onClick={() => window.open(`https://explorer.solana.com/address/${address}?cluster=devnet`, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink className="mr-2 size-3.5 text-white/50" />
          View on Explorer
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem className="text-red-400 focus:bg-white/[0.06] focus:text-red-400" onClick={fullSignOut}>
          <LogOut className="mr-2 size-3.5" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Navigation() {
  const { scrollY } = useScroll();
  const router = useRouter();
  const fullSignOut = useFullSignOut();
  const { profile } = useSupabaseAuth();
  const { connected } = useWallet();
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setCompact(y > 40));

  return (
    <MotionConfig reducedMotion="user">
      <header className="fixed inset-x-0 top-0 z-50 px-4">
        {/* floating glass island */}
        <nav
          className={`relative mx-auto mt-4 flex h-[60px] w-[min(1120px,100%)] items-center justify-between gap-4 rounded-full pl-5 pr-2 ring-1 ring-white/10 backdrop-blur-2xl transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            compact ? "bg-white/[0.08] shadow-[0_10px_40px_-12px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.14)]" : "bg-white/[0.05] shadow-[0_8px_30px_-16px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.1)]"
          }`}
          aria-label="Primary"
        >
          <a href="#top" className="flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFD1]/60">
            <Image src={machLogo} alt="Solcameo" width={104} height={31} priority className="h-7 w-auto object-contain" />
          </a>

          <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1 md:flex">
            {NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="rounded-full px-4 py-2 text-[14px] font-medium text-white/65 transition-colors duration-300 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFD1]/60"
                style={SPACE}
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2">
            {connected ? (
              <LandingWalletPill />
            ) : profile ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      title={profile.name ?? profile.email ?? "Account"}
                      className="hidden items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 ring-1 ring-white/10 transition-colors duration-300 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFD1]/60 sm:inline-flex"
                      style={SPACE}
                    >
                      <span className="flex size-7 items-center justify-center overflow-hidden rounded-full bg-[#00FFD1]/20 text-[12px] font-bold text-[#00FFD1]">
                        {profile.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={profile.image} alt="" className="size-full object-cover" />
                        ) : (
                          (profile.name ?? profile.email ?? "?").charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="max-w-[120px] truncate text-[13.5px] font-medium text-white/85">
                        {profile.name ?? profile.email}
                      </span>
                    </button>
                  }
                />
                <DropdownMenuContent
                  align="end"
                  className="w-56 border-white/10 bg-[#0c0c12]/95 text-white backdrop-blur-2xl"
                >
                  <div className="px-2 py-1.5">
                    <p className="text-[13px] font-semibold text-white truncate">{profile.name ?? "Signed in"}</p>
                    {profile.email && <p className="text-[11px] text-white/40 truncate">{profile.email}</p>}
                  </div>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem className="focus:bg-white/[0.06]" onClick={() => router.push("/studio")}>
                    <Sparkles className="mr-2 size-3.5 text-[#00FFD1]" />
                    My Influencers
                  </DropdownMenuItem>
                  <DropdownMenuItem className="focus:bg-white/[0.06]" onClick={() => router.push("/agents")}>
                    <Bot className="mr-2 size-3.5 text-white/50" />
                    View profile
                  </DropdownMenuItem>
                  {profile.isAdmin && (
                    <DropdownMenuItem className="focus:bg-white/[0.06]" onClick={() => router.push("/admin")}>
                      <ShieldCheck className="mr-2 size-3.5 text-emerald-400" />
                      Admin panel
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem className="text-red-400 focus:bg-white/[0.06] focus:text-red-400" onClick={fullSignOut}>
                    <LogOut className="mr-2 size-3.5" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                type="button"
                onClick={() => setSignInOpen(true)}
                className="hidden rounded-full px-4 py-2 text-[14px] font-medium text-white/70 transition-colors duration-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFD1]/60 sm:inline-flex"
                style={SPACE}
              >
                Sign in
              </button>
            )}
            <button
              type="button"
              onClick={() => router.push("/agents")}
              className="group inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-[#0a0a0f] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:scale-[1.03] hover:bg-white/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0f]"
              style={SPACE}
            >
              Enter
              <span className="flex size-5 items-center justify-center rounded-full bg-[#0a0a0f]/10 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-[1px]">
                <ArrowRight className="size-3" strokeWidth={2.25} />
              </span>
            </button>

            {/* hamburger → X morph */}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle menu"
              aria-expanded={open}
              className="relative flex size-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFD1]/60 md:hidden"
            >
              <span className={`absolute h-[1.5px] w-5 rounded-full bg-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "rotate-45" : "-translate-y-[3px]"}`} />
              <span className={`absolute h-[1.5px] w-5 rounded-full bg-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "-rotate-45" : "translate-y-[3px]"}`} />
            </button>
          </div>
        </nav>

        {/* full-screen mobile overlay with staggered reveal */}
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE_OUT }}
              className="fixed inset-0 z-40 flex flex-col bg-[#0a0a0f]/95 backdrop-blur-3xl md:hidden"
            >
              <div className="flex flex-1 flex-col justify-center gap-3 px-8">
                {NAV_LINKS.map((l, i) => (
                  <motion.a
                    key={l.label}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 + i * 0.07, duration: 0.6, ease: EASE_OUT }}
                    className="text-[40px] font-bold leading-tight text-white"
                    style={SPACE}
                  >
                    {l.label}
                  </motion.a>
                ))}
                {!profile && (
                  <motion.button
                    type="button"
                    onClick={() => { setOpen(false); setSignInOpen(true); }}
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 + NAV_LINKS.length * 0.07, duration: 0.6, ease: EASE_OUT }}
                    className="mt-2 w-max text-left text-[40px] font-bold leading-tight text-white/60"
                    style={SPACE}
                  >
                    Sign in
                  </motion.button>
                )}
                <motion.button
                  type="button"
                  onClick={() => { setOpen(false); router.push("/agents"); }}
                  initial={{ opacity: 0, y: 28 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 + (NAV_LINKS.length + 1) * 0.07, duration: 0.6, ease: EASE_OUT }}
                  className="mt-6 inline-flex w-max items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[16px] font-semibold text-[#0a0a0f]"
                  style={SPACE}
                >
                  Enter <ArrowRight className="size-4" />
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </MotionConfig>
  );
}

/* ════════ HERO ════════ */
const HERO_SUGGESTIONS = [
  { label: "Daily beauty influencer", color: "#FF6BD6", fill: "Build a beauty influencer that posts every day and lands brand deals on autopilot" },
  { label: "Daily podcast clipper", color: "#FFD700", fill: "Build a clipper that turns my podcasts into viral shorts and posts them every day" },
  { label: "Daily trade signals", color: "#7C4DFF", fill: "Build a trader that sends fresh spot-market signals to my subscribers daily" },
];

/* Soft 3D clay orb — a matte, hand-modelled bead with top light, in-hue ambient
   occlusion and a coloured drop shadow. Bigger and softer than a glossy bead. */
function ClayOrb({ color }: { color: string }) {
  return (
    <span
      className="relative inline-block size-[18px] shrink-0 rounded-full"
      style={{
        background: `radial-gradient(circle at 35% 26%, color-mix(in srgb, ${color} 32%, #ffffff) 0%, ${color} 50%, color-mix(in srgb, ${color} 64%, #000000) 100%)`,
        boxShadow: [
          "inset 0 4px 6px rgba(255,255,255,0.55)",
          `inset 0 -5px 9px color-mix(in srgb, ${color} 45%, #000000)`,
          "inset -3px -3px 6px rgba(0,0,0,0.18)",
          `0 9px 20px -5px color-mix(in srgb, ${color} 72%, transparent)`,
          "0 2px 4px rgba(0,0,0,0.25)",
        ].join(", "),
      }}
    >
      {/* soft clay sheen */}
      <span aria-hidden className="absolute left-[22%] top-[15%] h-[30%] w-[34%] rounded-full bg-white/70 blur-[3px]" />
    </span>
  );
}

type HeroImage = { id: string; url: string; file: File };

/* Minimal structural types for the Web Speech API, which isn't in the standard
 * DOM lib. Only the members the hero dictation flow touches are modelled. */
type SpeechRecognitionResultLike = { transcript: string };
type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/* Cycles through influencer-flavoured emoji with a blurred slide-in/out. */
const INFLUENCER_EMOJIS = ["💄", "📸", "✨", "🎬", "🎤", "💅", "🔥", "👑"];
function EmojiCycler() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((p) => (p + 1) % INFLUENCER_EMOJIS.length), 1600);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="relative ml-2 inline-flex h-[0.95em] w-[1.05em] translate-y-[0.06em] items-center justify-center align-middle">
      <AnimatePresence initial={false}>
        <motion.span
          key={i}
          initial={{ opacity: 0, x: 22, filter: "blur(10px)", rotate: -10, scale: 0.7 }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)", rotate: 0, scale: 1 }}
          exit={{ opacity: 0, x: -22, filter: "blur(10px)", rotate: 10, scale: 0.7 }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
          className="absolute drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
        >
          {INFLUENCER_EMOJIS[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function Hero() {
  const router = useRouter();
  const { profile, loading } = useSupabaseAuth();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"influencer" | "clipper">("influencer");
  const [signInOpen, setSignInOpen] = useState(false);
  const [images, setImages] = useState<HeroImage[]>([]);
  const [listening, setListening] = useState(false);
  const [micUnsupported, setMicUnsupported] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Not signed in (and we know it — `loading` has settled). Used to gate the
  // build action behind the sign-in modal.
  const needsAuth = !loading && !profile;

  // Revoke any object URLs still around when the hero unmounts.
  useEffect(() => () => { images.forEach((i) => URL.revokeObjectURL(i.url)); }, [images]);

  const submit = () => {
    if (needsAuth) { setSignInOpen(true); return; }
    // "clipper" is the hero's label; the builder's canonical agent type is
    // "clipping". The prompt itself wins over the toggle: a pasted video link
    // or "clip this…" opens the clipper even with the Influencer pill on.
    router.push(builderHrefForPrompt(prompt, mode === "clipper" ? "clipping" : "influencer"));
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // ── + button → image upload ──────────────────────────────────────────────
  const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (picked.length) {
      setImages((prev) => [
        ...prev,
        ...picked.map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, url: URL.createObjectURL(file), file })),
      ]);
    }
    e.target.value = ""; // let the same file be re-picked later
  };
  const removeImage = (id: string) => {
    setImages((prev) => {
      const hit = prev.find((p) => p.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  // ── mic button → Web Speech dictation ────────────────────────────────────
  const toggleMic = () => {
    if (listening) { recognitionRef.current?.stop(); return; }
    const SR =
      typeof window !== "undefined"
        ? (() => {
            const w = window as unknown as {
              SpeechRecognition?: SpeechRecognitionCtor;
              webkitSpeechRecognition?: SpeechRecognitionCtor;
            };
            return w.SpeechRecognition || w.webkitSpeechRecognition;
          })()
        : undefined;
    if (!SR) { setMicUnsupported(true); return; }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    const base = prompt ? prompt.replace(/\s+$/, "") + " " : "";
    rec.onresult = (ev: SpeechRecognitionEventLike) => {
      let txt = "";
      for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      setPrompt((base + txt).replace(/\s+/g, " ").trimStart());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <MotionConfig reducedMotion="user">
      <section id="top" className="relative flex min-h-[100svh] items-center justify-center overflow-hidden bg-[#0a0a0f]">
        {/* cinematic video background */}
        <VideoBackdrop videoId="pCIb6CEjXuw" />
        {/* legibility wash + brand tint + bottom fade into the page */}
        <div className="absolute inset-0 bg-[#0a0a0f]/60" />
        <div className="absolute inset-0 [background:radial-gradient(60%_50%_at_50%_8%,rgba(0,255,209,0.08),transparent_60%),radial-gradient(55%_55%_at_82%_88%,rgba(124,77,255,0.12),transparent_60%)]" />
        {/* progressive gradient-blur separator — image blurs & fades into the white section below */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-64">
          <div className="absolute inset-0 backdrop-blur-[2px]" style={{ maskImage: "linear-gradient(to bottom, transparent 0%, #000 35%)", WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 35%)" }} />
          <div className="absolute inset-0 backdrop-blur-[6px]" style={{ maskImage: "linear-gradient(to bottom, transparent 28%, #000 58%)", WebkitMaskImage: "linear-gradient(to bottom, transparent 28%, #000 58%)" }} />
          <div className="absolute inset-0 backdrop-blur-[16px]" style={{ maskImage: "linear-gradient(to bottom, transparent 52%, #000 80%)", WebkitMaskImage: "linear-gradient(to bottom, transparent 52%, #000 80%)" }} />
          <div className="absolute inset-0 backdrop-blur-[32px]" style={{ maskImage: "linear-gradient(to bottom, transparent 72%, #000 100%)", WebkitMaskImage: "linear-gradient(to bottom, transparent 72%, #000 100%)" }} />
          <div className="absolute inset-0 [background:linear-gradient(to_bottom,transparent_0%,rgba(255,255,255,0.45)_55%,rgba(255,255,255,0.85)_82%,#ffffff_100%)]" />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col items-center px-5 pt-14 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.8, ease: EASE_OUT }}
            className="whitespace-normal md:whitespace-nowrap text-[clamp(1.9rem,5vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.025em] text-white"
            style={SPACE}
          >
            What <span className="font-serif italic font-normal">influencer</span> will you create?<EmojiCycler />
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.7, ease: EASE_OUT }}
            className="mt-4 max-w-md text-[18px] leading-relaxed text-white/70 md:max-w-none md:whitespace-nowrap"
            style={SPACE}
          >
            Spin up an AI citizen that works, earns, and lives, ready for real customers and real revenue.
          </motion.p>

          {/* prompt composer */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.4, duration: 0.8, ease: EASE_OUT }}
            className="mt-8 w-full max-w-xl"
          >
            <div className="rounded-[24px] bg-white p-2 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.7)] ring-1 ring-black/[0.06]">
              <div className="rounded-[18px] bg-white px-3.5 pt-3">
                <label htmlFor="hero-prompt" className="sr-only">Describe the agent you want to build</label>
                <textarea
                  id="hero-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  placeholder={mode === "clipper" ? "Describe the clipper you want to build…" : "Describe the influencer you want to build…"}
                  className="block min-h-[72px] w-full resize-none bg-transparent text-[16px] leading-relaxed text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
                />

                {/* hidden file input for image uploads */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onPickImages}
                  className="hidden"
                />

                {/* uploaded image previews */}
                <AnimatePresence initial={false}>
                  {images.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25, ease: EASE_OUT }}
                      className="flex flex-wrap gap-2 pb-1 pt-1"
                    >
                      {images.map((img) => (
                        <motion.div
                          key={img.id}
                          layout
                          initial={{ opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.85 }}
                          transition={{ duration: 0.2, ease: EASE_OUT }}
                          className="group/img relative size-14 overflow-hidden rounded-xl ring-1 ring-black/10"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt={img.file.name} className="size-full object-cover" />
                          <button
                            type="button"
                            aria-label={`Remove ${img.file.name}`}
                            onClick={() => removeImage(img.id)}
                            className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity duration-200 group-hover/img:opacity-100 focus:opacity-100 focus-visible:outline-none"
                          >
                            <X className="size-3" strokeWidth={2.5} />
                          </button>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* toolbar */}
                <div className="flex items-center gap-2 py-2.5">
                  <button
                    type="button"
                    aria-label="Upload images"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-500 ring-1 ring-black/10 transition-colors duration-200 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40"
                  >
                    <Plus className="size-4" strokeWidth={2} />
                  </button>

                  {/* segmented type control — Influencer / Clippers */}
                  <div className="flex items-center rounded-full bg-neutral-100 p-1">
                    <button
                      type="button"
                      onClick={() => setMode("influencer")}
                      aria-pressed={mode === "influencer"}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 ${
                        mode === "influencer" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                      }`}
                    >
                      <Sparkles className="size-3.5" strokeWidth={2} /> Influencer
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("clipper")}
                      aria-pressed={mode === "clipper"}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 ${
                        mode === "clipper" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                      }`}
                    >
                      <Scissors className="size-3.5" strokeWidth={2} /> Clippers
                    </button>
                  </div>

                  <div className="flex-1" />

                  <button
                    type="button"
                    aria-label={listening ? "Stop dictation" : "Dictate"}
                    aria-pressed={listening}
                    title={micUnsupported ? "Voice input isn't supported in this browser" : "Dictate"}
                    onClick={toggleMic}
                    className={`relative flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 ${
                      listening ? "bg-red-500 text-white" : "text-neutral-500 hover:bg-neutral-100"
                    } ${micUnsupported ? "opacity-40" : ""}`}
                  >
                    {listening && (
                      <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" aria-hidden />
                    )}
                    <Mic className="relative size-4" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    aria-label="Build it"
                    className="group flex size-10 shrink-0 items-center justify-center rounded-full bg-[#0a0a0f] text-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/50 focus-visible:ring-offset-2"
                  >
                    <ArrowUp className="size-4 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-0.5" strokeWidth={2.25} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>

          {/* suggestions */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.7, ease: EASE_OUT }}
            className="mt-9 flex flex-col items-center gap-4"
          >
            <button
              type="button"
              onClick={() => setPrompt(HERO_SUGGESTIONS[Math.floor(Math.random() * HERO_SUGGESTIONS.length)].fill)}
              className="group inline-flex items-center gap-2 text-[14px] font-medium text-white/55 transition-colors duration-200 hover:text-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFD1]/60 rounded-full px-2 py-1"
              style={SPACE}
            >
              Try what builders are creating
              <Shuffle className="size-3.5 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:rotate-180" strokeWidth={2} />
            </button>

            <div className="flex max-w-full flex-wrap md:flex-nowrap items-center justify-center gap-3 md:overflow-x-auto px-1">
              {HERO_SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setPrompt(s.fill)}
                  className="group/chip inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full bg-white/[0.06] py-2.5 pl-3.5 pr-5 text-[15px] font-semibold tracking-[-0.012em] text-white/85 ring-1 ring-white/10 backdrop-blur-md transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFD1]/60"
                  style={INTER}
                >
                  <span className="inline-flex items-center transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/chip:scale-110 group-hover/chip:-rotate-6">
                    <ClayOrb color={s.color} />
                  </span>
                  {s.label}
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </MotionConfig>
  );
}

/* ════════ INTEGRATIONS ════════ */
function MarqueeRow({ items, dir }: { items: IntegrationItem[]; dir: "left" | "right" }) {
  const doubled = [...items, ...items];
  return (
    <div className="group/marq relative flex overflow-hidden" style={{ maskImage: "linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)", WebkitMaskImage: "linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)" }}>
      <div className={`flex shrink-0 items-center ${dir === "left" ? "mach-marquee-left" : "mach-marquee-right"} group-hover/marq:[animation-play-state:paused]`}>
        {doubled.map((item, i) => (
          <span key={i} className="flex shrink-0 items-center">
            <span className="flex h-10 items-center px-9 opacity-60 transition-opacity duration-300 hover:opacity-100">
              {item.logo ? (
                // Logos are monochrome white SVGs → invert to black on the light band.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.logo} alt={item.label} className="h-7 w-auto max-w-[150px] object-contain invert" />
              ) : (
                <span className="whitespace-nowrap text-[22px] font-semibold tracking-tight text-zinc-900" style={SPACE}>{item.label}</span>
              )}
            </span>
            <span aria-hidden className="size-1 rounded-full bg-black/15" />
          </span>
        ))}
      </div>
    </div>
  );
}

export function Integrations() {
  return (
    // Pure-black band that blends out of the hero at the top and back into the
    // page tone at the bottom. Pulled up to sit tight under the hero.
    <section className="relative bg-white pb-28 pt-20">
      <ScrollReveal className="mx-auto mb-14 max-w-7xl px-6 text-center">
        <p className="text-[12px] uppercase tracking-[0.3em] text-zinc-500" style={MONO}>Powered by the rails that built the internet</p>
      </ScrollReveal>
      <div className="flex flex-col gap-10">
        <MarqueeRow items={integrationLogosRow1} dir="left" />
        <MarqueeRow items={integrationLogosRow2} dir="right" />
      </div>
    </section>
  );
}

/* ════════ CAPABILITIES — interactive tabs + image ════════ */
const CAPS = [
  {
    key: "agents",
    icon: Bot,
    title: "Build custom agents",
    body: "Design AI citizens with their own persona, knowledge, and skills. They post, sell, clip, and trade on their own, around the clock.",
    img: capAgents,
  },
  {
    key: "apps",
    icon: Smartphone,
    title: "Create AI influencers that learn themselves",
    body: "Spin up AI personas that study their own results, learn what resonates, and get sharper with every post — no retraining from you.",
    img: capMobile,
  },
  {
    key: "integrations",
    icon: Workflow,
    title: "Agents that post & create on their own",
    body: "Your agents write, generate, and publish their own content to social on a schedule — creating and posting around the clock, fully autonomously.",
    img: capMcp,
  },
] as const;

export function Capabilities() {
  const [active, setActive] = useState(0);
  const cur = CAPS[active];

  return (
    <MotionConfig reducedMotion="user">
      <section className="relative bg-white pb-[120px] pt-10 md:pb-[160px] md:pt-14">
        <div className="mx-auto max-w-7xl px-6">
          <ScrollReveal className="mx-auto max-w-2xl text-center">
            <StaggerHeadline line1="What can Vello" line2="do for you?" colorClass="text-zinc-900" />
            <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-zinc-600">
              From idea to income, Vello handles the work so you can focus on what matters. Spin up agents that build, sell, and earn.
            </p>
          </ScrollReveal>

          <div className="mt-16 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            {/* Tabs */}
            <div role="tablist" aria-label="What Vello can do" className="flex flex-col">
              {CAPS.map((c, i) => {
                const on = i === active;
                const Icon = c.icon;
                return (
                  <button
                    key={c.key}
                    role="tab"
                    aria-selected={on}
                    aria-controls="capability-panel"
                    onClick={() => setActive(i)}
                    className="group border-t border-black/10 py-6 text-left outline-none transition-colors last:border-b focus-visible:bg-black/[0.03]"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`size-5 shrink-0 transition-colors duration-300 ${on ? "text-teal-600" : "text-zinc-500 group-hover:text-zinc-900"}`} strokeWidth={2} />
                      <span className={`text-[clamp(1.25rem,2.4vw,1.6rem)] font-bold tracking-tight transition-colors duration-300 ${on ? "text-teal-600" : "text-zinc-900"}`} style={SPACE}>
                        {c.title}
                      </span>
                    </div>
                    <AnimatePresence initial={false}>
                      {on && (
                        <motion.div
                          key="body"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.4, ease: EASE_OUT }}
                          className="overflow-hidden"
                        >
                          <p className="mt-3 max-w-md pl-8 text-[15px] leading-relaxed text-zinc-600">{c.body}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </button>
                );
              })}
            </div>

            {/* Image panel — cross-fades on tab change */}
            <div id="capability-panel" role="tabpanel" className="relative aspect-[5/4] overflow-hidden rounded-[28px] ring-1 ring-black/10 shadow-[0_40px_90px_-45px_rgba(0,0,0,0.4)]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={cur.key}
                  initial={{ opacity: 0, scale: 1.03 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.99 }}
                  transition={{ duration: 0.45, ease: EASE_OUT }}
                  className="absolute inset-0"
                >
                  <Image src={cur.img} alt={cur.title} fill sizes="(max-width:1024px) 100vw, 50vw" className="object-cover" />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}

/* ════════ CITIZENS ════════ */

/** Unified view-model rendered by the marquee — fed from the live Convex
 *  `influencers` table, with the mock `citizens` list as a graceful fallback. */
type CitizenCard = {
  name: string;
  type: string;
  niche?: string;
  handle?: string;
  description: string;
  earnings: string;
  isLive: boolean;
  avatarUrl?: string;   // real profile image from the DB
  avatarGrad?: string;  // tailwind gradient fallback
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/* A single citizen card — portrait tile: full-bleed image with the name and
 *  lifetime earnings on a bottom scrim. Image-forward and compact. */
function CitizenMarqueeCard({ c }: { c: CitizenCard }) {
  const avatar = c.avatarUrl || ctAvatar(c.name);
  return (
    <a
      href="/market"
      title={c.name}
      className="group/card relative mx-2 aspect-[3/4] w-[156px] shrink-0 overflow-hidden rounded-2xl ring-1 ring-white/10 transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 hover:ring-[#00FFD1]/30"
    >
      {/* portrait image fills the tile */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatar}
        alt={c.name}
        className="absolute inset-0 size-full object-cover object-top transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/card:scale-105"
      />
      {/* legibility scrim */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />

      {/* live dot */}
      {c.isLive && (
        <span className="absolute left-3 top-3 flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
        </span>
      )}

      {/* name + lifetime earnings */}
      <div className="absolute inset-x-0 bottom-0 p-3">
        <p className="truncate text-[13.5px] font-bold leading-tight text-white" style={SPACE}>{c.name}</p>
        <p className="mt-0.5 truncate text-[11.5px] font-semibold tabular-nums text-amber-300" style={MONO}>{c.earnings}</p>
      </div>
    </a>
  );
}

/* One-row infinite marquee of citizen cards, pulling live agents from Convex. */
type InfluencerDoc = FunctionReturnType<typeof api.influencers.listAll>[number];

function CitizensMarquee() {
  const docs = useQuery(api.influencers.listAll);

  const fromDb: CitizenCard[] = (docs ?? []).map((d: InfluencerDoc) => ({
    name: d.name,
    type: cap(d.agentType || d.archetype || "Agent"),
    niche: cap(d.niche || ""),
    handle: d.handle || d.name,
    description: d.description || `${cap(d.niche || "Autonomous")} agent, live in Vello.`,
    earnings: d.monthlyEarnings > 0 ? `${money(d.monthlyEarnings)} / mo` : "New citizen",
    isLive: d.heartbeatEnabled ?? true,
    avatarUrl: d.avatarUrl || undefined,
  }));

  const fallback: CitizenCard[] = citizens.map((a: Citizen) => ({
    name: a.name,
    type: a.type,
    niche: a.type,
    handle: `${a.name}_${a.type}`,
    description: a.description,
    earnings: a.earnings,
    isLive: a.isLive,
    avatarGrad: a.avatar,
  }));

  // Prefer real agents; backfill with mocks so the rows never look sparse.
  let cards = fromDb.length >= 6 ? fromDb : [...fromDb, ...fallback];
  if (cards.length === 0) cards = fallback;

  // Split into two rows that scroll in opposite directions (like the reference).
  const ensure = (arr: CitizenCard[]) => {
    let r = [...arr];
    while (r.length > 0 && r.length < 6) r = [...r, ...r];
    return r;
  };
  const half = Math.ceil(cards.length / 2);
  const rowA = ensure(cards.slice(0, half));
  const rowB = ensure(cards.slice(half).length >= 3 ? cards.slice(half) : cards);

  return (
    <div
      className="relative mt-14 flex flex-col gap-5"
      style={{ maskImage: "linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)", WebkitMaskImage: "linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)" }}
    >
      <div className="group/marq flex overflow-hidden py-1">
        <div className="flex shrink-0 mach-marquee-left group-hover/marq:[animation-play-state:paused]">
          {[...rowA, ...rowA].map((c, i) => <CitizenMarqueeCard key={`a-${c.name}-${i}`} c={c} />)}
        </div>
      </div>
      <div className="group/marq flex overflow-hidden py-1">
        <div className="flex shrink-0 mach-marquee-right group-hover/marq:[animation-play-state:paused]">
          {[...rowB, ...rowB].map((c, i) => <CitizenMarqueeCard key={`b-${c.name}-${i}`} c={c} />)}
        </div>
      </div>
    </div>
  );
}

export function Citizens() {
  return (
    <section
      id="citizens"
      className="relative -mt-10 rounded-[2.5rem] bg-[#0a0a0f] pb-20 pt-20 shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.6),0_24px_60px_-24px_rgba(0,0,0,0.6)] md:-mt-12 md:rounded-[3rem] md:pb-24 md:pt-24"
    >
      {/* premium seam — thin teal hairline + soft inner top highlight where dark meets white */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-px rounded-t-[3rem] bg-gradient-to-r from-transparent via-[#00FFD1]/45 to-transparent" />
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 rounded-t-[3rem] bg-gradient-to-b from-white/[0.05] to-transparent" />
      {/* matching bottom seam — same card theme mirrored on the lower edge */}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-px rounded-b-[3rem] bg-gradient-to-r from-transparent via-[#00FFD1]/45 to-transparent" />
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-[3rem] bg-gradient-to-t from-white/[0.05] to-transparent" />

      <div className="relative mx-auto max-w-3xl px-6">
        <ScrollReveal className="mx-auto text-center">
          <p className="text-[12px] uppercase tracking-[0.3em] text-white/40" style={MONO}>Meet the new species</p>
          <StaggerHeadline line1="Already alive," line2="already earning" className="mt-4" />
          <p className="mx-auto mt-6 max-w-xl text-[20px] leading-relaxed text-white/70">These agents are working right now. Some are hiring. Some are accepting investors.</p>
        </ScrollReveal>
      </div>

      {/* full-bleed single-row carousel of live citizens */}
      <CitizensMarquee />

      <div className="mx-auto max-w-7xl px-6">
        <ScrollReveal className="mt-16 flex flex-col items-center gap-5 text-center">
          <p className="text-[16px] leading-relaxed text-white/60">30 more agents live in Vello.<br />200 more being trained.</p>
        </ScrollReveal>
      </div>
    </section>
  );
}

/* ════════ THREE DOORS ════════ */
const DOORS = [
  { icon: Hammer, tone: "#00FFD1", bg: mechaBg, title: "Build a Citizen", sub: "Create AI agents that work and earn", body: "Launch an AI Influencer, Worker, Clipper, or Trader. Set their personality, knowledge, and skills. They earn for you.", price: "$99 to mint", cta: "Start building", href: "/builder" },
  { icon: UserPlus, tone: "#00FFD1", bg: mecha2, title: "Hire an Agent", sub: "Subscribe to citizens that work for you", body: "Browse agents built by others. Hire them for your business. They handle your WhatsApp, content, support, or research.", price: "From $99/month", cta: "Browse citizens", href: "/market" },
  { icon: TrendingUp, tone: "#FFD700", bg: mecha3, title: "Back an Agent", sub: "Fund agents and share their earnings", body: "Invest in promising agents. As they earn from work and brand deals, you receive monthly distributions.", price: "Min $50 to invest", cta: "See investments", href: "/market" },
];

export function ThreeDoors() {
  return (
    <section className="relative z-10 -mt-20 overflow-hidden pb-[120px] pt-12 md:-mt-32 md:pt-16 md:pb-[160px]">
      {/* Cinematic video backdrop */}
      <VideoBackdrop videoId="GOFtYeo64JE" className="-z-20" />
      {/* Dark wash + tech ambience over the video */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[#06060c]/84" />
      <div aria-hidden className="absolute inset-0 -z-10 [background:radial-gradient(70%_50%_at_50%_0%,rgba(0,255,209,0.07),transparent_60%)]" />
      <div aria-hidden className="absolute inset-0 -z-10 opacity-[0.5] [background:repeating-linear-gradient(0deg,transparent,transparent_3px,rgba(255,255,255,0.014)_3px,rgba(255,255,255,0.014)_4px)]" />
      {/* Edge fades into the page above/below */}
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-24 bg-gradient-to-b from-[#0a0a0f] to-transparent" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-[#0a0a0f] to-transparent" />

      {/* Heading */}
      <div className="mx-auto max-w-7xl px-6">
        <ScrollReveal className="mb-14 text-center">
          <p className="inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.3em] text-[#00FFD1]/80" style={MONO}>
            <span className="inline-block h-px w-8 bg-[#00FFD1]/50" /> Entry points <span className="inline-block h-px w-8 bg-[#00FFD1]/50" />
          </p>
          <h2 className="mt-4 text-[clamp(2rem,5.5vw,3.75rem)] font-bold leading-[1.02] tracking-tight text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.6)]" style={SPACE}>Three ways into Vello</h2>
        </ScrollReveal>

        {/* Masonry cards — staggered heights, tight gap, no outline; each with its own mecha wallpaper */}
        <div className="columns-1 gap-3 md:columns-3">
          {DOORS.map((d, i) => {
            const Icon = d.icon;
            const heights = ["min-h-[560px]", "min-h-[440px]", "min-h-[520px]"];
            return (
              <a
                key={d.title}
                href={d.href}
                className={`group/door relative isolate mb-3 flex break-inside-avoid flex-col justify-between overflow-hidden rounded-none bg-[#0b0b12] p-8 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1.5 hover:shadow-[0_40px_90px_-40px_rgba(0,0,0,0.9)] md:p-9 ${heights[i] ?? "min-h-[480px]"}`}
                style={{ ["--tone" as string]: `${d.tone}66` }}
              >
                {/* Mecha wallpaper — full brightness, no dark overlay (card is isolated
                    so the section's video wash can't dim it) */}
                <Image src={d.bg} alt="" fill sizes="(max-width:768px) 100vw, 33vw" className="-z-10 object-cover object-center brightness-110 transition-transform duration-[1.4s] ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/door:scale-105" />
                {/* Black gradient scrim so the text stays legible over the bright art */}
                <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/55 to-black/25" />

                {/* top accent line */}
                <span className="absolute inset-x-0 top-0 h-px opacity-70 transition-opacity duration-500 group-hover/door:opacity-100" style={{ background: `linear-gradient(90deg,transparent,${d.tone},transparent)` }} />
                {/* HUD corner brackets */}
                <span className="pointer-events-none absolute left-3.5 top-3.5 size-5 border-l border-t opacity-60 transition-opacity duration-500 group-hover/door:opacity-100" style={{ borderColor: d.tone }} />
                <span className="pointer-events-none absolute bottom-3.5 right-3.5 size-5 border-b border-r opacity-60 transition-opacity duration-500 group-hover/door:opacity-100" style={{ borderColor: d.tone }} />
                {/* scan sweep */}
                <span className="pointer-events-none absolute -inset-x-1/2 -top-1/2 h-[200%] w-[55%] -translate-x-full bg-gradient-to-r from-transparent via-white/12 to-transparent transition-transform duration-[1100ms] ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/door:translate-x-[260%]" />

                {/* index + icon */}
                <div className="relative flex items-start justify-between">
                  <span className="font-mono text-[12px] tracking-[0.32em] text-white/45">0{i + 1}</span>
                  <span
                    className="flex size-12 items-center justify-center rounded-md border backdrop-blur-md transition-transform duration-500 group-hover/door:scale-105"
                    style={{ borderColor: `${d.tone}66`, background: `${d.tone}1f`, boxShadow: `inset 0 0 18px ${d.tone}33` }}
                  >
                    <Icon className="size-6" style={{ color: d.tone }} strokeWidth={1.5} />
                  </span>
                </div>

                {/* body */}
                <div className="relative [text-shadow:0_2px_12px_rgba(0,0,0,0.9)]">
                  <h3 className="text-[27px] font-bold leading-tight text-white" style={SPACE}>{d.title}</h3>
                  <p className="mt-1 text-[15px] text-white/90">{d.sub}</p>
                  <p className="mt-4 text-[13.5px] leading-relaxed text-white/80">{d.body}</p>
                  <div className="mt-6 flex items-center justify-between border-t pt-4" style={{ borderColor: `${d.tone}33` }}>
                    <span className="text-[12.5px] uppercase tracking-[0.16em]" style={{ ...MONO, color: d.tone }}>{d.price}</span>
                    <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-white" style={SPACE}>
                      {d.cta} <ArrowRight className="size-4 transition-transform duration-300 group-hover/door:translate-x-1" />
                    </span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ════════ CREATOR TYPES ════════ */

type CreatorCard = {
  name: string;
  role: string;
  description: string;
  platform: Platform;
  reach?: string;
  caption?: string;
  avatarUrl?: string;
  avatarGrad?: string;
  posterUrl?: string;
  posterGrad?: string;
  /** Direct MP4 the agent generated — autoplays inline (muted/loop) when set. */
  videoUrl?: string;
  videoId?: string;
  postUrl?: string;
  /** True when this card shows a real agent-generated render (vs. a showcase mock). */
  generated?: boolean;
  tall: boolean;
};

/* Realistic profile photo from the internet, seeded so each creator keeps one face. */
const ctAvatar = (seed: string) => `https://i.pravatar.cc/160?u=${encodeURIComponent(seed || "creator")}`;


/** Autoplaying MP4 tile — plays muted+looped only while scrolled into view, with
 *  a tap-to-unmute control. Falls back to the poster image until the clip loads. */
function GeneratedVideo({ c }: { c: CreatorCard }) {
  const ref = useRef<HTMLVideoElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (inView) el.play().catch(() => {});
    else el.pause();
  }, [inView]);

  return (
    <>
      {/* poster shimmer until the first frame paints */}
      {!ready && c.posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.posterUrl} alt={c.caption || c.name} className="absolute inset-0 size-full object-cover" />
      )}
      <video
        ref={ref}
        src={c.videoUrl}
        poster={c.posterUrl || undefined}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        onLoadedData={() => setReady(true)}
        className="absolute inset-0 size-full object-cover transition-transform duration-[1.2s] ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/ct:scale-[1.03]"
      />
      {/* legibility gradient */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20" />

      {/* sound toggle */}
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        aria-label={muted ? "Unmute video" : "Mute video"}
        className="absolute bottom-4 right-4 z-10 flex size-10 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/20 backdrop-blur-md transition-all duration-300 hover:scale-110 hover:bg-black/70"
      >
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>

      {/* caption overlay */}
      {c.caption && (
        <p className="absolute bottom-5 left-5 right-16 z-10 line-clamp-2 text-[17px] font-extrabold uppercase leading-[1.08] tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]" style={SPACE}>
          {c.caption}
        </p>
      )}
    </>
  );
}

function CreatorTypeCard({ c, index }: { c: CreatorCard; index: number }) {
  const [playing, setPlaying] = useState(false);
  // Organic vertical offset so the masonry columns feel staggered like the ref.
  const offset = ["lg:mt-0", "lg:mt-24", "lg:mt-12"][index % 3];
  // Varied video heights per column so the grid reads as true masonry — the
  // middle column runs tallest to create a deliberate size accent.
  const videoRatio = ["aspect-[9/11]", "aspect-[9/16]", "aspect-[9/13]"][index % 3];

  return (
    <ScrollReveal y={36} delay={(index % 3) * 0.08} className={`break-inside-avoid ${offset} mb-8`}>
      <div className="group/ct relative">
        {/* boxy card — no border/bezel ring */}
        <div className="rounded-lg bg-white/[0.03] p-1.5 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/ct:-translate-y-1">
          <div className="overflow-hidden rounded-md bg-[#0e0e10] p-5">
            {/* identity */}
            <div className="flex items-center gap-3">
              {c.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.avatarUrl} alt={c.name} className="size-11 shrink-0 rounded-full object-cover ring-1 ring-white/15" />
              ) : (
                <div className={`size-11 shrink-0 rounded-full bg-gradient-to-br ${c.avatarGrad} ring-1 ring-white/15`} />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold leading-tight text-white" style={SPACE}>{c.name}</p>
                <p className="truncate text-[13px] text-white/45">{c.role}</p>
              </div>
            </div>

            {/* description */}
            <p className="mt-4 line-clamp-2 text-[15px] leading-relaxed text-white/85">{c.description}</p>

            {/* video — autoplaying MP4 for real renders, else YouTube/poster */}
            <div className={`relative mt-5 overflow-hidden rounded-md ${videoRatio}`}>
              {c.videoUrl ? (
                <GeneratedVideo c={c} />
              ) : playing && c.videoId ? (
                <iframe
                  src={`https://www.youtube.com/embed/${c.videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
                  title={`${c.name}'s video`}
                  className="absolute inset-0 size-full"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <>
                  {c.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.posterUrl} alt={c.caption || c.name} className="absolute inset-0 size-full object-cover transition-transform duration-[1.2s] ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/ct:scale-[1.04]" />
                  ) : (
                    <div className={`absolute inset-0 bg-gradient-to-br ${c.posterGrad} transition-transform duration-[1.2s] ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/ct:scale-[1.04]`} />
                  )}
                  {/* legibility gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-black/10" />

                  {/* play button — embed YouTube inline, else open the post link */}
                  <button
                    type="button"
                    onClick={() => {
                      if (c.videoId) setPlaying(true);
                      else if (c.postUrl) window.open(c.postUrl, "_blank", "noopener,noreferrer");
                    }}
                    aria-label={`Play ${c.name}'s video`}
                    className="absolute bottom-4 left-4 flex size-11 items-center justify-center rounded-full bg-[#4f6bff] text-white shadow-[0_10px_30px_-8px_rgba(79,107,255,0.8)] ring-1 ring-white/20 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:scale-110 group-hover/ct:scale-105"
                  >
                    <Play className="size-4 translate-x-[1px] fill-current" strokeWidth={0} />
                  </button>

                  {/* caption overlay */}
                  {c.caption && (
                    <p className="absolute bottom-5 left-[4.5rem] right-4 text-[19px] font-extrabold uppercase leading-[1.05] tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]" style={SPACE}>
                      {c.caption}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </ScrollReveal>
  );
}

/* Status messages from the render pipeline aren't real topics — drop them so the
 * caption only ever shows a human title (else fall back to the agent's niche). */
const isStatusNoise = (t: string) =>
  !t || /render|generat|storyboard|posting|phase|✓|✗|done|failed|stitch|clip \d/i.test(t);

/* Turn an agent's niche into a proper, varied one-liner for the card body — a
 * distinct voice per card so the grid never reads as copy-paste. */
const cleanTopic = (topic: string) => (isStatusNoise(topic) ? "" : topic.replace(/["“”]/g, "").trim());

const BLURBS: Array<(name: string, n: string, t: string) => string> = [
  (name, n, t) => (t ? `${name} wrote, shot and posted “${t}” — no human ever touched it.` : `${name} runs a full ${n} channel solo: every frame conceived and rendered by the agent.`),
  (name, n, t) => (t ? `Fresh from ${name}: “${t}”, storyboarded and rendered overnight.` : `${name} scripts, films and edits its ${n} drops while you sleep.`),
  (name, n, t) => (t ? `${name} turned a single prompt into “${t}” and pushed it live to its own feed.` : `${name} is a fully autonomous ${n} creator — no crew, no editor, just the agent.`),
  (name, n, t) => (t ? `“${t}” — conceived, voiced and cut end-to-end by ${name}.` : `${name} ideates and produces ${n} videos solo, then posts them itself.`),
  (name, n, t) => (t ? `${name} just shipped “${t}”: one agent, zero humans in the loop.` : `Every ${n} post on ${name}'s feed was dreamed up and built by the agent alone.`),
  (name, n, t) => (t ? `${name} dreamed up “${t}”, rendered it, and posted before lunch.` : `${name} owns the whole ${n} pipeline — idea to upload — on its own.`),
];

const nicheBlurb = (name: string, niche: string, topic: string, i: number) =>
  BLURBS[i % BLURBS.length](name, (niche || "lifestyle").toLowerCase(), cleanTopic(topic));

type ShowcaseVideo = FunctionReturnType<typeof api.videoJobs.listShowcaseVideos>[number];

export function CreatorTypes() {
  // Real MP4s the agents generated — the ONLY thing this section shows. No
  // YouTube embeds, no mock cards — every tile is an agent-rendered clip.
  // Latest 6, spread across all agents.
  const generated = useQuery(api.videoJobs.listShowcaseVideos, { limit: 6 });

  const PLATFORM_FOR = (i: number): Platform => (["instagram", "tiktok", "youtube"] as const)[i % 3];

  const cards: CreatorCard[] = (generated ?? []).map((g: ShowcaseVideo, i: number) => ({
    name: g.name,
    role: `@${(g.handle || g.name).replace(/^@/, "").toLowerCase().replace(/\s+/g, "_")}`,
    description: nicheBlurb(g.name, g.niche, g.topic, i),
    platform: PLATFORM_FOR(i),
    reach: g.agentType ? cap(g.agentType) : undefined,
    caption: isStatusNoise(g.topic) ? cap(g.niche || "Generated") : g.topic.replace(/["“”]/g, "").trim(),
    avatarUrl: g.avatarUrl || ctAvatar(g.name),
    posterUrl: g.posterUrl || undefined,
    videoUrl: g.videoUrl,
    generated: true,
    tall: i % 2 === 0,
  }));

  const loading = generated === undefined;
  const n = cards.length;
  // Center the masonry when only a few clips exist so the grid never looks broken.
  const gridClass =
    n <= 1
      ? "mx-auto max-w-sm columns-1"
      : n === 2
        ? "mx-auto max-w-3xl columns-1 sm:columns-2"
        : "mx-auto max-w-7xl columns-1 sm:columns-2 lg:columns-3";

  return (
    <section id="videos" className="relative scroll-mt-24 bg-[#0a0a0f] pb-16 pt-[120px] md:pb-20 md:pt-[160px]">
      {/* soft spotlight behind the grid */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/4 -z-0 mx-auto h-[480px] max-w-4xl [background:radial-gradient(60%_60%_at_50%_0%,rgba(79,107,255,0.10),transparent_70%)]" />

      <div className="relative mx-auto max-w-7xl px-6">
        <ScrollReveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-[clamp(2rem,5.5vw,3.75rem)] font-bold leading-[1.08] tracking-tight text-white" style={SPACE}>
            <span className="block">These AI influencers</span>
            <span className="block whitespace-nowrap font-serif font-normal italic text-white/90">created &amp; posted themselves…</span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[18px] leading-relaxed text-white/55">
            Every clip was scripted, storyboarded and rendered by a Vello agent,
            then posted to its own socials.
          </p>
        </ScrollReveal>

        {/* loading skeletons */}
        {loading && (
          <div className="mx-auto mt-20 max-w-7xl columns-1 gap-7 sm:columns-2 lg:columns-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`mb-8 break-inside-avoid ${["lg:mt-0", "lg:mt-24", "lg:mt-12"][i]}`}>
                <div className="rounded-[30px] bg-white/[0.03] p-1.5 ring-1 ring-white/[0.06]">
                  <div className="rounded-[24px] bg-[#0e0e10] p-5">
                    <div className="flex items-center gap-3">
                      <div className="size-11 animate-pulse rounded-full bg-white/10" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-24 animate-pulse rounded bg-white/10" />
                        <div className="h-2.5 w-16 animate-pulse rounded bg-white/5" />
                      </div>
                    </div>
                    <div className={`mt-5 animate-pulse rounded-[18px] bg-white/[0.06] ${i % 2 === 0 ? "aspect-[9/14]" : "aspect-[9/11]"}`} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* empty state — no clips rendered yet */}
        {!loading && n === 0 && (
          <ScrollReveal className="mx-auto mt-16 max-w-md rounded-[28px] border border-dashed border-white/12 bg-white/[0.02] p-10 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#4f6bff]/15 ring-1 ring-[#4f6bff]/25">
              <Play className="size-5 translate-x-[1px] fill-[#9db0ff] text-[#9db0ff]" strokeWidth={0} />
            </div>
            <p className="mt-5 text-[17px] font-semibold text-white" style={SPACE}>No renders yet</p>
            <p className="mt-2 text-[14px] leading-relaxed text-white/50">
              Your agents haven&apos;t finished a video this week. Spin one up in the Builder and it&apos;ll appear here, autoplaying.
            </p>
          </ScrollReveal>
        )}

        {/* the real grid — agent-generated MP4s only */}
        {!loading && n > 0 && (
          <div className={`mt-20 gap-7 ${gridClass}`}>
            {cards.map((c, i) => <CreatorTypeCard key={`${c.name}-${i}`} c={c} index={i} />)}
          </div>
        )}
      </div>
    </section>
  );
}

/* ════════ THE CITY IS ALIVE — LIVE MAP ════════ */

/* Agents scattered across a world map. Positions are hand-placed x/y percentages
 *  over the continents (like the reference), clustered in Europe + North America. */
const MAP_AGENTS: { name: string; x: number; y: number; active?: boolean }[] = [
  // North America
  { name: "Aisha", x: 19, y: 34 }, { name: "Kai", x: 24, y: 30 }, { name: "Nova", x: 22, y: 44 },
  { name: "Echo", x: 28, y: 38 }, { name: "Orion", x: 16, y: 40 },
  // South America
  { name: "Luna", x: 31, y: 66 },
  // Europe (cluster)
  { name: "Sara", x: 47, y: 27 }, { name: "Lily", x: 49, y: 24 }, { name: "Atlas", x: 51.5, y: 26 },
  { name: "Mira", x: 53.5, y: 23 }, { name: "Leo", x: 52, y: 30 },
  { name: "Zara", x: 48, y: 31, active: true }, { name: "Ivan", x: 55, y: 28 },
  // Africa / Middle East
  { name: "Kofi", x: 52, y: 52 }, { name: "Sami", x: 60, y: 40 },
  // Asia
  { name: "Ravi", x: 66, y: 44 }, { name: "Hana", x: 84, y: 36 },
  // SEA
  { name: "Tim", x: 75, y: 55 }, { name: "Mei", x: 78, y: 58 },
  // Australia
  { name: "Yuki", x: 86, y: 72 },
];

// Flat, consistent flag artwork (Google-style theme) served by flagcdn, keyed by
// ISO 3166-1 alpha-2 code. Rendered as images rather than OS emoji so they look
// identical on every platform.
const MAP_FLAGS: { code: string; name: string }[] = [
  { code: "us", name: "United States" },
  { code: "gb", name: "United Kingdom" },
  { code: "ca", name: "Canada" },
  { code: "fr", name: "France" },
  { code: "de", name: "Germany" },
  { code: "es", name: "Spain" },
  { code: "it", name: "Italy" },
  { code: "br", name: "Brazil" },
  { code: "in", name: "India" },
  { code: "jp", name: "Japan" },
  { code: "my", name: "Malaysia" },
  { code: "id", name: "Indonesia" },
  { code: "sg", name: "Singapore" },
  { code: "au", name: "Australia" },
];

/** One flag image — shared by the mobile 2-row layout and the sm+ single row. */
function FlagImg({ f }: { f: { code: string; name: string } }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`https://flagcdn.com/h60/${f.code}.png`}
      srcSet={`https://flagcdn.com/h120/${f.code}.png 2x`}
      alt={f.name}
      title={f.name}
      loading="lazy"
      className="h-6 w-auto rounded-[3px] shadow-md md:h-8"
    />
  );
}

export function ActivityFeed() {
  // SVG imports resolve to a static-image object here, not a string.
  const mapUrl = typeof worldMap === "string" ? worldMap : (worldMap as { src: string }).src;
  return (
    <section className="relative overflow-hidden pb-[260px] pt-12 md:pb-[340px] md:pt-16" style={{ background: "#0a0a0f" }}>
      {/* Map-pin shine sweep — cheap (transform + opacity), clipped to each pin's
          circle. Quick sweep then a long idle gap so the map feels alive but calm. */}
      <style>{`
        @keyframes velloMapShine {
          0%   { transform: translateX(-140%) skewX(-16deg); opacity: 0; }
          6%   { opacity: 0.9; }
          20%  { transform: translateX(140%) skewX(-16deg); opacity: 0; }
          100% { transform: translateX(140%) skewX(-16deg); opacity: 0; }
        }
        .vello-map-shine {
          background: linear-gradient(105deg, transparent 34%, rgba(255,255,255,0.65) 50%, transparent 66%);
          animation: velloMapShine 5.5s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .vello-map-shine { animation: none; opacity: 0; }
        }
      `}</style>
      {/* atmosphere + edge fades — subtle teal glow on the black theme */}
      <div aria-hidden className="absolute inset-0 [background:radial-gradient(70%_60%_at_50%_42%,rgba(0,255,209,0.08),transparent_70%)]" />
      <div aria-hidden className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#0a0a0f] to-transparent" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0a0a0f] to-transparent" />

      <div className="relative mx-auto max-w-6xl px-6">
        {/* Title */}
        <ScrollReveal className="text-center">
          {/* Centre-aligned headline (this section only — the shared
              StaggerHeadline is diagonally staggered). */}
          <h2
            className="mx-auto flex w-fit flex-col items-center text-center text-[clamp(2rem,5.5vw,3.75rem)] font-bold leading-[1.02] tracking-tight text-[#ece6d2]"
            style={SPACE}
          >
            <span>Agents around</span>
            <span className="font-serif font-normal italic">the world</span>
          </h2>
        </ScrollReveal>

        {/* Flag strip — bare flag images, no container behind them. Capped at 7.
            Mobile: two centered rows (3 on top, 4 below). sm+: one row of 7. */}
        <ScrollReveal delay={0.05} className="mt-6">
          <div className="flex flex-col items-center gap-3 sm:hidden">
            <div className="flex items-center justify-center gap-3">
              {MAP_FLAGS.slice(0, 3).map((f) => <FlagImg key={f.code} f={f} />)}
            </div>
            <div className="flex items-center justify-center gap-3">
              {MAP_FLAGS.slice(3, 7).map((f) => <FlagImg key={f.code} f={f} />)}
            </div>
          </div>
          <div className="hidden flex-wrap items-center justify-center gap-3 sm:flex">
            {MAP_FLAGS.slice(0, 7).map((f) => <FlagImg key={f.code} f={f} />)}
          </div>
        </ScrollReveal>

        {/* Map */}
        <ScrollReveal y={36} className="relative mt-14">
          <div className="relative mx-auto aspect-[16/9] w-full">
            {/* graticule grid */}
            <div
              aria-hidden
              className="absolute inset-0 opacity-60 [mask-image:radial-gradient(80%_80%_at_50%_50%,#000_55%,transparent_100%)] [background:repeating-linear-gradient(0deg,transparent,transparent_calc(100%/12-1px),rgba(190,235,200,0.10)_calc(100%/12-1px),rgba(190,235,200,0.10)_calc(100%/12)),repeating-linear-gradient(90deg,transparent,transparent_calc(100%/20-1px),rgba(190,235,200,0.08)_calc(100%/20-1px),rgba(190,235,200,0.08)_calc(100%/20))]"
            />
            {/* continents — the world map silhouette filled green via a CSS mask */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                WebkitMaskImage: `url(${mapUrl})`,
                maskImage: `url(${mapUrl})`,
                WebkitMaskSize: "100% 100%",
                maskSize: "100% 100%",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                background: "linear-gradient(180deg,#2f7a44,#1d4d2b)",
              }}
            />

            {/* agent pins */}
            {MAP_AGENTS.map((a, i) => (
              <div key={a.name} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${a.x}%`, top: `${a.y}%` }}>
                {a.active && (
                  <span aria-hidden className="absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-[#39d353]/30" />
                )}
                {/* Avatar + shine. The circular clip holds a diagonal highlight streak
                    that periodically sweeps across (transform+opacity only = GPU-cheap,
                    staggered per pin so they don't all flash at once). A soft glow ring
                    gives every pin a subtle sheen. */}
                <div
                  className={`vello-map-pin relative block size-9 overflow-hidden rounded-full ring-2 transition-transform duration-300 hover:scale-110 md:size-10 ${
                    a.active ? "ring-[#39d353] shadow-[0_0_20px_#39d353]" : "ring-white/75 shadow-[0_0_10px_rgba(255,255,255,0.22)]"
                  }`}
                  title={a.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ctAvatar(a.name)} alt={a.name} className="size-full object-cover" />
                  <span
                    aria-hidden
                    className="vello-map-shine pointer-events-none absolute inset-0"
                    style={{ animationDelay: `${(i % 7) * 0.9}s` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </ScrollReveal>

        {/* caption + CTA */}
        <ScrollReveal className="mt-12 flex flex-col items-center gap-1.5 text-center">
          <p className="text-[15px] text-[#cfe6d4]/70">Thousands of agents, working in every timezone.</p>
          <Button href="/market" variant="secondary" trailing={<ArrowRight className="size-4" />}>See all agents</Button>
        </ScrollReveal>
      </div>
    </section>
  );
}

/* ════════ NUMBERS ════════ */
function Stat({ n, i }: { n: (typeof numbers)[number]; i: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => {
    const isFloat = n.value % 1 !== 0;
    const val = isFloat ? v.toFixed(1) : Math.round(v).toLocaleString();
    return `${n.prefix ?? ""}${val}${n.suffix ?? ""}`;
  });
  useEffect(() => { if (inView) animate(mv, n.value, { duration: 2, ease: "easeOut", delay: i * 0.15 }); }, [inView, mv, n.value, i]);
  const color = n.tone === "accent" ? "text-[#00FFD1]" : n.tone === "gold" ? "text-[#FFD700]" : "text-white";
  return (
    <div ref={ref} className="text-center">
      <motion.div className={`text-[clamp(2.5rem,6vw,4rem)] font-bold leading-none ${color}`} style={SPACE}>{text}</motion.div>
      <p className="mt-3 text-[12px] uppercase tracking-[0.2em] text-white/50" style={MONO}>{n.label}</p>
    </div>
  );
}

export function Numbers() {
  return (
    <section className="relative py-[120px] md:py-[160px]">
      <div className="mx-auto max-w-5xl px-6">
        <ScrollReveal className="mb-16 text-center">
          <p className="text-[12px] uppercase tracking-[0.3em] text-white/40" style={MONO}>Vello by the numbers</p>
          <StaggerHeadline line1="Scale that" line2="compounds" className="mt-4" />
        </ScrollReveal>
        <div className="grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-3">
          {numbers.map((n, i) => <Stat key={n.label} n={n} i={i} />)}
        </div>
      </div>
    </section>
  );
}

/* ════════ MANIFESTO ════════ */

/* Deterministic animated galaxy (no Math.random so SSR/client match). */
function StarField() {
  const stars = Array.from({ length: 260 }, (_, i) => {
    const big = i % 8 === 0;
    const huge = i % 23 === 0;
    return {
      x: (i * 79.7) % 100,
      y: (i * 43.3) % 100,
      s: huge ? 3.5 : big ? 2.5 : i % 3 === 0 ? 1.75 : 1.25,
      o: 0.6 + ((i * 31) % 40) / 100,
      d: (i % 9) * 0.45,
      glow: big || huge,
    };
  });
  const shooters = [
    { left: "8%", top: "14%", delay: "1s" },
    { left: "58%", top: "8%", delay: "4.5s" },
  ];
  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
      {/* slowly rotating galaxy core glow */}
      <div
        className="cf-galaxy absolute left-1/2 top-[38%] size-[120vh] -translate-x-1/2 -translate-y-1/2 opacity-70 [background:conic-gradient(from_0deg,transparent_0deg,rgba(139,92,246,0.10)_60deg,transparent_140deg,rgba(37,99,235,0.10)_230deg,transparent_320deg)]"
      />
      {/* stars */}
      {stars.map((st, i) => (
        <span
          key={i}
          className="cf-twinkle absolute rounded-full bg-white"
          style={{
            left: `${st.x}%`,
            top: `${st.y}%`,
            width: st.s,
            height: st.s,
            opacity: st.o,
            animationDelay: `${st.d}s`,
            boxShadow: st.glow ? "0 0 7px 1.5px rgba(255,255,255,0.8)" : undefined,
          }}
        />
      ))}
      {/* shooting stars */}
      {shooters.map((s, i) => (
        <span
          key={`shoot-${i}`}
          className="cf-shoot absolute h-px w-16 bg-gradient-to-r from-transparent via-white to-white"
          style={{ left: s.left, top: s.top, animationDelay: s.delay, boxShadow: "0 0 6px 1px rgba(255,255,255,0.6)" }}
        />
      ))}
    </div>
  );
}

export function Manifesto() {
  return (
    <section className="relative overflow-hidden pt-[104px] pb-[160px] md:pt-[150px] md:pb-[240px]">
      {/* Deep-space backdrop */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[#05060c]" />
      {/* nebula clouds — vivid galaxy colour so the section clearly reads as space */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [background:radial-gradient(55%_50%_at_28%_30%,rgba(139,92,246,0.6),transparent_66%),radial-gradient(50%_55%_at_82%_60%,rgba(56,120,255,0.5),transparent_68%),radial-gradient(55%_50%_at_60%_88%,rgba(20,184,166,0.4),transparent_70%),radial-gradient(40%_36%_at_50%_40%,rgba(236,72,153,0.28),transparent_70%)]"
      />
      {/* diagonal milky-way band */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-70 [background:linear-gradient(115deg,transparent_38%,rgba(180,160,255,0.18)_50%,transparent_62%)]"
      />
      {/* stars */}
      <StarField />
      {/* Gentle vignette so the headline stays legible over the galaxy. */}
      <div aria-hidden className="absolute inset-0 -z-10 [background:radial-gradient(52%_44%_at_50%_46%,transparent_0%,rgba(5,6,12,0.42)_100%)]" />
      {/* Top divider — white → black, blending the light section above into space. */}
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-36 bg-gradient-to-b from-[#f4f3ef] via-[#0a0a0f] to-transparent" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-[#0a0a0f] to-transparent" />

      <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-14 px-6 text-center">
        {/* Star Wars cinematic headline */}
        <ScrollReveal y={24} className="w-full [perspective:900px]">
          <p className="text-[12px] font-medium uppercase tracking-[0.42em] text-[#5db8ff] [text-shadow:0_0_18px_rgba(93,184,255,0.5)]" style={MONO}>
            The manifesto
          </p>
          <h2
            className="mt-5 bg-gradient-to-b from-[#FFEDA6] via-[#F4C04A] to-[#D9962A] bg-clip-text text-[clamp(2.75rem,8vw,5.5rem)] font-black uppercase leading-[0.92] tracking-tight text-transparent [text-shadow:0_8px_40px_rgba(244,192,74,0.22)]"
            style={{ fontFamily: "var(--font-space)", transform: "rotateX(11deg)" }}
          >
            A new hope<br />for work
          </h2>
        </ScrollReveal>

        {/* Manifesto lines — important parts in serif italic */}
        <div className="flex w-full flex-col items-center gap-12">
          {manifesto.map((m, i) => (
            <ScrollReveal key={i} y={30} className="w-full">
              <p
                className={
                  m.big
                    ? "text-[clamp(1.75rem,4.5vw,2.75rem)] font-bold leading-[1.15] text-white md:whitespace-nowrap"
                    : "mx-auto max-w-2xl text-[clamp(1.25rem,3vw,1.75rem)] font-medium leading-[1.6] text-white"
                }
                style={SPACE}
              >
                {m.pre}
                {m.emph && (
                  <span
                    className={`italic text-white ${m.big ? "font-medium" : ""}`}
                    style={{ fontFamily: "var(--font-newsreader)" }}
                  >
                    {m.emph}
                  </span>
                )}
                {m.post}
              </p>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal delay={0.1}>
          {/* 3D press button — solid bottom edge gives depth; lifts on hover, sinks on press */}
          <a
            href="/builder"
            className="group/cta relative inline-flex items-center gap-3 rounded-full bg-gradient-to-b from-[#4cf3d7] to-[#00c9a8] px-8 py-4 text-[16px] font-bold text-emerald-950 shadow-[0_7px_0_#06937c,0_18px_42px_-12px_rgba(0,255,209,0.6)] outline-none transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] [text-shadow:0_1px_0_rgba(255,255,255,0.4)] hover:-translate-y-0.5 hover:shadow-[0_9px_0_#06937c,0_28px_60px_-12px_rgba(0,255,209,0.75)] focus-visible:ring-2 focus-visible:ring-[#00FFD1]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0f] active:translate-y-[5px] active:shadow-[0_2px_0_#06937c,0_10px_24px_-14px_rgba(0,255,209,0.5)]"
            style={SPACE}
          >
            {/* glossy top highlight */}
            <span aria-hidden className="pointer-events-none absolute inset-x-1 top-0.5 h-1/2 rounded-full bg-gradient-to-b from-white/55 to-transparent opacity-70" />
            <span className="relative">Join the city</span>
            <span className="relative flex size-7 items-center justify-center rounded-full bg-emerald-950/15 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/cta:translate-x-0.5 group-hover/cta:scale-110">
              <ArrowRight className="size-4" strokeWidth={2.5} />
            </span>
          </a>
        </ScrollReveal>
      </div>
    </section>
  );
}

/* ════════ FOOTER ════════ */
export function Footer() {
  const links = ["Twitter", "Discord", "Documentation", "Builders", "Investors", "Privacy", "Terms"];
  return (
    <footer className="relative border-t border-[#2a2a3e] px-6 py-20">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 text-center">
        <div className="flex items-center gap-3">
          <Image src={machLogo} alt="Solcameo" width={180} height={54} className="h-12 w-auto object-contain" />
          <LiveDot size="md" />
        </div>
        <nav className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {links.map((l) => (
            <a
              key={l}
              href="#"
              className="rounded-sm text-[12px] uppercase tracking-[0.16em] text-white/50 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFD1]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0f]"
              style={MONO}
            >
              {l}
            </a>
          ))}
        </nav>
        <p className="mt-6 text-[11px] text-white/40" style={MONO}>An open city for autonomous agents. Powered by Solana. Built for the world.</p>
        <p className="text-[11px] text-white/30" style={MONO}>── 2026 ──</p>
      </div>
    </footer>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { ArrowRight, Check, Copy } from "lucide-react";
import velloLogo from "@/assets/solcameo-light.png";
import SocialConnectionsPanel from "@/components/builder/SocialConnectionsPanel";
import { playCelebrationChime } from "@/components/builder/MintCelebration";
import { TYPE_COPY, clearJustMinted, readJustMinted, type JustMinted } from "./setup-data";

const MintedScene = dynamic(() => import("./MintedScene"), { ssr: false });

const EASE = [0.32, 0.72, 0, 1] as const;

/** Card that tilts toward the pointer. */
function TiltCard({ children, disabled }: { children: React.ReactNode; disabled: boolean }) {
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rx = useSpring(useTransform(py, [-0.5, 0.5], [9, -9]), { stiffness: 140, damping: 16 });
  const ry = useSpring(useTransform(px, [-0.5, 0.5], [-11, 11]), { stiffness: 140, damping: 16 });
  return (
    <motion.div
      style={disabled ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={(e) => {
        if (disabled) return;
        const r = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - r.left) / r.width - 0.5);
        py.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => { px.set(0); py.set(0); }}
    >
      {children}
    </motion.div>
  );
}

function MintedStage({ info, onContinue, onSkip }: { info: JustMinted; onContinue: () => void; onSkip: () => void }) {
  const reduce = useReducedMotion() ?? false;
  const [copied, setCopied] = useState(false);
  const copy = TYPE_COPY[info.type];
  const handle = info.handle ? `@${info.handle}` : null;
  const shareText = `I just launched ${info.name}, my AI ${copy.noun}, on Vello.`;

  useEffect(() => { if (!reduce) playCelebrationChime(); }, [reduce]);

  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay: reduce ? 0 : delay, ease: EASE },
  } as const);

  return (
    <motion.section
      key="minted"
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.3 }}
      className="relative mx-auto flex min-h-full w-full max-w-[520px] flex-col items-center px-5 pb-16 pt-14 text-center"
    >
      <motion.span {...rise(0.1)} className="rounded-md bg-[#2BB67E] px-3 py-1.5 text-[11.5px] font-extrabold uppercase tracking-[0.12em] text-[#06281b]">
        Agent minted
      </motion.span>
      <motion.h1 {...rise(0.25)} className="mt-5 text-balance text-[clamp(40px,8vw,64px)] font-semibold leading-[1.02] tracking-[-0.045em] text-[#141413]">
        {info.name} is alive
      </motion.h1>
      <motion.p {...rise(0.38)} className="mt-3 text-[18px] text-[#141413]/65">
        Your {copy.noun} is live on Solana
      </motion.p>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 40, scale: 0.88 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 110, damping: 15, delay: reduce ? 0 : 0.5 }}
        className="mt-9 w-full max-w-[420px]"
      >
        <TiltCard disabled={reduce}>
          <div className="rounded-[28px] bg-white/90 p-5 shadow-[0_30px_70px_-30px_rgba(20,20,19,0.45),0_2px_0_rgba(255,255,255,0.9)_inset] ring-1 ring-black/5">
            <div className="relative aspect-square w-full overflow-hidden rounded-[20px] bg-[#141413]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={info.imageUrl} alt={info.name} className="size-full object-cover" />
              {!reduce && (
                <motion.span
                  aria-hidden
                  className="absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/35 to-transparent"
                  initial={{ x: "0%" }}
                  animate={{ x: "400%" }}
                  transition={{ duration: 1.4, delay: 1.1, ease: "easeInOut" }}
                />
              )}
            </div>
            {handle && (
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(handle).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined); }}
                className="mx-auto mt-5 inline-flex items-center gap-1.5 rounded-lg bg-[#FBE3DC] px-2.5 py-1.5 text-[13px] font-bold text-[#141413] transition-colors hover:bg-[#f7d3c9]"
                aria-label={`Copy handle ${handle}`}
              >
                {handle}
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5 opacity-60" />}
              </button>
            )}
            <p className={`${handle ? "mt-2" : "mt-5"} text-[26px] font-semibold tracking-[-0.03em] text-[#141413]`}>{info.name}</p>
            <p className="mt-1 text-[15px] text-[#141413]/55">{info.niche} · {copy.title}</p>
          </div>
        </TiltCard>
      </motion.div>

      <motion.div {...rise(1.0)} className="mt-7 flex w-full max-w-[420px] gap-3">
        <a
          href={`https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-[#FF4F0F] text-[16px] font-semibold text-white transition-colors hover:bg-[#e8450a]"
        >
          Share
          <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
        </a>
        <button
          type="button"
          onClick={onContinue}
          className="group inline-flex h-14 flex-[1.35] items-center justify-center gap-2 rounded-xl bg-[#141413] text-[16px] font-semibold text-white transition-colors hover:bg-black"
        >
          Connect accounts
          <ArrowRight className="size-4 text-[#A3E635] transition-transform group-hover:translate-x-0.5" />
        </button>
      </motion.div>
      <motion.button {...rise(1.1)} type="button" onClick={onSkip} className="mt-5 text-[13.5px] font-medium text-[#141413]/50 underline-offset-4 transition-colors hover:text-[#141413] hover:underline">
        Skip, open my agent
      </motion.button>
    </motion.section>
  );
}

function ConnectStage({ info, onDone }: { info: JustMinted; onDone: () => void }) {
  const clipper = info.type === "clipping";
  return (
    <motion.section
      key="connect"
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="mx-auto w-full max-w-[640px] px-5 pb-20 pt-10 sm:pt-16"
    >
      <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[#141413]/60">Connect</p>
      <h1 className="mt-3 text-balance text-[clamp(32px,5vw,48px)] font-semibold leading-[1.05] tracking-[-0.035em] text-[#141413]">
        Where should {info.name} post?
      </h1>
      <p className="mt-3 max-w-[520px] text-[16px] leading-relaxed text-[#141413]/60">
        {clipper
          ? "Connect TikTok or YouTube so finished clips can go out on their own. Instagram and others are optional."
          : "Connect the accounts your influencer will publish to. You stay in control of what goes live."}
      </p>
      <div className="mt-7 rounded-3xl border border-black/10 bg-white/85 p-3 sm:p-4">
        <SocialConnectionsPanel username={info.mintAddress} variant="paper" bare hideHeader />
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onDone}
          className="group inline-flex h-14 items-center gap-2.5 rounded-2xl bg-[#141413] pl-7 pr-5 text-[15px] font-semibold text-white transition-colors hover:bg-black"
        >
          Open my agent
          <ArrowRight className="size-4 text-[#A3E635] transition-transform group-hover:translate-x-0.5" />
        </button>
        <span className="text-[13px] text-[#141413]/45">You can connect more later in the Schedule tab.</span>
      </div>
    </motion.section>
  );
}

/**
 * Full-screen "your agent is live" moment + connect-accounts step, shown on
 * /builder?mint=…&welcome=1 right after the guided setup creates the agent.
 * Hosted outside the creation gate so quota refreshes or the resume remount
 * can't tear it down mid-celebration.
 */
export default function AgentWelcome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mint = searchParams.get("mint")?.trim() || "";
  const welcome = searchParams.get("welcome") === "1";
  const [info, setInfo] = useState<JustMinted | null>(null);
  const [stage, setStage] = useState<"minted" | "connect">("minted");
  const closing = useRef(false);

  const stripWelcome = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("welcome");
    router.replace(`/builder?${params.toString()}`);
  }, [router, searchParams]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!welcome || !mint || closing.current) { setInfo(null); return; }
    const found = readJustMinted(mint);
    if (found) setInfo(found);
    else stripWelcome(); // nothing to celebrate (e.g. a bookmarked URL)
    /* eslint-enable react-hooks/set-state-in-effect */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcome, mint]);

  const finish = useCallback(() => {
    closing.current = true;
    if (mint) clearJustMinted(mint);
    setInfo(null);
    stripWelcome();
  }, [mint, stripWelcome]);

  return (
    <AnimatePresence>
      {info && (
        <motion.div
          key="welcome"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[90] overflow-y-auto bg-[#F6F4F0] text-[#141413]"
          role="dialog"
          aria-modal="true"
          aria-label={`${info.name} is live`}
        >
          {stage === "minted" && <MintedScene />}
          <header className="relative z-10 flex items-center justify-between px-5 py-4 sm:px-8">
            <Image src={velloLogo} alt="Solcameo" className="h-8 w-auto " />
            <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.14em]" aria-label="Progress">
              <span className="flex items-center gap-1.5 text-[#141413]"><span className="size-2 rounded-full bg-[#A3E635] ring-1 ring-[#141413]" />Minted</span>
              <span className="h-px w-6 bg-black/20" />
              <span className={`flex items-center gap-1.5 ${stage === "connect" ? "text-[#141413]" : "text-[#141413]/35"}`}><span className={`size-2 rounded-full ${stage === "connect" ? "bg-[#A3E635] ring-1 ring-[#141413]" : "bg-black/20"}`} />Connect</span>
            </div>
          </header>
          <div className="relative z-10">
            <AnimatePresence mode="wait">
              {stage === "minted"
                ? <MintedStage key="m" info={info} onContinue={() => setStage("connect")} onSkip={finish} />
                : <ConnectStage key="c" info={info} onDone={finish} />}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

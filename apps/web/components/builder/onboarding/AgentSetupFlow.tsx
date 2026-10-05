"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ArrowRight, Check, ChevronLeft, ChevronRight, Dices, ImagePlus, Loader2, RefreshCw, Shuffle, Wallet, X } from "lucide-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import velloLogo from "@/assets/solcameo-light.png";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSiwsSession } from "@/hooks/use-siws-session";
import { classifyMintError } from "@/lib/builder/mintErrors";
import { Chip, OptionCard, Select, Stagger, itemVariants } from "./setup-ui";
import { GuideDot } from "./guide-dot";
import { PixelIcon } from "./pixel-icons";
import { AVATAR_STYLES, PALETTES, avatarDataUri, avatarPng, defaultPaletteId, type AvatarStyleId } from "./avatar-art";
import {
  CLIP_LENGTHS, CLIP_PLATFORMS, LANGUAGES, NAME_MAX, NICHES, OTHER_NICHE, STEP_LABEL, TYPE_COPY, VOICES,
  buildBlueprint, nameProblem, nameReady, slugHandle, stashJustMinted, stepsFor, suggestNames,
  type ClipLengthId, type SetupAgentType, type StepId, type Voice,
} from "./setup-data";

const EASE = [0.32, 0.72, 0, 1] as const;
const DRAFT_KEY = "vello:setup-draft:v1";

interface Draft {
  type: SetupAgentType | null;
  niche: string;
  customNiche: string;
  name: string;
  voice: Voice;
  language: string;
  clipLength: ClipLengthId;
  platforms: string[];
  avatarStyle: AvatarStyleId;
  palette: string;
  seed: number;
  stepId: StepId;
}

const EMPTY: Draft = {
  type: null, niche: "", customNiche: "", name: "", voice: "friend", language: "English",
  clipLength: "standard", platforms: ["tiktok", "instagram", "youtube"], avatarStyle: "critter", palette: "", seed: 1, stepId: "type",
};

function loadDraft(): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? ({ ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) }) : null;
  } catch { return null; }
}

/** Centre-crop a photo to a square JPEG so it can be used as the avatar as is. */
async function squarePhoto(file: File, size = 768): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Couldn't read that file."));
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("That image couldn't be opened."));
    el.src = dataUrl;
  });
  const side = Math.min(img.width, img.height);
  const out = Math.min(size, side);
  const canvas = document.createElement("canvas");
  canvas.width = out; canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
  return canvas.toDataURL("image/jpeg", 0.9);
}

const GuideCtx = createContext<{ happy: boolean; dir: number; stepKey: string }>({ happy: false, dir: 1, stepKey: "" });

/** Step shell: eyebrow with the guide dot, headline, helper line, body. */
function StepFrame({ eyebrow, title, hint, children }: { eyebrow: string; title: string; hint?: string; children: ReactNode }) {
  const g = useContext(GuideCtx);
  return (
    <div>
      <p className="flex items-center gap-2.5 text-[12px] font-semibold uppercase tracking-[0.2em] text-[#141413]/60">
        <GuideDot happy={g.happy} dir={g.dir} stepKey={g.stepKey} />
        {eyebrow}
      </p>
      <motion.h1
        initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.5, ease: EASE, delay: 0.05 }}
        className="mt-3 text-balance text-[clamp(32px,5vw,52px)] font-semibold leading-[1.05] tracking-[-0.035em] text-[#141413]"
      >
        {title}
      </motion.h1>
      {hint && (
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE, delay: 0.14 }} className="mt-3 max-w-[560px] text-pretty text-[16px] leading-relaxed text-[#141413]/60">
          {hint}
        </motion.p>
      )}
      <div className="mt-8">{children}</div>
    </div>
  );
}

export interface AgentSetupFlowProps {
  /** Type already chosen via ?type= — the type step is skipped. */
  initialType: SetupAgentType | null;
  /** Extra query params (`&q=…`) appended to the agent URL once it is created, so a
   *  queued clip request survives onboarding. */
  carry?: string;
  /** Short label of the queued link, shown in the header. */
  queuedLabel?: string;
}

export default function AgentSetupFlow({ initialType, carry = "", queuedLabel }: AgentSetupFlowProps) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { publicKey } = useUnifiedSolanaWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  const { ensureSiwsSession } = useSiwsSession();

  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY, type: initialType, stepId: initialType ? "niche" : "type" });
  const patch = useCallback((p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p })), []);

  // Restore an in-progress draft (survives refresh or a wallet-connect redirect).
  useEffect(() => {
    const saved = loadDraft();
    /* eslint-disable react-hooks/set-state-in-effect */
    if (saved) {
      const type = initialType ?? saved.type;
      setDraft({ ...saved, type, stepId: type ? (saved.stepId === "type" ? "niche" : saved.stepId) : "type" });
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore */ }
  }, [draft, hydrated]);

  const { type, stepId } = draft;
  const niche = draft.niche === OTHER_NICHE ? draft.customNiche.trim() : draft.niche;
  const steps = useMemo(() => stepsFor(type, !initialType), [type, initialType]);
  const stepIdx = Math.max(0, steps.indexOf(stepId));
  const [dir, setDir] = useState(1);

  // Avatar step: drawn locally (no image model), or the user's own photo as is.
  const [refPhoto, setRefPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [dice, setDice] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  // Name step
  const [seed, setSeed] = useState(1);
  const suggestions = useMemo(() => (type && niche ? suggestNames(type, niche, seed) : []), [type, niche, seed]);

  // Launch step
  const [launch, setLaunch] = useState<"idle" | "working" | "error" | "limit">("idle");
  const [launchStage, setLaunchStage] = useState<"signin" | "image" | "create" | "finish">("signin");
  const [launchError, setLaunchError] = useState("");
  const [sessionId] = useState(() => crypto.randomUUID());

  const goTo = useCallback((next: StepId, direction: number) => {
    setDir(direction);
    patch({ stepId: next });
    window.scrollTo?.({ top: 0 });
  }, [patch]);

  const next = useCallback(() => { const n = steps[stepIdx + 1]; if (n) goTo(n, 1); }, [steps, stepIdx, goTo]);
  const back = useCallback(() => { const p = steps[stepIdx - 1]; if (p) goTo(p, -1); }, [steps, stepIdx, goTo]);

  const restart = () => {
    try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setDraft({ ...EMPTY, type: initialType, stepId: initialType ? "niche" : "type" });
    setRefPhoto(null); setPhotoError(""); setLaunch("idle");
  };

  // ── Avatar ─────────────────────────────────────────────────────────────────
  const paletteId = draft.palette || defaultPaletteId(niche || "vello");
  const avatarSpec = useMemo(
    () => ({ style: draft.avatarStyle, palette: paletteId, seed: draft.seed, name: draft.name.trim() || "Vello" }),
    [draft.avatarStyle, paletteId, draft.seed, draft.name],
  );
  const avatarSrc = useMemo(() => refPhoto ?? avatarDataUri(avatarSpec), [refPhoto, avatarSpec]);

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setPhotoError("Please choose an image file."); return; }
    try { setRefPhoto(await squarePhoto(file)); setPhotoError(""); }
    catch (e) { setPhotoError(e instanceof Error ? e.message : "Couldn't read that photo."); }
  };

  // ── Create ─────────────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!type || launch === "working") return;
    if (!publicKey) { openWalletModal(true); return; }
    const wallet = publicKey.toBase58();
    setLaunch("working"); setLaunchError(""); setLaunchStage("signin");
    try {
      const session = await ensureSiwsSession();
      if (!session) throw new Error("Connect your wallet to create your agent.");

      // Host the image (the mint API only keeps http(s) URLs). An uploaded photo is
      // used as is; otherwise the locally drawn avatar is rasterised. No credits spent.
      setLaunchStage("image");
      const chosen = refPhoto ?? await avatarPng(avatarSpec);
      const answers = {
        type, name: draft.name, niche, language: draft.language, voice: draft.voice, clipLength: draft.clipLength,
        platforms: draft.platforms, lookStyle: refPhoto ? "photo" : draft.avatarStyle, imageUrl: chosen,
      };
      let hosted = "";
      try {
        const saved = await fetch("/api/nft/save-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionId,
            creatorWallet: wallet,
            name: draft.name.trim(),
            handle: slugHandle(draft.name),
            niche: niche || "lifestyle",
            avatarDataUris: [chosen],
          }),
        });
        if (saved.ok) {
          const data = (await saved.json()) as { avatarUrls?: string[] };
          if (data.avatarUrls?.[0]) hosted = data.avatarUrls[0];
        }
      } catch { /* fall through with the generator URL if it was http */ }
      if (!hosted) throw new Error("Couldn't save the image. Please try again.");
      answers.imageUrl = hosted;

      setLaunchStage("create");
      const res = await fetch("/api/nft/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId,
          txSignature: `free_promo_${sessionId.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          creatorWallet: wallet,
          agentBlueprint: buildBlueprint(answers),
          avatarUrls: [hosted],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { mintAddress?: string; error?: string; limitReached?: boolean };
      if (!res.ok || data.error) {
        if (data.limitReached) { setLaunch("limit"); return; }
        throw new Error(data.error ?? "Couldn't create the agent.");
      }
      if (!data.mintAddress) throw new Error("Creation returned no agent address. Please retry.");

      setLaunchStage("finish");
      stashJustMinted({
        mintAddress: data.mintAddress, type, name: draft.name.trim(), handle: slugHandle(draft.name), niche, imageUrl: hosted,
      });
      try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      window.dispatchEvent(new Event("agents-changed"));
      router.replace(`/builder?mint=${encodeURIComponent(data.mintAddress)}&type=${type}&welcome=1${carry}`);
    } catch (e) {
      setLaunchError(classifyMintError(e).message);
      setLaunch("error");
    }
  }, [type, launch, publicKey, openWalletModal, ensureSiwsSession, draft, niche, router, sessionId, refPhoto, avatarSpec, carry]);

  // ── Per-step readiness ─────────────────────────────────────────────────────
  const ready: Record<StepId, boolean> = {
    type: !!type,
    niche: niche.length >= 2,
    name: nameReady(draft.name),
    clips: draft.platforms.length > 0,
    voice: !!draft.language,
    look: true,
    launch: false,
  };
  const canNext = ready[stepId];

  // Enter advances (never inside textareas or open dropdowns).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.defaultPrevented) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT") return;
      if (stepId !== "launch" && canNext && stepId !== "look") { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepId, canNext, next]);

  if (!hydrated) {
    return <div className="fixed inset-0 z-[70] bg-[#F6F4F0]" />;
  }

  const copy = type ? TYPE_COPY[type] : null;
  const nm = draft.name.trim();
  const problem = nameProblem(draft.name);

  const body: Record<StepId, ReactNode> = {
    type: (
      <StepFrame eyebrow="Create" title="What are you building?" hint="Pick one to start. You can build the other later.">
        <Stagger role="radiogroup" aria-label="Agent type" className="grid gap-3 sm:grid-cols-2">
          {(["clipping", "influencer"] as const).map((t) => (
            <OptionCard key={t} selected={type === t} onClick={() => patch({ type: t })} title={TYPE_COPY[t].title} blurb={TYPE_COPY[t].tagline} className="min-h-[168px]">
              <span className="mt-auto pt-5 text-[13px] leading-snug text-[#141413]/50">{TYPE_COPY[t].detail}</span>
            </OptionCard>
          ))}
        </Stagger>
      </StepFrame>
    ),
    niche: (
      <StepFrame eyebrow="Niche" title={type === "clipping" ? "What will it clip?" : "What is it about?"} hint="Pick the closest topic. This steers hooks, captions and what it posts.">
        <Select
          label="Niche"
          value={draft.niche}
          onChange={(v) => patch({ niche: v })}
          options={[...NICHES, OTHER_NICHE]}
          placeholder="Choose a niche"
          searchPlaceholder="Search niches"
        />
        {draft.niche === OTHER_NICHE && (
          <motion.input
            initial={reduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            autoFocus
            value={draft.customNiche}
            maxLength={40}
            onChange={(e) => patch({ customNiche: e.target.value })}
            placeholder="Describe it in a few words"
            aria-label="Custom niche"
            className="mt-3 h-14 w-full rounded-2xl border border-black/12 bg-white/80 px-5 text-[16px] text-[#141413] outline-none placeholder:text-[#141413]/35 focus:border-[#141413]"
          />
        )}
      </StepFrame>
    ),
    name: (
      <StepFrame eyebrow="Name" title="Name your agent" hint={copy?.nameHint}>
        <label htmlFor="agent-name" className="sr-only">Agent name</label>
        <input
          id="agent-name"
          autoFocus
          value={draft.name}
          maxLength={NAME_MAX}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder={type === "clipping" ? "e.g. FinanceClips" : "e.g. Aria Vale"}
          aria-invalid={!!problem}
          aria-describedby="agent-name-help"
          className={`h-16 w-full rounded-2xl border bg-white/80 px-5 text-[22px] font-medium tracking-tight text-[#141413] outline-none placeholder:text-[#141413]/30 focus:border-[#141413] ${problem ? "border-red-400" : "border-black/12"}`}
        />
        <p id="agent-name-help" className={`mt-2 min-h-5 text-[13px] ${problem ? "text-red-600" : "text-[#141413]/45"}`}>
          {problem ?? (nm ? (slugHandle(nm) ? `Handle: @${slugHandle(nm)}` : "") : "Required. This is what shows on your agent card.")}
        </p>
        <div className="mt-5 flex items-center justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#141413]/45">Ideas for {niche}</p>
          <button type="button" onClick={() => setSeed((s) => s + 1)} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-[#141413]/70 transition-colors hover:bg-black/5 hover:text-[#141413]">
            <Shuffle className="size-3.5" /> Shuffle
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <Chip key={s} selected={nm === s} onClick={() => patch({ name: s })}>{s}</Chip>
          ))}
        </div>
      </StepFrame>
    ),
    clips: (
      <StepFrame eyebrow="Clips" title="How should the clips look?" hint="Pick a length and where they are headed. You can change both later.">
        <Stagger role="radiogroup" aria-label="Clip length" className="grid gap-3 sm:grid-cols-3">
          {CLIP_LENGTHS.map((l) => (
            <OptionCard key={l.id} selected={draft.clipLength === l.id} onClick={() => patch({ clipLength: l.id })} title={l.title} blurb={l.blurb} />
          ))}
        </Stagger>
        <p className="mb-2.5 mt-8 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#141413]/45">Post to</p>
        <Stagger delay={0.25} className="grid grid-cols-3 gap-3">
          {CLIP_PLATFORMS.map((pl) => {
            const on = draft.platforms.includes(pl.id);
            return (
              <motion.button
                key={pl.id}
                type="button"
                aria-pressed={on}
                variants={itemVariants}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.94 }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
                onClick={() => patch({ platforms: on ? draft.platforms.filter((x) => x !== pl.id) : [...draft.platforms, pl.id] })}
                className={`relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl border px-3 pb-3.5 pt-5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141413]/60 ${on ? "border-[#141413] bg-[#141413] text-white" : "border-black/12 bg-white/70 text-[#141413] hover:border-black/30 hover:bg-white"}`}
              >
                <span className="absolute inset-0 opacity-[0.07]" aria-hidden style={{ backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)", backgroundSize: "8px 8px" }} />
                <motion.span animate={on ? { rotate: [0, -8, 8, 0], scale: [1, 1.15, 1] } : { rotate: 0, scale: 1 }} transition={{ duration: 0.45 }} className={`relative ${on ? "text-[#A3E635]" : ""}`}>
                  <PixelIcon id={pl.id} className="size-11" twinkle={on} />
                </motion.span>
                <span className="relative text-[13.5px] font-semibold">{pl.label}</span>
                <span className={`relative grid size-5 place-items-center rounded-full border ${on ? "border-[#A3E635] bg-[#A3E635]" : "border-black/20"}`}>
                  {on && <Check className="size-3 text-[#141413]" strokeWidth={3.5} />}
                </span>
              </motion.button>
            );
          })}
        </Stagger>
        <p className="mt-3 text-[13px] text-[#141413]/45">You will connect the accounts right after your agent is created.</p>
      </StepFrame>
    ),
    voice: (
      <StepFrame eyebrow="Voice" title="How does it sound?" hint="Choose a personality and the language it speaks.">
        <Stagger role="radiogroup" aria-label="Voice" className="grid gap-3 sm:grid-cols-2">
          {VOICES.map((v) => (
            <OptionCard key={v.id} selected={draft.voice === v.id} onClick={() => patch({ voice: v.id })} title={v.title} blurb={v.blurb} />
          ))}
        </Stagger>
        <p className="mb-2.5 mt-8 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#141413]/45">Language</p>
        <Select label="Language" value={draft.language} onChange={(v) => patch({ language: v })} options={LANGUAGES} searchPlaceholder="Search languages" />
      </StepFrame>
    ),
    look: (
      <StepFrame
        eyebrow="Profile picture"
        title="Give it a profile picture"
        hint="Pick a style and colours and we draw it for you, free. Or upload a photo and we use it as is."
      >
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_250px]">
          <div className="order-2 flex flex-col gap-6 sm:order-1">
            <Stagger role="radiogroup" aria-label="Style" className="grid gap-3 sm:grid-cols-3">
              {AVATAR_STYLES.map((st) => (
                <OptionCard key={st.id} selected={!refPhoto && draft.avatarStyle === st.id} onClick={() => { setRefPhoto(null); patch({ avatarStyle: st.id }); }} title={st.title} blurb={st.blurb} disabled={!!refPhoto && false}>
                  <span className="relative mt-3 block aspect-square w-full overflow-hidden rounded-xl bg-[#141413]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={avatarDataUri({ ...avatarSpec, style: st.id })} alt="" className="size-full object-cover" />
                  </span>
                </OptionCard>
              ))}
            </Stagger>

            <div>
              <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#141413]/45">Colours</p>
              <Stagger role="radiogroup" aria-label="Colours" className="flex flex-wrap gap-2.5" delay={0.2}>
                {PALETTES.map((pa) => {
                  const on = paletteId === pa.id;
                  return (
                    <motion.button
                      key={pa.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={pa.label}
                      title={pa.label}
                      variants={itemVariants}
                      whileHover={{ scale: 1.15, y: -2 }}
                      whileTap={{ scale: 0.88 }}
                      onClick={() => { setRefPhoto(null); patch({ palette: pa.id }); }}
                      className="relative size-10 rounded-full"
                    >
                      <span className="absolute inset-0 rounded-full ring-1 ring-black/10" style={{ background: `linear-gradient(135deg, ${pa.bg[0]}, ${pa.bg[1]})` }} />
                      <span className="absolute inset-[9px] rounded-full" style={{ background: pa.body }} />
                      {on && <motion.span layoutId="palette-ring" className="absolute -inset-[3px] rounded-full border-2 border-[#141413]" transition={{ type: "spring", stiffness: 500, damping: 32 }} />}
                    </motion.button>
                  );
                })}
              </Stagger>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => { setRefPhoto(null); setDice((d) => d + 1); patch({ seed: draft.seed + 1 }); }}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-[#141413] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-black"
              >
                <motion.span animate={{ rotate: dice * 180 }} transition={{ type: "spring", stiffness: 200, damping: 14 }} className="grid">
                  <Dices className="size-4 text-[#A3E635]" />
                </motion.span>
                New variation
              </motion.button>
              <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ""; }} />
              <motion.button type="button" whileTap={{ scale: 0.94 }} onClick={() => fileInput.current?.click()} className="inline-flex h-12 items-center gap-2 rounded-full border border-black/15 bg-white/70 px-5 text-[14px] font-medium text-[#141413]/80 transition-colors hover:border-black/35 hover:bg-white">
                <ImagePlus className="size-4" /> {refPhoto ? "Change photo" : "Upload a photo"}
              </motion.button>
              {refPhoto && (
                <motion.button type="button" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} onClick={() => setRefPhoto(null)} className="inline-flex h-12 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-[#141413]/60 hover:bg-black/5">
                  <X className="size-3.5" /> Use drawn avatar
                </motion.button>
              )}
            </div>
            {photoError && <p role="alert" className="flex items-start gap-2 text-[13px] text-red-600"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {photoError}</p>}
          </div>

          <div className="order-1 sm:order-2 sm:sticky sm:top-24 sm:self-start">
            <div className="relative aspect-square w-full max-w-[250px] overflow-hidden rounded-[28px] bg-[#141413] shadow-[0_24px_50px_-24px_rgba(20,20,19,0.6)] max-sm:mx-auto">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.img
                  key={refPhoto ? "photo" : `${draft.avatarStyle}-${paletteId}-${draft.seed}`}
                  src={avatarSrc}
                  alt={`${nm || "Agent"} avatar preview`}
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.8, rotate: -6, filter: "blur(8px)" }}
                  animate={{ opacity: 1, scale: 1, rotate: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 1.08, filter: "blur(6px)" }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  className="absolute inset-0 size-full object-cover"
                />
              </AnimatePresence>
            </div>
            <p className="mt-3 text-center text-[12.5px] text-[#141413]/45 sm:max-w-[250px]">{refPhoto ? "Your photo, used as is" : "Drawn for you. No credits used."}</p>
          </div>
        </div>
      </StepFrame>
    ),
    launch: (
      <StepFrame eyebrow="Launch" title={`Ready to create ${nm || "your agent"}?`} hint="Free. One tap and it is live on Solana.">
        <div className="flex flex-col gap-5 rounded-3xl border border-black/10 bg-white/80 p-4 sm:flex-row sm:items-center sm:p-5">
          <motion.div initial={{ scale: 0.85, rotate: -4, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 16 }} className="size-28 shrink-0 overflow-hidden rounded-2xl bg-[#141413] sm:size-32">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarSrc} alt={nm} className="size-full object-cover" />
          </motion.div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[22px] font-semibold tracking-tight text-[#141413]">{nm}</p>
            {slugHandle(nm) && <p className="text-[13px] text-[#141413]/45">@{slugHandle(nm)}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[copy?.title, niche, type === "clipping" ? CLIP_LENGTHS.find((l) => l.id === draft.clipLength)?.blurb : `${VOICES.find((v) => v.id === draft.voice)?.title} · ${draft.language}`]
                .filter(Boolean)
                .map((t) => <span key={t} className="rounded-full bg-black/6 px-3 py-1 text-[12px] font-medium text-[#141413]/70">{t}</span>)}
            </div>
          </div>
        </div>

        {launch === "limit" && (
          <div role="alert" className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-50 p-4 text-[14px] text-amber-900">
            All agent slots on your account are in use. Delete an agent you no longer need to free one.
            <a href="/studio" className="ml-1 font-semibold underline">Manage my agents</a>
          </div>
        )}
        {launch === "error" && (
          <p role="alert" className="mt-4 flex items-start gap-2 text-[14px] text-red-600"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {launchError}</p>
        )}

        {launch === "working" && (
          <ol className="mt-5 flex flex-col gap-2" aria-live="polite">
            {([
              ["signin", "Signing you in"],
              ["image", "Saving your agent's look"],
              ["create", "Creating on Solana"],
              ["finish", "Almost there"],
            ] as const).map(([id, label], i, all) => {
              const cur = all.findIndex(([x]) => x === launchStage);
              const status = i < cur ? "done" : i === cur ? "active" : "pending";
              return (
                <li key={id} className={`flex items-center gap-3 text-[14.5px] ${status === "pending" ? "text-[#141413]/35" : "text-[#141413]"}`}>
                  <span className="grid size-5 place-items-center">
                    {status === "done" ? <Check className="size-4 text-[#4d7c0f]" strokeWidth={3} /> : status === "active" ? <Loader2 className="size-4 animate-spin" /> : <span className="size-1.5 rounded-full bg-black/25" />}
                  </span>
                  {label}
                  {status === "active" && id === "signin" && <span className="text-[12px] text-[#141413]/45">confirm in your wallet</span>}
                </li>
              );
            })}
          </ol>
        )}
      </StepFrame>
    ),
  };

  const isLaunch = stepId === "launch";
  const primaryLabel = isLaunch
    ? (!publicKey ? "Connect wallet" : launch === "error" ? "Try again" : "Create agent")
    : stepId === "look" ? "Looks good" : "Next";
  const guide = { happy: canNext && stepId !== "type" && stepId !== "launch", dir, stepKey: stepId };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#F6F4F0] text-[#141413] [scrollbar-gutter:stable]">
      {/* top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between bg-[#F6F4F0]/85 px-5 py-4 backdrop-blur-md sm:px-8">
        <div className="flex items-center gap-3">
          <Image src={velloLogo} alt="Solcameo" className="h-8 w-auto " priority />
          <span className="hidden text-[12px] font-semibold uppercase tracking-[0.2em] text-[#141413]/45 sm:inline">Builder</span>
        </div>
        <div className="flex items-center gap-2">
          {queuedLabel && (
            <span className="hidden max-w-[220px] items-center gap-2 truncate rounded-full bg-black/6 px-3 py-2 text-[12px] font-medium text-[#141413]/70 sm:inline-flex" title="This video is clipped as soon as your agent is ready">
              <span className="size-1.5 shrink-0 rounded-full bg-[#84CC16]" />
              <span className="truncate">Queued: {queuedLabel}</span>
            </span>
          )}
          <button type="button" onClick={restart} className="inline-flex items-center gap-1.5 rounded-full bg-[#F4D9D3] px-3.5 py-2 text-[12px] font-bold uppercase tracking-[0.1em] text-[#8a2f1c] transition-colors hover:bg-[#efc9c0]">
            <RefreshCw className="size-3.5" /> Restart
          </button>
        </div>
      </header>

      {/* progress: rail on desktop */}
      <nav aria-label="Setup progress" className="pointer-events-none fixed left-8 top-1/2 z-10 hidden -translate-y-1/2 lg:block">
        <ol className="relative flex flex-col gap-[18px]">
          <span className="absolute bottom-2 left-[5px] top-2 w-px bg-black/12" aria-hidden />
          <motion.span
            className="absolute left-[5px] top-2 w-px origin-top bg-[#141413]"
            initial={false}
            animate={{ height: `${steps.length > 1 ? (stepIdx / (steps.length - 1)) * 100 : 0}%` }}
            style={{ maxHeight: "calc(100% - 16px)" }}
            transition={{ duration: 0.4, ease: EASE }}
            aria-hidden
          />
          {steps.map((s, i) => {
            const done = i < stepIdx;
            const active = i === stepIdx;
            return (
              <li key={s} aria-current={active ? "step" : undefined} className="relative flex items-center gap-3.5">
                <span className={`relative z-10 size-[11px] rounded-full border-2 transition-all duration-300 ${active ? "border-[#141413] bg-[#A3E635] shadow-[0_0_0_4px_rgba(163,230,53,0.3)]" : done ? "border-[#141413] bg-[#141413]" : "border-black/20 bg-[#F6F4F0]"}`} />
                <span className={`text-[11.5px] font-semibold tracking-[0.12em] transition-colors ${active ? "text-[#141413]" : done ? "text-[#141413]/65" : "text-[#141413]/35"}`}>{STEP_LABEL[s]}</span>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* progress: bar on small screens */}
      <div className="px-5 sm:px-8 lg:hidden" aria-hidden>
        <div className="flex gap-1.5">
          {steps.map((s, i) => <span key={s} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= stepIdx ? "bg-[#141413]" : "bg-black/12"}`} />)}
        </div>
        <p className="mt-2 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[#141413]/45">Step {stepIdx + 1} of {steps.length} · {STEP_LABEL[stepId]}</p>
      </div>

      <main className="mx-auto w-full max-w-[760px] px-5 pb-24 pt-8 sm:px-8 sm:pt-14 lg:pl-16">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={stepId}
            custom={dir}
            initial={reduceMotion ? false : { opacity: 0, x: dir * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: dir * -28 }}
            transition={{ duration: 0.32, ease: EASE }}
          >
            <GuideCtx.Provider value={guide}>{body[stepId]}</GuideCtx.Provider>

            <div className="mt-10 flex items-center gap-3">
              {stepIdx > 0 && (
                <button type="button" onClick={back} disabled={launch === "working"} className="inline-flex h-14 items-center gap-1.5 rounded-2xl bg-black/6 px-6 text-[15px] font-semibold text-[#141413] transition-colors hover:bg-black/10 disabled:opacity-50">
                  <ChevronLeft className="size-4" /> Back
                </button>
              )}
              <button
                type="button"
                disabled={isLaunch ? (launch === "working" || launch === "limit") : !canNext}
                onClick={isLaunch ? () => void handleCreate() : next}
                className="group inline-flex h-14 items-center gap-2.5 rounded-2xl bg-[#141413] pl-7 pr-5 text-[15px] font-semibold text-white transition-all hover:bg-black active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#141413]/25 disabled:text-white/70"
              >
                {launch === "working" && isLaunch ? <Loader2 className="size-4 animate-spin" /> : null}
                {primaryLabel}
                <motion.span className="grid" animate={canNext && !isLaunch ? { x: [0, 4, 0] } : { x: 0 }} transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 1.2 }}>
                  {isLaunch ? (!publicKey ? <Wallet className="size-4" /> : <ArrowRight className="size-4 text-[#A3E635]" />) : <ChevronRight className="size-4 text-[#A3E635]" />}
                </motion.span>
              </button>
              {!isLaunch && !canNext && stepId !== "type" && (
                <span className="text-[13px] text-[#141413]/40">Required to continue</span>
              )}
            </div>
            {isLaunch && <p className="mt-4 text-[12.5px] text-[#141413]/40">Free to create.</p>}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

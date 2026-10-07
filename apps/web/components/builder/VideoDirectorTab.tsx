"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "convex/react";
import { Loader2, Check, Lock, Search, Globe, AlertCircle, Megaphone, Clapperboard } from "lucide-react";
import TabPageHeader from "./TabPageHeader";
import { api } from "@/convex/_generated/api";
import { useSiwsSession } from "@/hooks/use-siws-session";
import { DEFAULT_VIDEO_CONFIG, type VideoConfig } from "@/lib/builder/videoDirector";
import { videosPerDayToCron, cronForMinGapHours, resolveIntervalMs } from "@/lib/builder/heartbeatSchedule";
import OnboardingWizard from "./onboarding/OnboardingWizard";
import ShowPlanRecap from "./onboarding/ShowPlanRecap";
import { normalizeShowBible } from "@/lib/builder/showBible";

/* ── Dark glass control surface — same system as Generate / Carousel ────────
   Near-black bg with a soft green/lime radial glow, white/[0.04-0.10] glass
   cards, backdrop-blur-xl, thin white/10 borders, lime-400 as the single
   accent. Mirrors components/builder/generate/GenerateTab.tsx. */

const GLASS_BG: React.CSSProperties = {
  background:
    "radial-gradient(120% 90% at 12% -10%, rgba(255,255,255,0.05), transparent 55%), " +
    "radial-gradient(100% 80% at 105% 110%, rgba(255,255,255,0.035), transparent 55%), " +
    "#050506",
};

const labelCls = "font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500";
const inputCls =
  "h-11 rounded-lg border border-white/10 bg-white/[0.05] backdrop-blur-xl px-3.5 text-[13px] text-white tabular-nums outline-none placeholder:text-zinc-500 focus-visible:border-lime-400/50 disabled:cursor-not-allowed disabled:opacity-40";
const chipIdle = "border border-white/10 bg-white/[0.05] text-zinc-300 hover:bg-white/10";
const chipActive = "border border-lime-400/60 bg-lime-400/[0.14] text-lime-300";

/* Section = floating (no card/border) block with a small header row. */
function Section({ index, title, code, children }: { index: string; title: string; code?: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const order = (parseInt(index, 10) || 1) - 1;
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 18, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: Math.min(order * 0.06, 0.4) }}
      className="py-5"
    >
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="font-sans text-[16px] font-semibold text-white leading-none tracking-tight">{title}</h2>
        {code && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500">{code}</span>}
      </div>
      {children}
    </motion.section>
  );
}

/* ── Posting-time helpers (UI shows local time, config stores UTC minutes) ── */
function localHHMMToUtcMinutes(hhmm: string): number | undefined {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function utcMinutesToLocalHHMM(mins: number): string {
  const d = new Date();
  d.setUTCHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Persist video config / engine via the SIWS-owner-gated /api/agents/config route.
 * The underlying influencers.setVideoConfig + saveAgentConfig mutations are now
 * secret-gated and can no longer be called from the browser; auth (Privy Bearer +
 * X-Siws-Session) is auto-attached by the global fetch interceptor. Returns the
 * mutation's result (setVideoConfig → { ok, heartbeatCron, videoConfig }) and
 * throws on failure so the caller's existing try/catch surfaces the error.
 */
async function postAgentConfig<T>(mintAddress: string, kind: "video" | "agent", payload: unknown): Promise<T> {
  const res = await fetch("/api/agents/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mintAddress, kind, payload }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
  return json as T;
}

// Budget & Cadence + Posting Schedule sections hidden per operator request
// (2026-08-21). Config fields still persist and drive the pipeline; only the
// Director-tab UI is hidden.
const SHOW_ECON_SECTIONS = false;

const GAP_OPTIONS: Array<{ hours: number | undefined; label: string }> = [
  { hours: undefined, label: "Auto" },
  { hours: 1, label: "1h" },
  { hours: 2, label: "2h" },
  { hours: 3, label: "3h" },
  { hours: 4, label: "4h" },
  { hours: 12, label: "12h" },
  { hours: 24, label: "24h" },
];

/* Aspect ratio containers — portrait is the default (short-form vertical). Each
   option carries a proportional glyph (w×h px) so the card previews the shape.
   `w`/`h` are the visual glyph dims, not the real ratio in px. */
const ASPECT_OPTIONS: Array<{ id: NonNullable<VideoConfig["aspectRatio"]>; label: string; sub: string; w: number; h: number }> = [
  { id: "9:16", label: "9:16", sub: "Portrait", w: 26, h: 44 },
  { id: "16:9", label: "16:9", sub: "Landscape", w: 44, h: 25 },
  { id: "1:1", label: "1:1", sub: "Square", w: 36, h: 36 },
];
const RESOLUTION_OPTIONS: Array<{ id: NonNullable<VideoConfig["resolution"]>; label: string; sub: string }> = [
  { id: "720p", label: "720p", sub: "Faster / stable" },
  { id: "1080p", label: "1080p", sub: "Sharper / Veo" },
];

/** Selectable option card — the shared shape behind Aspect Ratio / Resolution /
 *  Video Engine, so the three don't each hand-roll the same active/idle styling. */
function OptionCard({ on, disabled, onClick, children, align = "left" }: { on: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; align?: "left" | "center" }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      className={`flex ${align === "center" ? "flex-col items-center text-center" : "items-center justify-between text-left"} gap-2.5 rounded-xl px-4 py-3 transition-colors active:scale-[0.99] disabled:opacity-40 ${
        on ? "border border-lime-400/60 bg-lime-400/[0.1]" : "border border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
      }`}
    >
      {children}
    </button>
  );
}

export default function VideoDirectorTab({ mintAddress, onOnboardingComplete }: { mintAddress?: string; onOnboardingComplete?: () => void }) {
  const reduce = useReducedMotion();
  const doc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { videoConfig?: VideoConfig; videoEngine?: string; showBible?: unknown; personaKernelOverride?: string; avatarUrl?: string; avatarStills?: string[] }
    | null
    | undefined;
  // Show Plan recap / wizard switchover. `wizardStep` set = the wizard is
  // mounted at that content step (pencil edit on a recap line, or "Redo
  // setup" → step 1); null = show the recap (once the bible exists) once the
  // query settles. No bible yet → the wizard is forced regardless of
  // `wizardStep`. onDone clears `wizardStep`, so the query's fresh
  // `showBible` re-renders the recap with the just-saved plan.
  const docLoaded = doc !== undefined;
  const bible = normalizeShowBible(doc?.showBible);
  const [wizardStep, setWizardStep] = useState<number | null>(null);
  const bibleMissing = !!mintAddress && docLoaded && bible === null;
  // C1 latch: a fresh agent's wizard is mounted because `bibleMissing` is
  // true. When the wizard's step 5 commits the bible, the reactive
  // `getByMint` query refetches and `bibleMissing` flips straight to false —
  // WITHOUT this latch that unmounts the wizard (and the just-started
  // SampleGate render inside it) mid-flight, skipping the sample gate
  // entirely. `wizardActive` sticks true once the wizard is shown for this
  // reason, so the render condition below stays true across that refetch;
  // only the wizard's own `onDone` (real completion, or the I6 edit-reopen
  // close/skip) clears it.
  const [wizardActive, setWizardActive] = useState(false);
  useEffect(() => {
    if (bibleMissing) setWizardActive(true);
  }, [bibleMissing]);
  const showWizard = !!mintAddress && (wizardActive || bibleMissing || wizardStep !== null);
  // Local overrides give instant feedback on edit. CRITICAL: they must NOT
  // permanently shadow the server doc — otherwise an agentic change from the
  // copilot (which writes `videoConfig`/`videoEngine` to the doc) never shows
  // and the buttons don't re-select. We RECONCILE: whenever the server doc
  // changes (a chat edit, or our own save round-trip), the stored doc key no
  // longer matches and the reactive doc value wins. The server is the source of
  // truth.
  const [cfgOverride, setCfgOverride] = useState<VideoConfig | null>(null);
  const [cfgOverrideKey, setCfgOverrideKey] = useState<string | null>(null);
  const docCfgKey = JSON.stringify(doc?.videoConfig ?? null);
  const cfg: VideoConfig = cfgOverride && cfgOverrideKey === docCfgKey
    ? cfgOverride
    : { ...DEFAULT_VIDEO_CONFIG, ...(doc?.videoConfig ?? {}) };
  // "error" was previously missing from this state machine — a failed save
  // (most commonly a stale/expired SIWS wallet session on the write route,
  // which requireOwnerWithSiws 401s on) fell into the same catch-all as
  // success, flashing back to "idle" with NO visible difference from a real
  // save. That silent-failure path is the root cause a refresh looked like it
  // "still shows the same old content": the click never actually persisted.
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  // The exact save to re-run when the operator clicks the error pill. Without
  // this, "Didn't save — retry" was a plain <span> — clicking it (or its
  // hover-only tooltip) did NOTHING, so a genuinely retryable failure (a
  // dropped SIWS re-sign, a network blip) had no way back to "saved" short of
  // toggling the control again. This is a bare retry-the-last-write closure,
  // not a request queue — a second edit before the retry simply replaces it.
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const { ensureSiwsSession } = useSiwsSession();

  const disabled = !mintAddress;

  /**
   * Shared save runner for both commit paths below. Split into two awaited
   * steps (was one `.catch(() => null).then(...)` chain) so a SIWS failure
   * (wallet not ready yet, signature declined, nonce/verify network error)
   * surfaces as ITS OWN real message instead of being swallowed and silently
   * retried anyway against a session that's about to 401/403 for an unrelated
   * reason — which is what made every failure read as a generic, unactionable
   * "Save failed" no matter the actual cause.
   */
  const runSave = (mintAddr: string, kind: "video" | "agent", payload: unknown, retry: () => void) => {
    setState("saving");
    setSaveError(null);
    setRetryAction(null);
    void (async () => {
      try {
        await ensureSiwsSession();
      } catch (e) {
        setState("error");
        setSaveError(e instanceof Error ? e.message : "Wallet sign-in failed");
        setRetryAction(() => retry);
        return;
      }
      try {
        await postAgentConfig(mintAddr, kind, payload);
        setState("saved");
        setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1400);
      } catch (e) {
        setState("error");
        setSaveError(e instanceof Error ? e.message : "Save failed");
        setRetryAction(() => retry);
      }
    })();
  };

  // Immediate save, same pattern as commitEngine — was debounced 600ms, which
  // is a whole extra failure class the immediate engine path never has: the
  // timer firing after the component re-renders/unmounts, after a tab switch,
  // or racing a SIWS session refresh, all silently dropped the write with
  // nothing left to retry (the debounce timer itself, not the save call, held
  // the only reference to `next`). Saving on every click costs one extra
  // request on rapid multi-chip toggles, which is the same trade-off the
  // engine picker already makes reliably.
  const commit = (next: VideoConfig) => {
    setCfgOverride(next);
    setCfgOverrideKey(docCfgKey);
    if (!mintAddress) return;
    runSave(mintAddress, "video", next, () => commit(next));
  };




  // ── Legacy sections — the pre-wizard manual settings wall. Kept verbatim
  // (not deleted or restyled), now tucked inside ShowPlanRecap's "Advanced
  // settings" collapse once a bible exists, and shown directly as a fallback
  // when there's no mintAddress yet to run the wizard against.
  const legacySections = (
    <>
        {/* ── Integrations (top of Styles, per operator ask) ──────────────────── */}
        <div className="mt-6">
          <Section index="00" title="Integrations" code="LIVE DATA">
            <label className={`flex items-start gap-3 rounded-xl border p-3.5 transition-colors ${disabled ? "cursor-not-allowed" : "cursor-pointer"} ${cfg.webSearchEnabled ? "border-lime-400/50 bg-lime-400/[0.06]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"}`}>
              <input
                type="checkbox"
                checked={cfg.webSearchEnabled === true}
                disabled={disabled}
                onChange={(e) => commit({ ...cfg, webSearchEnabled: e.target.checked })}
                className="mt-0.5 size-4 accent-lime-500"
              />
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-300">
                <Globe className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-white">Web Search</span>
                  {cfg.webSearchEnabled && <span className="inline-flex items-center gap-1 rounded-full bg-lime-400/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-lime-300"><Search className="size-2.5" /> On</span>}
                </span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-zinc-500">
                  Before writing anything, the agent searches the live web for current facts on its topic and grounds the script in them, real news, numbers, dates. Applies to every format (episodic cartoon, UGC, talking head, whatever this agent is set to make).
                </span>
              </span>
            </label>

            {/* Standing Promotion — a value-message worked into every future
                video, the same enforced mention+CTA a real marketplace
                campaign gets. Lets any operator build a self-promotional
                show (e.g. "mention Vello and what it does") without needing
                a real campaign row. Blank = no forced product mention. */}
            <label className="mt-3 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-300">
                <Megaphone className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-white">Standing Promotion</span>
                  {!!cfg.standingPromotion?.trim() && <span className="inline-flex items-center gap-1 rounded-full bg-lime-400/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-lime-300">On</span>}
                </span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-zinc-500">
                  Optional. A product or value-message every future video naturally mentions and builds toward, whatever the format (reaction, skit, how-to). E.g. "Mention Vello, the AI agent platform this show runs on, and what it does" — end each video on a soft call-to-action about it.
                </span>
                <textarea
                  disabled={disabled}
                  value={cfg.standingPromotion ?? ""}
                  onChange={(e) => commit({ ...cfg, standingPromotion: e.target.value })}
                  rows={2}
                  placeholder="e.g. Mention Vello, the AI agent platform this show runs on, and what it does."
                  className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-[12.5px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-lime-400/40 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </span>
            </label>
          </Section>
        </div>

        {/* ── Two-column control grid ────────────────────────────────────────── */}
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* LEFT, Output & economics */}
          <div className="flex flex-col gap-5">
            {/* 01 · Aspect ratio */}
            <Section index="01" title="Aspect Ratio" code="FRAME // SHAPE">
              <p className="mb-3 text-[11.5px] text-zinc-500">Output frame for every video · portrait by default</p>
              <div className="grid grid-cols-3 gap-2.5">
                {ASPECT_OPTIONS.map((o) => {
                  const on = (cfg.aspectRatio ?? "9:16") === o.id;
                  return (
                    <OptionCard key={o.id} on={on} disabled={disabled} onClick={() => commit({ ...cfg, aspectRatio: o.id })} align="center">
                      <span className="flex h-12 items-center justify-center">
                        <span
                          className={`block rounded-[2px] border ${on ? "border-lime-400 bg-lime-400/20" : "border-white/20 bg-white/[0.06]"}`}
                          style={{ width: o.w, height: o.h }}
                        />
                      </span>
                      <span className="flex items-center gap-1.5">
                        {on && <span className="grid size-4 place-items-center rounded-full bg-lime-400 text-black"><Check className="size-2.5" /></span>}
                        <span className="text-[13px] font-bold tracking-tight text-white tabular-nums">{o.label}</span>
                      </span>
                      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{o.sub}</span>
                    </OptionCard>
                  );
                })}
              </div>
            </Section>

            {/* 02 · Resolution */}
            <Section index="02" title="Resolution" code="QUALITY // PX">
              <p className="mb-3 text-[11.5px] text-zinc-500">Output sharpness for every video · engine support still applies</p>
              <div className="grid grid-cols-2 gap-2.5">
                {RESOLUTION_OPTIONS.map((o) => {
                  const on = (cfg.resolution ?? "720p") === o.id;
                  return (
                    <OptionCard key={o.id} on={on} disabled={disabled} onClick={() => commit({ ...cfg, resolution: o.id })}>
                      <span className="flex flex-col items-start gap-1">
                        <span className="flex items-center gap-1.5">
                          {on && <span className="grid size-4 place-items-center rounded-full bg-lime-400 text-black"><Check className="size-2.5" /></span>}
                          <span className="text-[13px] font-bold tracking-tight text-white tabular-nums">{o.label}</span>
                        </span>
                        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{o.sub}</span>
                      </span>
                    </OptionCard>
                  );
                })}
              </div>
            </Section>

            {/* 03 · Brand collabs */}
            <Section index="03" title="Brand Collabs" code="DEALS // DAY">
              <label className={labelCls}>Max brand campaigns / day</label>
              <p className="mb-3 mt-1 text-[12px] leading-relaxed text-zinc-500">How many brand deals the agent collabs on and posts each day.</p>
              <div className="flex items-center gap-2">
                {[0, 1, 2, 3, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={disabled}
                    onClick={() => commit({ ...cfg, maxBrandsPerDay: n })}
                    aria-pressed={(cfg.maxBrandsPerDay ?? 1) === n}
                    className={`grid h-11 min-w-11 place-items-center rounded-lg px-3 text-[14px] font-bold tabular-nums transition-colors active:scale-[0.95] disabled:opacity-40 ${(cfg.maxBrandsPerDay ?? 1) === n ? chipActive : chipIdle}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Section>
          </div>

        </div>
    </>
  );

  return (
    <div className="min-h-full px-8 py-8" style={{ ...GLASS_BG, fontFamily: "var(--font-geist-sans, system-ui)" }}>
      <div className="mx-auto max-w-[1200px]">
        {/* ── Masthead ──────────────────────────────────────────────────────── */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 18, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-end justify-between gap-3"
        >
          <TabPageHeader icon={Clapperboard} title="Director" blurb="Connections, framing and collabs." />
          <div className="shrink-0 pb-0.5 text-right">
            {disabled ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-zinc-400"><Lock className="size-3" /> Mint to save</span>
            ) : state === "saving" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-zinc-400"><Loader2 className="size-3 animate-spin" /> Writing</span>
            ) : state === "saved" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-lime-400/15 px-2.5 py-1 text-[11px] font-semibold text-lime-300"><Check className="size-3" /> Saved</span>
            ) : state === "error" ? (
              <>
                <button
                  type="button"
                  title={saveError ?? undefined}
                  disabled={!retryAction}
                  onClick={() => retryAction?.()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <AlertCircle className="size-3" /> Didn&apos;t save, retry
                </button>
                {saveError && <p className="mt-1 max-w-[260px] text-[10.5px] leading-snug text-red-400/70">{saveError}</p>}
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-zinc-400">Autosaves</span>
            )}
          </div>
        </motion.div>

        {/* ── Show Plan recap → wizard switchover ──────────────────────────────
             No bible yet (or mid-redo/edit) → the onboarding wizard; a saved
             bible → the readable recap, with these same legacy sections tucked
             inside its "Advanced settings" collapse; no mintAddress at all
             (nothing to run the wizard against) → the legacy sections directly,
             same as before this task. */}
        {showWizard && mintAddress ? (
          <div className="mt-6">
            <OnboardingWizard
              mintAddress={mintAddress}
              existingBible={bible}
              initialIdentityImageUrl={doc?.avatarStills?.[0] ?? doc?.avatarUrl}
              initialStep={wizardStep ?? 1}
              initialAspectRatio={cfg.aspectRatio === "16:9" ? "16:9" : "9:16"}
              onDone={() => {
                // A FIRST-RUN completion (no bible existed when the wizard
                // mounted) hands the operator straight to the Ideas tab — the
                // natural next step after approving the sample. A pencil-edit
                // reopen just returns to the recap as before.
                const firstRun = !bible;
                setWizardActive(false);
                setWizardStep(null);
                if (firstRun) onOnboardingComplete?.();
              }}
            />
          </div>
        ) : bible ? (
          <ShowPlanRecap
            bible={bible}
            identityImageUrl={doc?.avatarStills?.[0] ?? doc?.avatarUrl}
            onEdit={(step) => setWizardStep(step)}
            onRedo={() => setWizardStep(1)}
            advanced={legacySections}
          />
        ) : (
          legacySections
        )}
      </div>
    </div>
  );
}

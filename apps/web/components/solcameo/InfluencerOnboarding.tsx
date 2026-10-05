"use client";
/* eslint-disable @next/next/no-img-element -- generated character portrait */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Coins,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CharacterTab } from "@/components/builder/character/CharacterTab";
import type { SavedCharacter } from "@/lib/character/types";
import {
  CATEGORIES,
  normalizeTicker,
  validateConcept,
} from "@/lib/solstar/createForm";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { ensureSiwsViaRegistered } from "@/lib/client/siwsIdentity";

import { DbcEconomics } from "./DbcEconomics";
import { motion, useReducedMotion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { LiveDbcLaunch } from "./LiveDbcLaunch";
import {
  DEFAULT_DBC,
  dbcOptionsSchema,
  type DbcOptions,
} from "@/lib/meteora/options";
type Readiness = { ready: boolean; reason: string; network?: "devnet" | "mainnet" };
const NO_LIVE: Readiness = {
  ready: false,
  reason: "Meteora launch is not configured.",
};

const STEPS = [
  "Build character",
  "Coin details",
  "The curve",
  "Review & launch",
];
const STORAGE = "solcameo-influencer-draft-v2";
async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      data.error || "Could not complete this step. Please try again.",
    );
  return data;
}
const subscribe = () => () => {};
export function InfluencerOnboarding({
  generationConfigured = true,
  liveReadiness = NO_LIVE,
}: {
  generationConfigured?: boolean;
  liveReadiness?: Readiness;
}) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return hydrated ? (
    <InfluencerOnboardingContent
      generationConfigured={generationConfigured}
      liveReadiness={liveReadiness}
    />
  ) : (
    <div
      className="grid h-dvh place-items-center bg-[#090a0b] text-zinc-500"
      role="status"
    >
      Loading character builder…
    </div>
  );
}
function readDraft(): {
  character?: SavedCharacter;
  concept?: { name: string; ticker: string; bio: string; category: string };
  requestKey?: string;
  dbcOptions?: DbcOptions;
  pendingCharacterId?: string;
  launchMode?: "preview" | "live";
} {
  try {
    const draft = JSON.parse(sessionStorage.getItem(STORAGE) ?? "{}");
    return {
      character:
        draft.character?.version === 1 &&
        typeof draft.character.image?.url === "string" &&
        Array.isArray(draft.character.candidates)
          ? draft.character
          : undefined,
      concept:
        draft.concept &&
        ["name", "ticker", "bio", "category"].every(
          (k) => typeof draft.concept[k] === "string",
        )
          ? draft.concept
          : undefined,
      pendingCharacterId:
        typeof draft.pendingCharacterId === "string"
          ? draft.pendingCharacterId
          : undefined,
      launchMode: draft.launchMode === "live" ? "live" : "preview",
      dbcOptions: dbcOptionsSchema.safeParse(draft.dbcOptions).success
        ? dbcOptionsSchema.parse(draft.dbcOptions)
        : undefined,
      requestKey:
        typeof draft.requestKey === "string" ? draft.requestKey : undefined,
    };
  } catch {
    return {};
  }
}
function InfluencerOnboardingContent({
  generationConfigured,
  liveReadiness,
}: {
  generationConfigured: boolean;
  liveReadiness: Readiness;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const { authenticated, login } = useSupabaseAuth();
  const [draft] = useState(readDraft);
  const [step, setStep] = useState(draft.pendingCharacterId ? 3 : 0);
  const [character, setCharacter] = useState<SavedCharacter | null>(
    draft.character ?? null,
  );
  const [concept, setConcept] = useState(
    draft.concept ?? { name: "", ticker: "", bio: "", category: "Comedy" },
  );
  const [dbcOptions, setDbcOptions] = useState<DbcOptions>(
    draft.dbcOptions ?? DEFAULT_DBC,
  );
  const [launchMode] = useState<"preview" | "live">(
    "live",
  );
  const [pendingCharacterId, setPendingCharacterId] = useState<string | null>(
    draft.pendingCharacterId ?? null,
  );
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requestKey = useRef<string | null>(draft.requestKey ?? null);
  const storageId = useRef<string | null>(null);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE,
        JSON.stringify({
          character,
          concept,
          dbcOptions,
          pendingCharacterId,
          launchMode,
          requestKey: requestKey.current,
        }),
      );
    } catch {
      /* Private browser storage may be unavailable. */
    }
  }, [character, concept, dbcOptions, pendingCharacterId, launchMode]);
  function continueToReview() {
    const result = validateConcept(concept);
    if (step === 2) {
      if (launchMode === "live" && !liveReadiness.ready) {
        setError(liveReadiness.reason);
        return;
      }
      const curve = dbcOptionsSchema.safeParse(dbcOptions);
      if (!curve.success) {
        setError(curve.error.issues[0].message);
        return;
      }
    }
    if (!result.ok) {
      setErrors(result.errors as Record<string, string>);
      return;
    }
    setErrors({});
    setError(null);
    setStep(step === 1 ? 2 : 3);
  }
  async function createCoin() {
    if (busy || !character || !rights) return;
    if (!authenticated) {
      login();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!(await ensureSiwsViaRegistered()))
        throw new Error(
          "Connect your Solana wallet and approve the sign-in message to create your coin.",
        );
      if (!storageId.current)
        storageId.current = (
          await post("/api/character/draft-image", { url: character.image.url })
        ).imageStorageId;
      requestKey.current ??= crypto.randomUUID();
      try {
        sessionStorage.setItem(
          STORAGE,
          JSON.stringify({
            character,
            concept,
            dbcOptions,
            pendingCharacterId,
            launchMode,
            requestKey: requestKey.current,
          }),
        );
      } catch {
        /* optional */
      }
      const result = await post("/api/solstar/characters", {
        ...concept,
        rightsAttested: rights,
        imageStorageId: storageId.current,
        idempotencyKey: requestKey.current,
      });
      if (launchMode === "live") {
        setAutoLaunch(true);
        setPendingCharacterId(result.characterId);
        return;
      }
      sessionStorage.removeItem(STORAGE);
      setCreatedId(result.characterId);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not create your coin.";
      const messages: Record<string, string> = {
        ticker_taken:
          "That ticker is already taken. Go back and choose another.",
        create_limit:
          "You've reached today's creation limit. Your draft is saved.",
        server_misconfigured:
          "Coin creation is not configured on this server yet. Your draft is saved.",
        internal_error:
          "Coin creation is temporarily unavailable. Your draft is saved; please retry.",
      };
      setError(messages[message] ?? message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#090a0b] font-sans text-zinc-100">
      <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#090a0b]/95 px-3 backdrop-blur-xl sm:gap-6 sm:px-5">
        <Button nativeButton={false} render={<Link href="/control" />} aria-label="Back to Control" variant="ghost" size="icon-sm" className="shrink-0 text-zinc-400"><ArrowLeft className="size-4" /></Button>
        <span className="hidden shrink-0 text-xs font-medium text-zinc-200 lg:inline">Create influencer</span>
        <nav aria-label="Creation steps" className="min-w-0 flex-1">
          <ol className="mx-auto flex max-w-lg items-center justify-center gap-1 sm:gap-3">
            {STEPS.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className="flex min-w-0 items-center gap-1 sm:gap-3">
              <Button variant="ghost" disabled={busy || !!pendingCharacterId || index > step} onClick={() => { setError(null); setStep(index); }} aria-label={`Step ${index + 1}: ${label}`} className={`h-8 gap-1.5 rounded-lg px-1.5 text-xs sm:px-2 ${step === index ? "bg-white/5 text-white" : "text-zinc-500"}`}>
                <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] ${step >= index ? "bg-[#d7ff00] text-black" : "border border-white/10 text-zinc-600"}`}>{step > index ? <Check className="size-3" /> : index + 1}</span>
                <span className={step === index ? "truncate" : "hidden sm:inline"}>{label}</span>
              </Button>
              {index < STEPS.length - 1 && <span aria-hidden className="h-px w-2 bg-white/10 sm:w-4" />}
            </li>)}
          </ol>
        </nav>
        <Badge variant="outline" className="shrink-0 gap-1.5 border-white/10 bg-white/[0.025] text-[10px] font-normal text-zinc-400"><span className="size-1 rounded-full bg-[#d7ff00]" />{liveReadiness.network === "mainnet" ? "Mainnet" : "Devnet"}</Badge>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {step === 0 ? (
          <>
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 pt-5 text-xs text-zinc-500">
              <p>
                Build the look first. Generate a portrait, select your
                favourite, then create its coin.
              </p>
              {!authenticated && (
                <Button variant="outline" size="sm" onClick={login}>
                  Sign in to generate
                </Button>
              )}
            </div>
            {!generationConfigured && (
              <p
                role="status"
                className="mx-auto max-w-6xl px-4 pt-3 text-xs text-amber-300/80"
              >
                Character generation is temporarily unavailable. You can design
                your influencer while the generation service is connected.
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="mx-auto max-w-6xl px-4 pt-3 text-sm text-red-300"
              >
                {error}
              </p>
            )}
            {
              <CharacterTab
                onboarding
                initialCharacter={character ?? undefined}
                canGenerate={authenticated && generationConfigured}
                onNeedLogin={() => {
                  if (!generationConfigured)
                    setError(
                      "Character generation is temporarily unavailable. Your design can still be edited.",
                    );
                  else login();
                }}
                onCharacterReady={(value) => {
                  setCharacter(value);
                  storageId.current = null;
                  requestKey.current = null;
                  setStep(1);
                }}
              />
            }
          </>
        ) : (
          <motion.div
            key={step}
            initial={{ opacity: 0, y: reduced ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12 lg:py-12"
          >
            <section>
              <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#d7ff00]">
                {STEPS[step]}
              </p>
              <h1 className="text-2xl font-semibold tracking-tight">
                {step === 1
                  ? "Give your character a coin."
                  : step === 2
                    ? "Build your community economy."
                    : "Your character. Your coin."}
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                {step === 1
                  ? "Your generated portrait becomes the coin's identity. Choose a name and ticker for its community."
                  : step === 2
                    ? "Choose a curve and understand the economics before launch."
                    : "Review your AI influencer and coin before approving your launch."}
              </p>
              {step === 1 ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    continueToReview();
                  }}
                  className="mt-8 space-y-5"
                >
                  <div className="space-y-2">
                    <Label htmlFor="coin-name">Character & coin name</Label>
                    <Input
                      id="coin-name"
                      value={concept.name}
                      maxLength={32}
                      onChange={(e) => {
                        requestKey.current = null;
                        setConcept((p) => ({ ...p, name: e.target.value }));
                      }}
                      placeholder="Your character's name"
                      aria-invalid={!!errors.name}
                    />
                    {errors.name && (
                      <p className="text-xs text-red-400">{errors.name}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coin-ticker">Ticker</Label>
                    <Input
                      id="coin-ticker"
                      value={concept.ticker}
                      onChange={(e) => {
                        requestKey.current = null;
                        setConcept((p) => ({
                          ...p,
                          ticker: normalizeTicker(e.target.value),
                        }));
                      }}
                      placeholder="CAMEO"
                      aria-invalid={!!errors.ticker}
                    />
                    <p className="text-xs text-zinc-500">
                      2–10 letters or numbers. This identifies your coin in the
                      market.
                    </p>
                    {errors.ticker && (
                      <p className="text-xs text-red-400">{errors.ticker}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coin-bio">Character story</Label>
                    <Textarea
                      id="coin-bio"
                      value={concept.bio}
                      maxLength={280}
                      onChange={(e) => {
                        requestKey.current = null;
                        setConcept((p) => ({ ...p, bio: e.target.value }));
                      }}
                      placeholder="What makes your influencer worth following?"
                      className="min-h-24"
                    />
                    <p className="text-right text-xs text-zinc-600">
                      {concept.bio.length}/280
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label id="category-label">Category</Label>
                    <Select
                      value={concept.category}
                      onValueChange={(value) => {
                        if (value) {
                          requestKey.current = null;
                          setConcept((p) => ({ ...p, category: value }));
                        }
                      }}
                    >
                      <SelectTrigger
                        aria-labelledby="category-label"
                        className="h-10 w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {error && (
                    <p role="alert" className="text-sm text-red-300">
                      {error}
                    </p>
                  )}
                  <div className="flex justify-between pt-4">
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setStep(0)}
                    >
                      <ArrowLeft /> Character
                    </Button>
                    <Button type="submit">
                      Configure curve <ArrowRight />
                    </Button>
                  </div>
                </form>
              ) : step === 2 ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    continueToReview();
                  }}
                  className="mt-8 space-y-5"
                >
                  {" "}
                  <DbcEconomics
                    value={dbcOptions}
                    onChange={(value) => {
                      requestKey.current = null;
                      setDbcOptions(value);
                    }}
                  />
                  <div className="space-y-3 rounded-xl border border-white/10 p-4">
                    <Label>Launch destination</Label>
                    <p className="text-sm text-white">{launchMode === "live" ? "On-chain mint · wallet approval required" : "Preview only · on-chain launch unavailable"}</p>
                    <p className="text-xs leading-5 text-zinc-500">
                      {liveReadiness.reason}
                    </p>
                  </div>
                  <p role="alert" className="text-sm text-red-300">
                    {error}
                  </p>
                  <div className="flex justify-between pt-4">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setStep(1)}
                    >
                      <ArrowLeft /> Coin details
                    </Button>
                    <Button type="submit">
                      Review launch <ArrowRight />
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-8 space-y-6">
                  <dl className="divide-y divide-white/10 rounded-xl border border-white/10 px-5">
                    {[
                      ["Name", concept.name],
                      ["Ticker", `$${concept.ticker}`],
                      ["Category", concept.category],
                      ["Character", "AI-generated portrait"],
                      [
                        "Market",
                        launchMode === "live"
                          ? "Meteora DBC"
                          : "Preview · simulated coin",
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex justify-between gap-4 py-4 text-sm"
                      >
                        <dt className="text-zinc-500">{label}</dt>
                        <dd className="text-right">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <DbcEconomics
                    value={dbcOptions}
                    onChange={(value) => {
                      requestKey.current = null;
                      setDbcOptions(value);
                    }}
                    readOnly
                  />
                  <div className="rounded-xl border border-[#d7ff00]/15 bg-[#d7ff00]/5 p-4 text-sm leading-6 text-zinc-400">
                    <Coins className="mb-2 size-5 text-[#d7ff00]" />
                    {launchMode === "live"
                      ? "Prepare your character, then approve the Meteora configuration and pool creation in your wallet. Your selected curve and liquidity settings are fixed at launch."
                      : "This creates a simulated coin. The curve is a launch preview; no live token is minted, funds transferred, or daily posting activated."}
                  </div>
                  <div className="flex items-start gap-3">
                    <Switch
                      id="rights"
                      checked={rights}
                      onCheckedChange={setRights}
                      disabled={busy}
                    />
                    <Label
                      htmlFor="rights"
                      className="text-xs leading-5 text-zinc-400"
                    >
                      I have the rights to use this character and its images.
                    </Label>
                  </div>
                  {error && (
                    <p
                      role="alert"
                      className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300"
                    >
                      {error}
                    </p>
                  )}
                  {pendingCharacterId && (
                    <LiveDbcLaunch
                      autoStart={autoLaunch}
                      options={dbcOptions}
                      characterId={pendingCharacterId}
                      onComplete={() => {
                        sessionStorage.removeItem(STORAGE);
                        setCreatedId(pendingCharacterId);
                      }}
                    />
                  )}
                  {!pendingCharacterId && <div className="flex justify-between gap-3">
                    <Button
                      variant="ghost"
                      disabled={busy || !!pendingCharacterId}
                      onClick={() => setStep(2)}
                    >
                      <ArrowLeft /> Edit curve
                    </Button>
                    <Button
                      disabled={
                        busy ||
                        !rights ||
                        !!pendingCharacterId ||
                        (launchMode === "live" && !liveReadiness.ready)
                      }
                      onClick={() => void createCoin()}
                    >
                      {busy ? (
                        <>
                          <Loader2 className="animate-spin" /> Creating…
                        </>
                      ) : (
                        <>
                          <Coins />{" "}
                          {launchMode === "live"
                            ? "Launch on devnet"
                            : "Create preview coin"}
                        </>
                      )}
                    </Button>
                  </div>}
                </div>
              )}
            </section>
            <aside className="h-fit overflow-hidden rounded-2xl border border-white/10 bg-[#202326] lg:sticky lg:top-8">
              {character && (
                <img
                  src={character.image.url}
                  alt="Your selected AI influencer"
                  className="aspect-[3/4] w-full object-cover"
                />
              )}
              <div className="p-5">
                <p className="text-xs text-zinc-500">Coin preview</p>
                <h2 className="mt-2 text-lg font-semibold">
                  {concept.name || "Your character"}
                </h2>
                <p className="mt-1 font-mono text-sm text-[#d7ff00]">
                  ${concept.ticker || "TICKER"}
                </p>
                {concept.bio && (
                  <p className="mt-3 break-words text-sm leading-6 text-zinc-500">
                    {concept.bio}
                  </p>
                )}
                {step >= 2 && <dl className="mt-5 space-y-3 border-t border-white/10 pt-4 text-xs">{[["Opens at", `${dbcOptions.initialCapSol} SOL cap`], ["Graduates at", `${dbcOptions.graduationCapSol} SOL cap`], ["Supply", "1 billion"], ["Trading fee", `${dbcOptions.feeBps / 100}%`], ["Locked liquidity", "100%"]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-zinc-500">{label}</dt><dd className="text-zinc-200">{value}</dd></div>)}</dl>}
                <Badge
                  variant="outline"
                  className="mt-4 border-white/10 text-zinc-500"
                >
                  {concept.category}
                </Badge>
              </div>
            </aside>
          </motion.div>
        )}
      </main>
      <Dialog
        open={!!createdId}
        onOpenChange={(open) => {
          if (!open && createdId) router.push(`/market/${createdId}`);
        }}
      >
        <DialogContent className="overflow-hidden rounded-3xl border-white/10 bg-[#202326] p-8 text-center text-white">
          <motion.div
            initial={{ scale: reduced ? 1 : 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            className="mx-auto mb-5 grid size-20 place-items-center rounded-2xl bg-[#d7ff00]/10"
          >
            {character && (
              <img
                src={character.image.url}
                alt=""
                className="size-16 rounded-xl object-cover"
              />
            )}
          </motion.div>
          <DialogTitle className="text-2xl tracking-tight">
            {concept.name} is ready<span className="text-[#d7ff00]">.</span>
          </DialogTitle>
          <DialogDescription className="mt-3 text-zinc-400">
            {launchMode === "live"
              ? `Your Meteora pool is confirmed on Solana ${liveReadiness.network === "mainnet" ? "mainnet" : "devnet"}. Your coin and AI agent are linked.`
              : "Your preview coin has been created. Explore its simulated market."}
          </DialogDescription>
          <Button
            onClick={() => router.push(`/market/${createdId}`)}
            className="mt-6 w-full bg-[#d7ff00] text-zinc-950 hover:bg-[#e4ff59]"
          >
            View your market <ArrowRight />
          </Button>
          <Button variant="outline" onClick={() => router.push(`/control?agent=${createdId}`)} className="mt-2 w-full border-white/10 bg-transparent text-zinc-300 hover:bg-white/5">Open your AI agent</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

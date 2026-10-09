"use client";

import { useState, useRef, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCreateAgent } from "@/hooks/use-create-agent";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  X,
  Sparkles,
  ChevronRight,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Wand2,
  Image as ImageIcon,
  AlertCircle,
  Rocket,
  ArrowLeft,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentType = "influencer" | "trader" | "worker";
type Step =
  | "type-select"
  | "upload"
  | "analyzing"
  | "prompts"
  | "generating"
  | "preview"
  | "configure"
  | "minting"
  | "done";

interface UploadedImage {
  file: File;
  preview: string;
  base64: string;
}

interface AnalysisResult {
  character_bible: string;
  detected_niche: string;
  detected_vibe: string;
  style_summary: string;
  dominant_colors: string[];
  prompt_1: string;
  prompt_2: string;
  prompt_3: string;
  seed: number;
  vello_style: string;
}

interface GeneratedImage {
  url: string;    // data URI — self-contained, always displayable
  rawUrl: string; // original Kie.ai CDN URL — stored in Convex as avatarUrl
  label: string;
}

interface AgentConfig {
  name: string;
  handle: string;
  niche: string;
  language: string;
  description: string;
  archetype: string;
  warmth: number;
  humor: number;
  authority: number;
  boldness: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  name: "",
  handle: "",
  niche: "lifestyle",
  language: "en",
  description: "",
  archetype: "creator",
  warmth: 70,
  humor: 60,
  authority: 50,
  boldness: 65,
};

const VISIBLE_STEPS = ["upload", "prompts", "preview", "configure", "minting"];
const TRAIT_COLORS: Record<string, string> = {
  warmth: "bg-orange-500",
  humor: "bg-yellow-500",
  authority: "bg-blue-500",
  boldness: "bg-emerald-500",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepDots({ step, onBack }: { step: Step; onBack?: () => void }) {
  const visIdx = VISIBLE_STEPS.indexOf(step);
  if (visIdx < 0) return null;
  return (
    <div className="flex items-center justify-between mb-6">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3" /> Back
        </button>
      )}
      <div className="flex gap-1.5 items-center ml-auto">
        {VISIBLE_STEPS.map((s, i) => (
          <div
            key={s}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i <= visIdx ? "bg-emerald-500 w-8" : "bg-muted w-4"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function ImageDropZone({
  index,
  image,
  onUpload,
  onRemove,
}: {
  index: number;
  image: UploadedImage | null;
  onUpload: (img: UploadedImage) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const preview = URL.createObjectURL(file);
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      onUpload({ file, preview, base64 });
    },
    [onUpload]
  );

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed aspect-square flex items-center justify-center cursor-pointer transition-all overflow-hidden
        ${image ? "border-emerald-500/50" : "border-border hover:border-emerald-500/40 hover:bg-emerald-500/5 bg-muted/20"}`}
      onClick={() => !image && inputRef.current?.click()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) handleFile(f);
      }}
      onDragOver={(e) => e.preventDefault()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      {image ? (
        <>
          <img
            src={image.preview}
            alt={`Ref ${index + 1}`}
            className="w-full h-full object-cover"
          />
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="absolute top-2 right-2 size-6 rounded-full bg-black/70 flex items-center justify-center text-white hover:bg-red-600 transition-colors"
          >
            <X className="size-3" />
          </button>
          <div className="absolute bottom-2 left-2 bg-black/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
            Ref {index + 1}
          </div>
        </>
      ) : (
        <div className="text-center space-y-2 p-4">
          <Upload className="size-6 text-muted-foreground mx-auto" />
          <p className="text-xs text-muted-foreground">
            Drop or click<br />
            <span className="text-[10px] opacity-60">JPG, PNG, WebP</span>
          </p>
        </div>
      )}
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2 text-sm text-destructive">
      <AlertCircle className="size-4 shrink-0 mt-0.5" />
      <span>{msg}</span>
    </div>
  );
}

/**
 * Defensively read a fetch Response as JSON. Reads the body as TEXT first (so a
 * failed parse can never leave us with an already-consumed stream) and only parses
 * when the payload actually looks like JSON. Returns the parsed object, or `null`
 * when the body is non-JSON — almost always an HTML error page from the Railway
 * proxy on a timeout/5xx. Callers turn a `null` into a friendly message instead of
 * the raw "Unexpected token '<'" crash the old `await res.json()` produced.
 */
async function parseJsonResponse<T>(res: Response): Promise<T | null> {
  let raw = "";
  try { raw = await res.text(); } catch { return null; }
  const ctype = res.headers.get("content-type") ?? "";
  const looksJson = ctype.includes("application/json") || /^\s*[[{]/.test(raw);
  if (!looksJson) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NftCreatorFlow() {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { accessToken } = useSupabaseAuth();
  const createInfluencer = useCreateAgent();

  const [step, setStep] = useState<Step>("type-select");
  const [images, setImages] = useState<(UploadedImage | null)[]>([null, null, null]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [prompts, setPrompts] = useState<{ p1: string; p2: string; p3: string } | null>(null);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);       // raw URL → saved to Convex
  const [selectedDisplayUrl, setSelectedDisplayUrl] = useState<string | null>(null); // proxy URL → shown in <img>
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [mintResult, setMintResult] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<string | null>(null); // live "still generating…" line

  function setImg(i: number, img: UploadedImage | null) {
    setImages((prev) => { const n = [...prev]; n[i] = img; return n; });
  }

  // ── Analyze with Claude ──
  async function handleAnalyze() {
    const uploaded = images.filter(Boolean) as UploadedImage[];
    if (!uploaded.length) return;
    setError(null);
    setStep("analyzing");

    try {
      const res = await fetch("/api/analyze-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: uploaded.map((img) => ({ data: img.base64, mimeType: img.file.type })),
        }),
      });
      const data = await res.json() as AnalysisResult & { error?: string; ok?: boolean };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);

      setAnalysis(data);
      setPrompts({ p1: data.prompt_1, p2: data.prompt_2, p3: data.prompt_3 });
      setConfig((c) => ({
        ...c,
        niche: data.detected_niche ?? c.niche,
        description: `${data.style_summary}. ${data.detected_vibe} AI Influencer.`,
      }));
      setStep("prompts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setStep("upload");
    }
  }

  // ── Generate ──
  // Two-phase to avoid the Railway request-timeout that produced the raw
  // "Unexpected token '<'" JSON-parse crash: (1) POST /generate-nft-images kicks
  // off the KIE render task(s) and returns immediately with task ids; (2) we poll
  // /generate-nft-images/collect every few seconds until the images are ready (or
  // an overall client deadline elapses). Every fetch is parsed DEFENSIVELY — a 5xx
  // or HTML error page never surfaces as a raw parse error, only a friendly line.
  async function handleGenerate() {
    if (!prompts || !analysis) return;
    setError(null);
    setGenStatus(null);
    setStep("generating");

    const BUSY = "The image service is busy — please retry in a moment.";
    const authHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      // Routes are auth-gated (spend KIE credits) — attach the session bearer.
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    };

    try {
      const refBase64 = images[0]?.base64;

      // ── Phase 1: CREATE — kick off the render task(s) (fast) ──
      const createRes = await fetch("/api/generate-nft-images", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          prompt_1: prompts.p1,
          prompt_2: prompts.p2,
          prompt_3: prompts.p3,
          referenceImageBase64: refBase64,
        }),
      });
      const created = await parseJsonResponse<{
        ok?: boolean;
        tasks?: Array<{ taskId: string; label: string }>;
        refImageUrls?: string[];
        error?: string;
      }>(createRes);
      if (!created) throw new Error(createRes.status >= 500 ? BUSY : `HTTP ${createRes.status}`);
      if (!createRes.ok || created.error || created.ok === false) {
        throw new Error(created.error ?? (createRes.status >= 500 ? BUSY : `HTTP ${createRes.status}`));
      }
      const tasks = created.tasks ?? [];
      if (tasks.length === 0) throw new Error("No render tasks were created — please retry.");
      const refImageUrls = created.refImageUrls ?? [];

      // ── Phase 2: COLLECT — poll until the images are ready ──
      const deadline = Date.now() + 4 * 60 * 1000; // ~4 min overall client budget
      let ready: GeneratedImage[] | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const collectRes = await fetch("/api/generate-nft-images/collect", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ tasks, refImageUrls }),
        });
        const collected = await parseJsonResponse<{
          ok?: boolean;
          pending?: boolean;
          images?: GeneratedImage[];
          error?: string;
        }>(collectRes);
        // HTML/5xx proxy blip → don't crash; keep polling until the deadline.
        if (!collectRes.ok || !collected) {
          setGenStatus("Still generating… the image service is busy.");
          continue;
        }
        if (collected.error || collected.ok === false) {
          throw new Error(collected.error ?? "Generation failed");
        }
        if (collected.images?.length) { ready = collected.images; break; }
        // pending → keep waiting
        setGenStatus("Still generating your NFT images…");
      }
      if (!ready) throw new Error("Generation is taking longer than expected — please retry.");

      setGeneratedImages(ready);
      setSelectedUrl(ready[0].rawUrl);
      setSelectedDisplayUrl(ready[0].url);
      setGenStatus(null);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setGenStatus(null);
      setStep("prompts");
    }
  }

  // ── Mint ──
  async function handleMint() {
    if (!connected || !publicKey) { setVisible(true); return; }
    if (!selectedUrl) return;
    setStep("minting");
    setError(null);

    try {
      const mintAddress = `${publicKey.toBase58().slice(0, 8)}${Date.now().toString(36).toUpperCase()}`;
      const createdMintAddress = await createInfluencer({
        mintAddress,
        creatorWallet: publicKey.toBase58(),
        name: config.name || "Unnamed Agent",
        handle: config.handle || `@agent_${mintAddress.slice(0, 6).toLowerCase()}`,
        avatarUrl: selectedUrl,
        niche: config.niche,
        language: config.language,
        archetype: config.archetype,
        description: config.description,
        personality: {
          warmth: config.warmth,
          humor: config.humor,
          authority: config.authority,
          boldness: config.boldness,
        },
      });
      setMintResult(createdMintAddress);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mint failed");
      setStep("configure");
    }
  }

  function reset() {
    setStep("type-select");
    setImages([null, null, null]);
    setAnalysis(null);
    setPrompts(null);
    setGeneratedImages([]);
    setSelectedUrl(null);
    setSelectedDisplayUrl(null);
    setMintResult(null);
    setConfig(DEFAULT_CONFIG);
    setError(null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  // ── Type selector ──
  if (step === "type-select") {
    return (
      <div className="max-w-2xl mx-auto space-y-8 py-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Choose your Agent type</h2>
          <p className="text-muted-foreground text-sm">
            Select the kind of autonomous AI agent to create and mint as an NFT.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              type: "influencer" as AgentType,
              icon: <Sparkles className="size-8" />,
              label: "AI Influencer",
              desc: "Creates content, joins campaigns, earns yield from brand deals",
              gradient: "from-emerald-950/60 to-pink-900/40",
              border: "border-emerald-500/30 hover:border-emerald-500/70",
              available: true,
            },
          ].map(({ type, icon, label, desc, gradient, border, available }) => (
            <button
              key={type}
              disabled={!available}
              onClick={() => available && setStep("upload")}
              className={`relative rounded-2xl border-2 ${border} bg-gradient-to-br ${gradient} p-5 text-left space-y-3 transition-all duration-200
                ${available ? "cursor-pointer hover:scale-[1.02] hover:shadow-xl" : "cursor-not-allowed opacity-40"}`}
            >
              {!available && (
                <Badge variant="outline" className="absolute top-3 right-3 text-[10px] border-muted-foreground/30 text-muted-foreground">
                  Soon
                </Badge>
              )}
              <div className="text-muted-foreground">{icon}</div>
              <div>
                <p className="font-bold text-base">{label}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
              </div>
              {available && (
                <p className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                  Start building <ChevronRight className="size-3" />
                </p>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Upload ──
  if (step === "upload") {
    const count = images.filter(Boolean).length;
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <StepDots step={step} onBack={() => setStep("type-select")} />
        <div className="space-y-1">
          <h2 className="text-xl font-bold">Upload reference images</h2>
          <p className="text-sm text-muted-foreground">
            Upload 1–3 images. Claude will extract your character&apos;s visual DNA and generate
            3 consistent NFT images (same character, different angles) in the Vello brand style.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <ImageDropZone key={i} index={i} image={images[i]}
              onUpload={(img) => setImg(i, img)}
              onRemove={() => setImg(i, null)}
            />
          ))}
        </div>
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-4 space-y-1.5 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-emerald-400" /> How it works
          </p>
          <p>Claude analyzes your references → creates a character bible → generates 3 Vello-branded NFT images (front portrait, ¾ angle, dynamic pose) with a consistent seed so they all look like the same character.</p>
        </div>
        {error && <ErrorBanner msg={error} />}
        <Button
          className="w-full bg-emerald-600 hover:bg-emerald-700 gap-2 h-11"
          disabled={count === 0}
          onClick={handleAnalyze}
        >
          <Wand2 className="size-4" />
          Analyze with Claude ({count}/3 images)
        </Button>
      </div>
    );
  }

  // ── Analyzing ──
  if (step === "analyzing") {
    return (
      <div className="max-w-xl mx-auto flex flex-col items-center justify-center gap-6 py-20">
        <div className="relative size-20">
          <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
          <div className="relative size-20 rounded-full bg-gradient-to-br from-emerald-600 to-green-600 flex items-center justify-center">
            <Wand2 className="size-8 text-white" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold">Claude is analyzing your images</h2>
          <p className="text-sm text-muted-foreground">Building character bible + 3 consistent Vello NFT prompts…</p>
        </div>
        <Progress value={60} className="w-64 h-1.5 bg-muted [&>div]:bg-emerald-500 [&>div]:animate-pulse" />
      </div>
    );
  }

  // ── Prompts review ──
  if (step === "prompts") {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <StepDots step={step} onBack={() => setStep("upload")} />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">Claude&apos;s character + prompts</h2>
          <CheckCircle2 className="size-5 text-emerald-400" />
        </div>

        {analysis && (
          <div className="rounded-xl bg-muted/30 border border-border p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Character Bible</p>
            <p className="text-sm leading-relaxed">{analysis.character_bible}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="secondary" className="text-xs capitalize">{analysis.detected_niche}</Badge>
              <Badge variant="outline" className="text-xs">{analysis.detected_vibe}</Badge>
              {analysis.dominant_colors?.map((c, i) => (
                <div key={i} className="size-4 rounded-full border border-border" style={{ background: c }} title={c} />
              ))}
            </div>
          </div>
        )}

        {prompts && (
          <div className="space-y-4">
            {(
              [
                { key: "p1" as const, label: "① Front Portrait", color: "text-emerald-400" },
                { key: "p2" as const, label: "② Three-Quarter Angle", color: "text-green-400" },
                { key: "p3" as const, label: "③ Dynamic Pose", color: "text-pink-400" },
              ] as const
            ).map(({ key, label, color }) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${color}`}>{label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {prompts[key].split(" ").length}w
                  </span>
                </div>
                <Textarea
                  rows={3}
                  value={prompts[key]}
                  onChange={(e) => setPrompts((p) => p && { ...p, [key]: e.target.value })}
                  className="text-xs font-mono bg-muted/30 resize-none leading-relaxed"
                />
              </div>
            ))}
          </div>
        )}

        {error && <ErrorBanner msg={error} />}

        <div className="flex gap-3">
          <Button variant="outline" className="gap-2" onClick={() => setStep("upload")}>
            <RefreshCw className="size-4" /> Re-upload
          </Button>
          <Button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 gap-2 h-10"
            onClick={handleGenerate}
          >
            <Sparkles className="size-4" />
            Generate 3 Vello NFT Images
          </Button>
        </div>
      </div>
    );
  }

  // ── Generating ──
  if (step === "generating") {
    return (
      <div className="max-w-xl mx-auto flex flex-col items-center justify-center gap-6 py-20">
        <div className="relative size-20">
          <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping" />
          <div className="relative size-20 rounded-full bg-gradient-to-br from-green-600 to-emerald-600 flex items-center justify-center">
            <ImageIcon className="size-8 text-white" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold">Generating your NFT images</h2>
          <p className="text-sm text-muted-foreground">Rendering 3 angles of the same character in parallel…</p>
        </div>
        <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
          {["Front Portrait", "¾ Angle", "Dynamic"].map((label) => (
            <div key={label} className="aspect-square rounded-xl bg-gradient-to-br from-emerald-950/40 to-green-950/40 border border-emerald-500/20 flex flex-col items-center justify-center gap-2">
              <Loader2 className="size-5 animate-spin text-emerald-400" />
              <p className="text-[10px] text-muted-foreground text-center">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {genStatus ?? "Takes 20–60 seconds · powered by Flux"}
        </p>
      </div>
    );
  }

  // ── Preview ──
  if (step === "preview") {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <StepDots step={step} onBack={() => setStep("prompts")} />
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">Your Vello NFT images</h2>
          <CheckCircle2 className="size-5 text-emerald-400" />
        </div>
        <p className="text-sm text-muted-foreground">
          Same character, 3 angles. Select which to use as your agent&apos;s profile NFT.
        </p>
        <div className="grid grid-cols-3 gap-4">
          {generatedImages.map((img) => {
            const isSelected = selectedUrl === img.rawUrl;
            return (
              <div
                key={img.rawUrl}
                onClick={() => { setSelectedUrl(img.rawUrl); setSelectedDisplayUrl(img.url); }}
                className={`rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${
                  isSelected ? "border-emerald-500 shadow-lg shadow-emerald-950/30" : "border-border hover:border-emerald-500/40"
                }`}
              >
                <div className="aspect-square relative bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.label}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {isSelected && (
                    <div className="absolute top-2 right-2 size-6 rounded-full bg-emerald-500 flex items-center justify-center">
                      <CheckCircle2 className="size-4 text-white" />
                    </div>
                  )}
                </div>
                <div className="px-3 py-2 bg-card/60">
                  <p className="text-xs font-medium">{img.label}</p>
                  <p className="text-[10px] text-muted-foreground">{isSelected ? "Selected ✓" : "Click to select"}</p>
                </div>
              </div>
            );
          })}
        </div>
        {error && <ErrorBanner msg={error} />}
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2" onClick={handleGenerate}>
            <RefreshCw className="size-4" /> Regenerate
          </Button>
          <Button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 gap-2 h-10"
            disabled={!selectedUrl}
            onClick={() => setStep("configure")}
          >
            Configure Agent <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Configure ──
  if (step === "configure") {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <StepDots step={step} onBack={() => setStep("preview")} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* NFT preview + traits */}
          <div className="space-y-4">
            <div className="rounded-xl overflow-hidden border border-emerald-500/30 aspect-square bg-muted">
              {selectedDisplayUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedDisplayUrl} alt="NFT" className="w-full h-full object-cover" />
              )}
            </div>
            <div className="rounded-xl bg-card border border-border p-3 space-y-2.5">
              {(["warmth", "humor", "authority", "boldness"] as const).map((trait) => (
                <div key={trait} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground capitalize">{trait}</span>
                    <span className="font-mono">{config[trait]}</span>
                  </div>
                  <div className="h-1 rounded-full bg-muted">
                    <div className={`h-full rounded-full ${TRAIT_COLORS[trait]}`} style={{ width: `${config[trait]}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Form */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-bold">Configure your agent</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Agent name *</Label>
                <Input placeholder="e.g. Aisha Rahman" value={config.name} className="bg-muted/30"
                  onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Handle *</Label>
                <Input placeholder="@handle" value={config.handle} className="bg-muted/30"
                  onChange={(e) => setConfig((c) => ({ ...c, handle: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Niche</Label>
                <Select value={config.niche} onValueChange={(v) => v && setConfig((c) => ({ ...c, niche: v }))}>
                  <SelectTrigger className="bg-muted/30 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["lifestyle","tech","fashion","fitness","food","travel","finance","gaming"].map((n) => (
                      <SelectItem key={n} value={n} className="capitalize">{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Language</Label>
                <Select value={config.language} onValueChange={(v) => v && setConfig((c) => ({ ...c, language: v }))}>
                  <SelectTrigger className="bg-muted/30 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[["en","English"],["ms","Malay"],["id","Indonesian"],["ar","Arabic"],["zh","Chinese"],["hi","Hindi"]].map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea rows={3} className="bg-muted/30 resize-none text-sm" value={config.description}
                onChange={(e) => setConfig((c) => ({ ...c, description: e.target.value }))} />
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {(["warmth","humor","authority","boldness"] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <div className="flex justify-between">
                    <Label className="text-xs capitalize">{key}</Label>
                    <span className="text-xs font-mono text-muted-foreground">{config[key]}</span>
                  </div>
                  <input type="range" min={1} max={100} value={config[key]}
                    onChange={(e) => setConfig((c) => ({ ...c, [key]: parseInt(e.target.value) }))}
                    className="w-full accent-emerald-500" />
                </div>
              ))}
            </div>
            {error && <ErrorBanner msg={error} />}
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 gap-2 h-11"
              disabled={!config.name || !config.handle}
              onClick={handleMint}
            >
              <Rocket className="size-4" />
              Mint AI Influencer NFT
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Minting ──
  if (step === "minting") {
    return (
      <div className="max-w-xl mx-auto flex flex-col items-center justify-center gap-6 py-20">
        <div className="relative size-20">
          <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
          <div className="relative size-20 rounded-full bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center">
            <Rocket className="size-8 text-white" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold">Minting your NFT…</h2>
          <p className="text-sm text-muted-foreground">Saving your influencer…</p>
        </div>
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Done ──
  if (step === "done") {
    return (
      <div className="max-w-xl mx-auto flex flex-col items-center gap-6 py-16 text-center">
        <div className="size-20 rounded-full bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center">
          <CheckCircle2 className="size-10 text-white" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Agent Minted!</h2>
          <p className="text-muted-foreground text-sm">Your AI Influencer NFT is live in the market.</p>
        </div>
        {selectedUrl && (
          <div className="size-32 rounded-2xl overflow-hidden border-2 border-emerald-500/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selectedUrl} alt="NFT" className="w-full h-full object-cover" />
          </div>
        )}
        <p className="rounded-xl bg-muted/30 border border-border px-5 py-2 font-mono text-xs text-muted-foreground break-all">
          {mintResult}
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={reset}>Mint Another</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => window.location.href = mintResult ? `/market/${mintResult}` : "/studio"}
          >
            View in Market →
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

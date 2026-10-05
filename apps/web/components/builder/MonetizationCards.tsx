"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Briefcase, Clapperboard, Check, Loader2, Lock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { AgentBlueprint } from "@/lib/builder/agentTypes";

/**
 * Persist monetization config via the SIWS-owner-gated /api/agents/config route.
 * The underlying influencers.setMonetization mutation is now secret-gated and can
 * no longer be called from the browser; auth (Privy Bearer + X-Siws-Session) is
 * auto-attached by the global fetch interceptor. Throws on failure so the caller's
 * existing try/catch surfaces the error.
 */
async function saveMonetization(mintAddress: string, monetization: Monetization): Promise<void> {
  const res = await fetch("/api/agents/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mintAddress, kind: "monetization", payload: monetization }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
}

type Monetization = {
  hiringEnabled?: boolean;
  videosPerMonth?: number;
  monthlyRate?: number;
  perVideoEnabled?: boolean;
  costPerVideo?: number;
  requirementPrompt?: string;
};

/**
 * Editable builder body cards driven by the two monetization skills:
 *  - "Marketplace Hiring" (monetize.hiring)   → videos/month + monthly rate
 *  - "Charge Per Video"   (monetize.pervideo) → cost per video + requirement prompt
 *
 * Values persist to the minted agent's `influencers.monetization` and surface to
 * clients on the Hire Agents page. Pre-mint the cards preview but can't save yet.
 */
export default function MonetizationCards({
  blueprint,
  mintAddress,
}: {
  blueprint: AgentBlueprint;
  mintAddress?: string;
}) {
  const installed = blueprint.installedSkills ?? [];
  const showHiring = installed.includes("monetize.hiring");
  const showPerVideo = installed.includes("monetize.pervideo");
  if (!showHiring && !showPerVideo) return null;

  return (
    <div className="flex flex-col gap-4">
      {showHiring && <HiringCard mintAddress={mintAddress} />}
      {showPerVideo && <PerVideoCard mintAddress={mintAddress} />}
    </div>
  );
}

/* ── shared persistence hook ───────────────────────────────────────────────── */

function useMonetization(mintAddress?: string) {
  const doc = useQuery(
    api.influencers.getByMint,
    mintAddress ? { mintAddress } : "skip",
  ) as { monetization?: Monetization } | null | undefined;
  return { current: doc?.monetization ?? {}, mintAddress };
}

/** Debounced saver — shows a transient "saved" tick. */
function useDebouncedSave(mintAddress: string | undefined) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = (patch: Monetization) => {
    if (!mintAddress) return;
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await saveMonetization(mintAddress, patch);
        setState("saved");
        setTimeout(() => setState("idle"), 1400);
      } catch {
        setState("idle");
      }
    }, 600);
  };
  return { state, commit };
}

const PAPER = {
  card: "rounded-xl border border-zinc-300/70 bg-white p-4",
  label: "text-[11px] font-semibold text-zinc-500 mb-1.5 block",
  input: "w-full h-9 rounded-lg border border-zinc-300 bg-white px-3 text-[13px] text-zinc-900 outline-none focus:border-zinc-900 transition-colors tabular-nums",
};

function SaveBadge({ state, mintAddress }: { state: "idle" | "saving" | "saved"; mintAddress?: string }) {
  if (!mintAddress) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-400">
        <Lock className="size-3" /> Mint to publish
      </span>
    );
  }
  if (state === "saving") return <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400"><Loader2 className="size-3 animate-spin" /> Saving</span>;
  if (state === "saved") return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600"><Check className="size-3" /> Saved</span>;
  return null;
}

/* ── Marketplace Hiring ────────────────────────────────────────────────────── */

function HiringCard({ mintAddress }: { mintAddress?: string }) {
  const { current } = useMonetization(mintAddress);
  const { state, commit } = useDebouncedSave(mintAddress);
  const [videos, setVideos] = useState<string>("");
  const [rate, setRate] = useState<string>("");

  // Seed from the persisted doc once it loads.
  useEffect(() => {
    setVideos(current.videosPerMonth != null ? String(current.videosPerMonth) : "");
    setRate(current.monthlyRate != null ? String(current.monthlyRate) : "");
  }, [current.videosPerMonth, current.monthlyRate]);

  const v = Number(videos) || 0;
  const r = Number(rate) || 0;
  const perVideo = v > 0 ? r / v : 0;

  const push = (nextVideos: number, nextRate: number) =>
    commit({ hiringEnabled: true, videosPerMonth: nextVideos, monthlyRate: nextRate });

  return (
    <div className={PAPER.card}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-emerald-100 text-emerald-700">
            <Briefcase className="size-3.5" />
          </span>
          <span className="text-[13px] font-bold text-zinc-900">Marketplace Hiring</span>
        </div>
        <SaveBadge state={state} mintAddress={mintAddress} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={PAPER.label}>Videos / month</label>
          <input
            type="number" min={0} inputMode="numeric" disabled={!mintAddress}
            value={videos}
            onChange={(e) => { setVideos(e.target.value); push(Number(e.target.value) || 0, r); }}
            placeholder="8"
            className={PAPER.input}
          />
        </div>
        <div>
          <label className={PAPER.label}>Monthly rate (USDC)</label>
          <input
            type="number" min={0} inputMode="decimal" step="any" disabled={!mintAddress}
            value={rate}
            onChange={(e) => { setRate(e.target.value); push(v, Number(e.target.value) || 0); }}
            placeholder="30"
            className={PAPER.input}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
        <span className="text-[11px] text-zinc-500">Effective per video</span>
        <span className="text-[13px] font-bold text-zinc-900 tabular-nums">
          {perVideo > 0 ? `$${perVideo.toFixed(2)}` : "-"}
        </span>
      </div>
    </div>
  );
}

/* ── Charge Per Video ──────────────────────────────────────────────────────── */

function PerVideoCard({ mintAddress }: { mintAddress?: string }) {
  const { current } = useMonetization(mintAddress);
  const { state, commit } = useDebouncedSave(mintAddress);
  const [cost, setCost] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");

  useEffect(() => {
    setCost(current.costPerVideo != null ? String(current.costPerVideo) : "");
    setPrompt(current.requirementPrompt ?? "");
  }, [current.costPerVideo, current.requirementPrompt]);

  const push = (nextCost: number, nextPrompt: string) =>
    commit({ perVideoEnabled: true, costPerVideo: nextCost, requirementPrompt: nextPrompt });

  return (
    <div className={PAPER.card}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-emerald-100 text-emerald-700">
            <Clapperboard className="size-3.5" />
          </span>
          <span className="text-[13px] font-bold text-zinc-900">Charge Per Video</span>
        </div>
        <SaveBadge state={state} mintAddress={mintAddress} />
      </div>

      <label className={PAPER.label}>Cost per video (USDC)</label>
      <input
        type="number" min={0} inputMode="decimal" step="any" disabled={!mintAddress}
        value={cost}
        onChange={(e) => { setCost(e.target.value); push(Number(e.target.value) || 0, prompt); }}
        placeholder="1"
        className={PAPER.input}
      />

      <label className={`${PAPER.label} mt-3`}>Requirement prompt</label>
      <textarea
        rows={4} disabled={!mintAddress}
        value={prompt}
        onChange={(e) => { setPrompt(e.target.value); push(Number(cost) || 0, e.target.value); }}
        placeholder="What every commissioned video must do, e.g. show the product in the first 2s, energetic UGC style, end with a clear CTA to the link."
        className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[12.5px] leading-relaxed text-zinc-900 outline-none focus:border-zinc-900 transition-colors"
      />
      <p className="mt-1.5 text-[10.5px] text-zinc-500">
        Clients pay this per video and the agent follows this brief for every commission.
      </p>
    </div>
  );
}

"use client";
import { useState } from "react";
import { CREDIT_PACKS, SUBSCRIPTION_TIERS } from "@/lib/shared/creditPricing";

const PACKS = Object.entries(CREDIT_PACKS).map(([id, p]) => ({ id, ...p }));

// Names and prices match the live four-plan pricing page (Free has no checkout).
// pull from the same lib/shared/creditPricing.ts. Starter is free there, so
// it has no credit subscription.
const TIER_LABELS: Record<keyof typeof SUBSCRIPTION_TIERS, string> = { starter: "Starter", creator: "Creator", growth: "Growth" };
const TIERS = Object.entries(SUBSCRIPTION_TIERS).map(([id, t]) => ({ id, label: TIER_LABELS[id as keyof typeof SUBSCRIPTION_TIERS], ...t }));

export function TopUpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"packs" | "subscribe">("packs");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  async function buy(body: { pack: string } | { tier: string }) {
    const key = "pack" in body ? body.pack : body.tier;
    setLoading(key);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Checkout failed");
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 animate-in fade-in-0 duration-200">
      <div className="w-full max-w-md rounded-lg border border-white/15 bg-neutral-950 p-6 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-250 ease-out">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Add credits</h2>
          <button onClick={onClose} className="text-white/50 transition-colors hover:text-white">✕</button>
        </div>

        <div className="mb-4 flex gap-1 rounded-lg border border-white/15 bg-white/[0.04] p-1">
          <button
            onClick={() => setTab("packs")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "packs" ? "bg-white/[0.12] text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            One-time
          </button>
          <button
            onClick={() => setTab("subscribe")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "subscribe" ? "bg-white/[0.12] text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            Subscribe
          </button>
        </div>

        {tab === "packs" ? (
          <div className="grid grid-cols-2 gap-3">
            {PACKS.map((p, i) => (
              <button
                key={p.id}
                disabled={loading !== null}
                onClick={() => buy({ pack: p.id })}
                style={{ animationDelay: `${i * 40}ms` }}
                className="animate-in fade-in-0 slide-in-from-bottom-1 rounded-lg border border-white/15 bg-white/[0.06] p-4 text-left transition-all duration-200 hover:border-white/25 hover:bg-white/[0.09] hover:scale-[1.02] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
              >
                <div className="text-xl font-semibold text-white">${p.usd}</div>
                <div className="text-sm text-white/60">{p.credits.toLocaleString()} credits</div>
                {loading === p.id && <div className="mt-1 text-xs text-white/40">Redirecting…</div>}
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {TIERS.map((t, i) => (
              <button
                key={t.id}
                disabled={loading !== null}
                onClick={() => buy({ tier: t.id })}
                style={{ animationDelay: `${i * 40}ms` }}
                className="flex animate-in fade-in-0 slide-in-from-bottom-1 items-center justify-between rounded-lg border border-white/15 bg-white/[0.06] p-4 text-left transition-all duration-200 hover:border-white/25 hover:bg-white/[0.09] hover:scale-[1.01] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
              >
                <div>
                  <div className="text-xl font-semibold text-white">{t.label}</div>
                  <div className="text-sm text-white/60">{t.creditsPerMonth.toLocaleString()} credits / month</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-white">${t.usd}</div>
                  <div className="text-xs text-white/40">/ month</div>
                  {loading === t.id && <div className="mt-1 text-xs text-white/40">Redirecting…</div>}
                </div>
              </button>
            ))}
          </div>
        )}

        {error && <p className="mt-3 animate-in fade-in-0 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}

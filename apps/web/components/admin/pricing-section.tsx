"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Loader2, RefreshCw, Tag, RotateCcw, Check } from "lucide-react";
import { timeAgo } from "@/components/admin/util";
import { MAX_SKILL_PRICE_USDC, isValidSkillPrice } from "@/lib/economy/servicePrices";
import { CLIP_SKILL_BY_ID } from "@/lib/builder/clipSkillsCatalog";
import type { SkillPriceRow } from "@/convex/adminPricing";

/** Display meta for priceable rows that are NOT clip skills (so they have no
 *  clipSkillsCatalog entry) — e.g. the auto-post fee (social_post). Merged as a
 *  fallback after CLIP_SKILL_BY_ID so these render with a label + icon, not blank. */
const EXTRA_SKILL_META: Record<string, { name: string; icon: string }> = {
  social_post: { name: "Auto Post", icon: "📤" },
};

/**
 * Admin "Pricing" tab — edit the per-run price charged to agents for each
 * marketplace clip skill. An edited price writes a `skillPriceOverrides` row
 * (via the admin-gated setSkillPrice action); "Reset" clears it back to the
 * static default. The charge path (usage.recordUsage) reads the override at bill
 * time, and swept fees land in the Vello treasury unchanged.
 */
export function PricingSection() {
  const { accessToken } = useSupabaseAuth();
  const listSkillPrices = useAction(api.adminPricing.listSkillPrices);
  const setSkillPrice = useAction(api.adminPricing.setSkillPrice);
  const clearSkillPrice = useAction(api.adminPricing.clearSkillPrice);

  const [rows, setRows] = useState<SkillPriceRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Per-skill draft input value + busy/error state.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rowErr, setRowErr] = useState<Record<string, string | null>>({});

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      setErr(null);
      const data = await listSkillPrices({ accessToken });
      setRows(data);
      // Seed each draft from the effective price (only for rows the user hasn't touched).
      setDraft((prev) => {
        const next = { ...prev };
        for (const r of data) if (next[r.skillId] === undefined) next[r.skillId] = String(r.effectiveUsdc);
        return next;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, [accessToken, listSkillPrices]);


  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (skillId: string) => {
    if (!accessToken) return;
    const raw = draft[skillId];
    const priceUsdc = Number(raw);
    if (!isValidSkillPrice(priceUsdc)) {
      setRowErr((p) => ({ ...p, [skillId]: `Enter a price between $0 and $${MAX_SKILL_PRICE_USDC}` }));
      return;
    }
    setBusy((p) => ({ ...p, [skillId]: true }));
    setRowErr((p) => ({ ...p, [skillId]: null }));
    try {
      await setSkillPrice({ accessToken, skillId, priceUsdc });
      await refresh();
    } catch (e) {
      setRowErr((p) => ({ ...p, [skillId]: e instanceof Error ? e.message : "Save failed" }));
    } finally {
      setBusy((p) => ({ ...p, [skillId]: false }));
    }
  }, [accessToken, draft, setSkillPrice, refresh]);

  const reset = useCallback(async (skillId: string, staticDefault: number) => {
    if (!accessToken) return;
    setBusy((p) => ({ ...p, [skillId]: true }));
    setRowErr((p) => ({ ...p, [skillId]: null }));
    try {
      await clearSkillPrice({ accessToken, skillId });
      setDraft((p) => ({ ...p, [skillId]: String(staticDefault) }));
      await refresh();
    } catch (e) {
      setRowErr((p) => ({ ...p, [skillId]: e instanceof Error ? e.message : "Reset failed" }));
    } finally {
      setBusy((p) => ({ ...p, [skillId]: false }));
    }
  }, [accessToken, clearSkillPrice, refresh]);

  const overrideCount = useMemo(() => (rows ?? []).filter((r) => r.overrideUsdc !== undefined).length, [rows]);

  if (rows === null) {
    if (err) {
      return (
        <div className="py-20 text-center text-[13px] text-zinc-600">
          Failed to load: <span className="text-amber-400">{err}</span>
          <div className="mt-3"><button onClick={() => void refresh()} className="text-emerald-400 hover:underline">Retry</button></div>
        </div>
      );
    }
    return <div className="py-20 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#18181c] flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-bold text-white flex items-center gap-2"><Tag className="size-4 text-emerald-400" />Marketplace pricing</h2>
            <p className="text-[11.5px] text-zinc-600 mt-0.5">
              Per-run price charged to agents for each clip skill and the auto-post fee. Edits apply on the next run; fees are swept on-chain to the Vello treasury.
              {overrideCount > 0 ? <span className="text-amber-400"> · {overrideCount} override{overrideCount === 1 ? "" : "s"} active</span> : null}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {err && <span className="text-[11px] text-amber-400">{err}</span>}
            <button onClick={() => void refresh()} className="text-zinc-600 hover:text-zinc-300 p-1.5 rounded-lg hover:bg-white/5"><RefreshCw className="size-3.5" /></button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#1e1e24] bg-[#0a0a0d] text-zinc-600">
                <th className="py-3 px-4 text-left font-medium">Skill</th>
                <th className="py-3 px-4 text-right font-medium">Default</th>
                <th className="py-3 px-4 text-right font-medium">Charged / run (USDC)</th>
                <th className="py-3 px-4 text-left font-medium">Override</th>
                <th className="py-3 px-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = CLIP_SKILL_BY_ID[r.skillId] ?? EXTRA_SKILL_META[r.skillId];
                const overridden = r.overrideUsdc !== undefined;
                const draftVal = draft[r.skillId] ?? String(r.effectiveUsdc);
                const parsed = Number(draftVal);
                const validDraft = draftVal.trim() !== "" && isValidSkillPrice(parsed);
                const dirty = validDraft && +parsed.toFixed(6) !== +r.effectiveUsdc.toFixed(6);
                const isBusy = busy[r.skillId] === true;
                return (
                  <tr key={r.skillId} className="border-b border-[#16161a] last:border-0 hover:bg-white/[0.015] align-top">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg leading-none">{meta?.icon ?? "🎬"}</span>
                        <div>
                          <div className="font-semibold text-white">{meta?.name ?? r.skillId}</div>
                          <div className="font-mono text-[10.5px] text-zinc-600">{r.skillId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-zinc-500">${r.staticDefaultUsdc.toFixed(2)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-zinc-600">$</span>
                        <input
                          type="number" min="0" max={MAX_SKILL_PRICE_USDC} step="0.01"
                          value={draftVal}
                          disabled={isBusy}
                          onChange={(e) => setDraft((p) => ({ ...p, [r.skillId]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter" && dirty && !isBusy) void save(r.skillId); }}
                          className={`w-24 h-8 rounded-lg border bg-transparent px-2 text-right font-mono text-[12.5px] text-white outline-none focus:border-zinc-500 ${
                            validDraft ? "border-[#1e1e24]" : "border-red-500/60"
                          }`}
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {overridden ? (
                        <span className="inline-flex flex-col">
                          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-400">
                            override ${r.overrideUsdc!.toFixed(2)}
                          </span>
                          <span className="mt-1 text-[10px] text-zinc-600">
                            {r.updatedByEmail ? `by ${r.updatedByEmail}` : ""} {r.updatedAt ? `· ${timeAgo(r.updatedAt)}` : ""}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-zinc-700">default</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        {rowErr[r.skillId] && <span className="text-[10.5px] text-red-400 max-w-[160px] text-right">{rowErr[r.skillId]}</span>}
                        <button
                          onClick={() => void save(r.skillId)}
                          disabled={!dirty || isBusy}
                          className={`inline-flex items-center gap-1 h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors ${
                            dirty && !isBusy ? "bg-emerald-500/90 hover:bg-emerald-500 text-white" : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                          }`}
                        >
                          {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
                        </button>
                        <button
                          onClick={() => void reset(r.skillId, r.staticDefaultUsdc)}
                          disabled={!overridden || isBusy}
                          title="Reset to default"
                          className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[12px] font-medium transition-colors ${
                            overridden && !isBusy ? "border border-[#27272a] text-zinc-400 hover:bg-white/5" : "border border-[#1a1a1e] text-zinc-700 cursor-not-allowed"
                          }`}
                        >
                          <RotateCcw className="size-3.5" /> Reset
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-zinc-700">No priced skills.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

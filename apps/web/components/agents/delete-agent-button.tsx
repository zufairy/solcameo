"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

export function DeleteAgentButton({ mintAddress, name }: { mintAddress: string; name: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mintAddress }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not delete agent.");
      window.dispatchEvent(new Event("agents-changed"));
      setConfirm(false);
      router.push("/control");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete agent.");
    } finally { setBusy(false); }
  }
  return <>
    <button onClick={() => setConfirm(true)} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-400/20 px-4 py-2 text-sm text-red-300 hover:bg-red-400/10"><Trash2 className="size-4" />Delete agent</button>
    {confirm && <div className="fixed inset-0 z-[250] grid place-items-center bg-black/70 p-5 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-label="Delete agent" className="w-full max-w-md rounded-2xl border border-white/10 bg-[#141416] p-6">
        <h2 className="text-lg font-semibold text-white">Delete {name}?</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">This permanently removes the agent and its clips and schedule. Any USDC in its agent wallet is returned to the owner wallet first. Deleting frees an agent slot.</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        <div className="mt-5 flex gap-3">
          <button disabled={busy} onClick={() => void remove()} className="inline-flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 className="size-4 animate-spin" />}Delete agent</button>
          <button disabled={busy} onClick={() => { setConfirm(false); setError(null); }} className="rounded-full border border-white/10 px-4 py-2 text-sm text-white disabled:opacity-50">Cancel</button>
        </div>
      </section>
    </div>}
  </>;
}

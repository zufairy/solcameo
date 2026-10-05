"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

/** Premium double-confirm modal for destructive deletes. Portaled to <body> so
 *  it escapes any card's overflow/transform; Esc + backdrop cancel (blocked
 *  while a delete is in flight). */
export function ConfirmDeleteDialog({
  open, title, description, confirmLabel = "Delete", busy = false, error, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
          onClick={(e) => { e.stopPropagation(); if (!busy) onCancel(); }}
        >
          <motion.div
            role="alertdialog" aria-modal="true" aria-label={title}
            initial={{ opacity: 0, y: 14, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
          >
            <div className="grid size-10 place-items-center rounded-xl bg-rose-500/12 ring-1 ring-rose-500/30">
              <AlertTriangle className="size-5 text-rose-400" />
            </div>
            <h3 className="mt-3.5 text-[15px] font-semibold text-white">{title}</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-400">{description}</p>
            {error && <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-300">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={onCancel} disabled={busy}
                className="rounded-lg border border-white/10 px-3.5 py-2 text-[12.5px] text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-40">
                Cancel
              </button>
              <button type="button" onClick={onConfirm} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-rose-400 disabled:opacity-60">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {busy ? "Deleting…" : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** POST JSON to a delete route; returns an error string or null. */
export async function postDelete(url: string, body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || j.ok === false) return j.error || `Delete failed (${res.status})`;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Delete failed";
  }
}

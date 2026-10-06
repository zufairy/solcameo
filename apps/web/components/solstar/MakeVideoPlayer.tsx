"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { X, ArrowUpRight } from "lucide-react";

export function MakeVideoPlayer({ video, onClose }: { video: { url: string; poster?: string | null; name: string; ticker?: string; cap?: string; characterId: string | null }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { el?.close(); document.body.style.overflow = overflow; };
  }, []);
  return (
    <dialog ref={dialog} aria-label={`${video.name} video player`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-black/65 p-3 text-white backdrop-blur-2xl backdrop:bg-black/30 sm:p-6">
      <motion.div initial={reduced ? false : { opacity: 0, scale: 0.94, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: reduced ? 1 : 0.97 }} transition={{ type: "spring", stiffness: 280, damping: 30 }} className="pointer-events-none flex h-full flex-col items-center justify-center">
        <div className="pointer-events-auto flex w-full max-w-6xl items-center justify-between gap-4 pb-4">
          <div className="min-w-0"><p className="text-xs font-semibold tracking-widest text-lime-300">{video.ticker ? `$${video.ticker}` : "CREATOR VIDEO"}</p><h2 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{video.name}</h2>{video.cap && <p className="mt-1 text-sm text-white/60">{video.cap} market cap</p>}</div>
          <div className="flex shrink-0 items-center gap-2">{video.characterId && <Link href={`/market/${video.characterId}`} className="flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs backdrop-blur-xl">Market <ArrowUpRight className="size-3.5" /></Link>}<button autoFocus onClick={onClose} aria-label="Close video" className="grid size-10 place-items-center rounded-full border border-white/15 bg-white/10 transition hover:bg-white/20"><X className="size-5" /></button></div>
        </div>
        <video src={video.url} poster={video.poster ?? undefined} autoPlay controls playsInline className="pointer-events-auto min-h-0 w-full max-w-6xl flex-1 rounded-2xl border border-white/10 bg-black/60 object-contain shadow-2xl" />
        <p className="pt-3 text-xs text-white/40">Use the player controls to seek, adjust volume, or enter fullscreen.</p>
      </motion.div>
    </dialog>
  );
}

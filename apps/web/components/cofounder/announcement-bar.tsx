"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { motion } from "framer-motion";

/**
 * Minimal lime announcement strip above the hero. Dismissible via an X — the
 * choice persists per-browser so a returning visitor doesn't see it again.
 * Futuristic wordmark via Space Grotesk (--font-space).
 */
export function AnnouncementBar() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem("vello_announce_dismissed") === "1") setShow(false);
    } catch { /* ignore */ }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem("vello_announce_dismissed", "1"); } catch { /* ignore */ }
  };

  return (
    <motion.div
      className="relative z-30 w-full overflow-hidden bg-lime-400 text-black"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      transition={{ delay: 2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      <a
        href="/login"
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
      >
        <p
          className="mx-auto max-w-[1600px] px-10 py-2 text-center text-[10.5px] font-semibold uppercase leading-tight tracking-[0.16em] sm:text-[12px] sm:tracking-[0.2em]"
          style={{ fontFamily: "var(--font-space)" }}
        >
          <span className="font-bold">Get your free agent &amp; start earning</span>{" "}
          <span aria-hidden>&rarr;</span>
        </p>
      </a>
      <button
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-black/70 transition-colors hover:bg-black/10 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
      >
        <X className="size-4" />
      </button>
    </motion.div>
  );
}

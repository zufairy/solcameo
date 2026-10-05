"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { ReactNode } from "react";

const EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Premium full-screen mint moment. When `open`, blurs + darkens the whole app
 * behind a slowly-drifting lime gradient and floats the mint card centered.
 * Used for ALL agent types so minting always feels like an event.
 */
export default function MintOverlay({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="mint-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="fixed inset-0 z-[60] grid place-items-center px-4"
        >
          {/* dark blurred backdrop + animated lime gradient */}
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={onClose} />
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="vello-mint-sweep absolute inset-[-20%]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.7)_85%)]" />
          </div>

          {/* close */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-5 top-5 grid size-9 place-items-center rounded-full bg-white/[0.06] text-white/70 ring-1 ring-white/10 transition-colors hover:bg-white/[0.12] hover:text-white"
          >
            <X className="size-4" />
          </button>

          {/* centered card */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.55, ease: EASE }}
            className="relative w-full max-w-2xl"
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

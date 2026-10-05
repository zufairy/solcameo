"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { X } from "lucide-react";
import { AuthForm, EASE_OUT } from "@/components/auth/auth-form";
import velloLogo from "@/assets/lo.png";

/** Landing-page auth modal — the /login form (same AuthForm, same look)
 *  animating up out of a blurred backdrop instead of a route change.
 *  Spring-scales in with a blur-sharpen, closes on ESC / backdrop / X. */
export function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();

  // ESC to close + lock page scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE_OUT }}
          aria-modal
          role="dialog"
        >
          {/* Backdrop — dim + blur the landing page behind the card. */}
          <motion.div
            className="absolute inset-0 bg-black/70"
            initial={{ backdropFilter: "blur(0px)" }}
            animate={{ backdropFilter: "blur(10px)" }}
            exit={{ backdropFilter: "blur(0px)" }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            onClick={onClose}
          />

          {/* Card — rises, sharpens, and springs to rest like the login page's
              own stagger, carried by one parent motion so it feels physical. */}
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.94, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 18, scale: 0.96, filter: "blur(8px)" }}
            transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.9 }}
            className="relative w-full max-w-[400px] rounded-2xl border border-white/12 bg-[#0b0f0a]/95 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/[0.05] backdrop-blur-2xl"
          >
            {/* Soft lime glow echoing the login page's animated backdrop. */}
            <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-lime-400/15 blur-3xl" />

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3.5 top-3.5 grid size-8 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" />
            </button>

            <div className="mb-6 flex justify-center">
              <Image src={velloLogo} alt="Vello" className="h-7 w-auto object-contain" />
            </div>

            <AuthForm onSuccess={(mode) => { onClose(); router.push(mode === "signup" ? "/builder" : "/home"); }} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

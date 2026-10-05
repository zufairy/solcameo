"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { IconArrowUpRight } from "./icons";
import machLogo from "@/assets/lo.png";

const EASE = [0.32, 0.72, 0, 1] as const;

const LINKS = [
  { label: "What is Vello", href: "#what" },
  { label: "Verticals", href: "#verticals" },
  { label: "How it works", href: "#how" },
];

function Wordmark() {
  return (
    <Link href="#top" className="flex items-center shrink-0">
      <Image src={machLogo} alt="Vello" width={110} height={33} priority className="h-8 w-auto object-contain" />
    </Link>
  );
}

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));

  return (
    <>
      <motion.header
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
        className="fixed inset-x-0 top-0 z-40 flex justify-center px-4 pointer-events-none"
      >
        <nav
          className={`pointer-events-auto mt-5 flex items-center gap-2 rounded-full border border-white/10 px-2 py-2 pl-5 backdrop-blur-2xl transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            scrolled ? "bg-[#0B0D0A]/80 shadow-[0_10px_44px_-16px_rgba(163,230,53,0.35)]" : "bg-white/[0.04]"
          }`}
        >
          <Wordmark />
          <div className="hidden md:flex items-center gap-1 ml-4">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-full px-3.5 py-1.5 text-[13px] text-zinc-400 transition-colors duration-300 hover:text-white"
              >
                {l.label}
              </a>
            ))}
          </div>

          <Link
            href="/studio/build"
            className="vello-cta group ml-1 hidden md:flex items-center gap-1.5 rounded-full py-1.5 pl-3.5 pr-1.5 text-[12.5px] font-semibold"
          >
            Sign Up
            <span className="grid h-6 w-6 place-items-center rounded-full bg-black/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105">
              <IconArrowUpRight className="h-3 w-3" />
            </span>
          </Link>

          {/* Hamburger → X morph */}
          <button
            aria-label="Menu"
            onClick={() => setOpen((v) => !v)}
            className="md:hidden relative grid h-9 w-9 place-items-center rounded-full bg-white/5"
          >
            <span className={`absolute h-px w-4 bg-white transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "rotate-45" : "-translate-y-1"}`} />
            <span className={`absolute h-px w-4 bg-white transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "-rotate-45" : "translate-y-1"}`} />
          </button>
        </nav>
      </motion.header>

      {/* Full-screen glass overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="fixed inset-0 z-30 flex flex-col justify-center gap-2 px-8 backdrop-blur-3xl bg-black/85 md:hidden"
          >
            {LINKS.map((l, i) => (
              <motion.a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                initial={{ opacity: 0, y: 36 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.08 + i * 0.06 }}
                className="font-[family-name:var(--font-space)] text-4xl font-medium tracking-tight text-zinc-300"
              >
                {l.label}
              </motion.a>
            ))}
            <motion.div
              initial={{ opacity: 0, y: 36 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.08 + LINKS.length * 0.06 }}
              className="mt-8"
            >
              <Link
                href="/studio/build"
                onClick={() => setOpen(false)}
                className="vello-cta inline-flex items-center gap-2 rounded-full py-3 pl-6 pr-2.5 text-sm font-semibold"
              >
                Sign Up
                <span className="grid h-8 w-8 place-items-center rounded-full bg-black/10">
                  <IconArrowUpRight className="h-4 w-4" />
                </span>
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

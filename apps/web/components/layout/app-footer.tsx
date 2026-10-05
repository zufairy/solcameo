"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Gauge, Settings, Moon, Sun, MessageSquare, FileText } from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { useInSolstarShell } from "./shell-context";

/* Shared app status-bar footer — rendered once in the root layout so every app
   page (Market, Influencers, Generations, Jobs, Pricing, Build, My Agents,
   Wallet) gets the SAME footer. Hidden on the marketing/full-screen routes that
   render their own chrome (matches the global TopNav's hide list).

   Colours are token-driven (bg-background / border-border / *-foreground) so the
   footer flips with the light/dark theme toggle below. */

export function AppFooter() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const inShell = useInSolstarShell();
  // The global shell replaces this footer.
  if (inShell) return null;
  // Same hide list as TopNav — these pages own their full-screen chrome.
  if (pathname === "/" || pathname === "/landing" || pathname === "/pricing" || pathname === "/1b-club") return null;
  if (pathname.startsWith("/builder") || pathname.startsWith("/hiring") || pathname.startsWith("/docs")) return null;
  if (pathname.startsWith("/node")) return null;
  if (pathname.startsWith("/home")) return null;
  if (pathname.startsWith("/agents")) return null;
  if (pathname === "/stage" || pathname === "/stage/create") return null;
  if (pathname.startsWith("/swarm")) return null;
  if (pathname.startsWith("/tournament")) return null;
  if (pathname.startsWith("/generations")) return null;
  if (pathname.startsWith("/earnings")) return null;
  // Arena renders AppHeaderShell (same header as /agents).
  if (pathname.startsWith("/arena")) return null;
  // Landing pages that render their OWN cofounder Navigation + Footer — this
  // marketing chrome on top of theirs was the "two headers" bug when logged in.
  if (pathname.startsWith("/ai-influencer")) return null;
  if (pathname.startsWith("/blog")) return null;
  if (pathname.startsWith("/vs/")) return null;
  if (pathname.startsWith("/market/")) return null;
  if (pathname.startsWith("/documentary")) return null;
  if (pathname.startsWith("/admin")) return null;
  if (pathname.startsWith("/studio")) return null;
  if (pathname.startsWith("/analytics")) return null;
  if (pathname.startsWith("/control")) return null;
  if (pathname.startsWith("/dev/")) return null;
  if (pathname.startsWith("/login")) return null;
  if (pathname.startsWith("/carousel")) return null;
  if (pathname.startsWith("/recreate")) return null;

  return (
    <footer className="shrink-0 border-t border-border bg-background">
      <div className="flex h-9 items-center gap-3 px-4 text-[11.5px] text-muted-foreground sm:gap-4 sm:px-5">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-foreground">◎</span>{" "}
          <span className="font-semibold tabular-nums text-foreground">$80.10</span>
        </span>
        <span className="tabular-nums">TPS: <span className="text-foreground">3,792</span></span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Live Data
        </span>

        <div className="flex-1" />

        <span className="hidden items-center gap-1.5 sm:inline-flex"><Gauge className="size-3.5" /> Standard</span>
        <button className="hidden transition-colors hover:text-foreground sm:inline-flex" aria-label="Settings"><Settings className="size-3.5" /></button>

        {/* Theme toggle — dark ↔ light, animated. The System/desktop option was removed. */}
        <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
          <ThemeChip active={theme === "dark"} label="Dark theme" onClick={() => setTheme("dark")}>
            <Moon className="size-3.5" />
          </ThemeChip>
          <ThemeChip active={theme === "light"} label="Light theme" onClick={() => setTheme("light")}>
            <Sun className="size-3.5" />
          </ThemeChip>
        </div>

        {/* Docs — opens the documentation site */}
        <Link
          href="/docs"
          className="inline-flex items-center gap-1.5 rounded outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-pink-400"
        >
          <FileText className="size-3.5" /> Docs
        </Link>
        <button className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
          <MessageSquare className="size-3.5" /> Support
        </button>
      </div>
    </footer>
  );
}

/** One theme button — animates its icon in on select and shows an active pill. */
function ThemeChip({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      whileTap={{ scale: 0.85 }}
      className={`relative grid size-6 place-items-center rounded-full transition-colors ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {active && (
        <motion.span
          layoutId="theme-active-pill"
          className="absolute inset-0 rounded-full bg-primary/15 ring-1 ring-primary/40"
          transition={{ type: "spring", stiffness: 500, damping: 34 }}
        />
      )}
      <motion.span
        key={active ? "on" : "off"}
        initial={{ rotate: -90, scale: 0.6, opacity: 0.4 }}
        animate={{ rotate: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 22 }}
        className="relative"
      >
        {children}
      </motion.span>
    </motion.button>
  );
}

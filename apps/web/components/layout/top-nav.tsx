"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { MotionConfig } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowDownToLine } from "lucide-react";
import { WalletButton } from "./wallet-button";
import { AccountButton } from "./account-button";
import { AgentSearch } from "./agent-search";
import machLogo from "@/assets/lo.png";
import { shouldUseShell } from "@/lib/solstar/navVisibility";
import { useInSolstarShell } from "./shell-context";
import { legacyUiEnabled } from "@/lib/flags";
import { MobileNavSheet } from "@/components/home/app-shell";


// `auth: true` items are only shown to a signed-in user (Privy session or a
// connected wallet). Logged-out visitors don't see My Agents — they sign in via
// the WalletButton first. Generations is now a dedicated icon button (left of
// Arena); Wallet lives in the account dropdown.
const LEGACY_NAV_ITEMS: { label: string; href: string; auth?: boolean }[] = [
  { label: "Explore", href: "/agents" },
  { label: "Tasks", href: "/stage" },
];
const NAV_ITEMS: { label: string; href: string; auth?: boolean }[] = [
  { label: "Discover", href: "/" },
  ...(legacyUiEnabled() ? LEGACY_NAV_ITEMS : []),
];

/** Glass quick-access button for the Generations feed — sits left of the Arena. */
function GenerationsButton() {
  return (
    <Link
      href="/generations"
      aria-label="Generations"
      title="Generations"
      // Boxy square that matches the Arena button's height (~31px) — sharper corners
      // (rounded-md) and h-[31px] instead of the taller, rounder size-9 glass chip.
      className="mr-1.5 inline-flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-md border border-white/25 bg-white/10 text-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_8px_rgba(0,0,0,0.25)] backdrop-blur-xl transition-all duration-200 hover:bg-white/20 hover:text-white hover:border-white/40 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
    >
      <ArrowDownToLine className="size-4" strokeWidth={2} />
    </Link>
  );
}

function isActive(label: string, href: string, pathname: string) {
  if (label === "Workers") return pathname.startsWith("/workers");
  return pathname === href || pathname.startsWith(href + "/");
}

export function TopNav() {
  const pathname = usePathname();
  const inShell = useInSolstarShell();
  // The path the menu was opened on — any navigation closes it by construction.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const closeMenu = useCallback(() => setOpenedOn(null), []);
  const { authenticated } = usePrivy();
  const { publicKey } = useWallet();
  const signedIn = authenticated || !!publicKey;
  const legacy = legacyUiEnabled();
  const navItems = NAV_ITEMS.filter((item) => !item.auth || signedIn);

  // The global shell owns the chrome; full-screen routes (shell opted out) keep no top nav.
  if (inShell || !shouldUseShell(pathname, legacyUiEnabled())) return null;

  return (
    <MotionConfig reducedMotion="user">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm md:border-b-0 md:bg-transparent md:backdrop-blur-none">
        <div className="flex h-14 items-center gap-3 px-4 sm:gap-5 sm:px-5" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif' }}>
          {/* Logo */}
          <Link href="/" className="flex shrink-0 items-center sm:mr-2">
            <Image
              src={machLogo}
              alt="Vello"
              width={120}
              height={36}
              priority
              className="h-8 w-auto object-contain md:h-7"
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden h-full items-center md:flex">
            {navItems.map(({ label, href }) => {
              const active = isActive(label, href, pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative flex h-14 items-center px-3.5 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                    active ? "text-white" : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {label}
                  {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-emerald-500" />}
                </Link>
              );
            })}
          </nav>

          {/* Centered agent search (legacy agents) — gated; spacer keeps actions right. */}
          <div className="flex flex-1 items-center justify-center px-2">
            {legacy && (
              <div className="hidden w-full max-w-md md:block">
                <AgentSearch />
              </div>
            )}
          </div>

          {/* Desktop actions — Generations sits left of the Arena (inside WalletButton) */}
          <div className={`items-center gap-2 ${legacy ? "hidden md:flex" : "flex"}`}>
            {legacy && <GenerationsButton />}
            <WalletButton />
            <AccountButton />
          </div>

          {/* Mobile hamburger → X morph (matches the landing nav) */}
          {legacy && <button
            type="button"
            onClick={() => setOpenedOn(open ? null : pathname)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="relative z-50 flex size-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 md:hidden"
          >
            <span className={`absolute h-[1.5px] w-5 rounded-full bg-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "rotate-45" : "-translate-y-[3px]"}`} />
            <span className={`absolute h-[1.5px] w-5 rounded-full bg-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "-rotate-45" : "translate-y-[3px]"}`} />
          </button>}
        </div>
      </header>

      {/* Same full-screen mobile menu as the app header (portaled above everything). */}
      {/* Legacy-only: the sheet lists legacy products and is not filterable from here. */}
      {legacy && (
        <MobileNavSheet
          open={open}
          onClose={closeMenu}
          pathname={pathname}
          footer={<><GenerationsButton /><WalletButton /></>}
        />
      )}
    </MotionConfig>
  );
}

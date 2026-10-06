"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  PanelLeftClose,
  UserPlus,
  Home as HomeIcon,
  FolderOpen,
  Megaphone,
  LayoutGrid,
  BookOpen,
  HelpCircle,
  BarChart3,
  Images,
  Users,
  RefreshCw,
  Clapperboard,
  CreditCard,
  Trophy,
  Menu,
  X,
} from "lucide-react";
import { AccountButton } from "@/components/layout/account-button";
import velloLogo from "@/assets/solcameo-dark.png";
import { useInSolstarShell } from "@/components/layout/shell-context";

/* ════════ Shared app sidebar + shell ════════
   ONE sidebar, used by every "app" surface (/home, /agents, /studio, …) so
   editing it here updates all of them — no per-page copy to keep in sync.
   Each of those routes opts out of the marketing TopNav/AppFooter (see their
   hide-lists in top-nav.tsx / app-footer.tsx) and renders <AppShell> instead,
   which owns this sidebar + the collapse state. */

type NavItem = { label: string; href?: string; icon: typeof HomeIcon; onClick?: () => void; badge?: string };

const MAIN_ITEMS: NavItem[] = [
  { label: "Home", href: "/home", icon: HomeIcon },
  // "My Agents" is the control panel now (dashboard + agent chats); the old
  // /studio page still works for existing links but is no longer in the menu.
  { label: "My Influencers", href: "/control", icon: FolderOpen },
  { label: "Marketplace", href: "/agents", icon: LayoutGrid },
  { label: "Leaderboards", href: "/tournament", icon: Trophy },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Campaigns", href: "/stage", icon: Megaphone },
];
const BOTTOM_ITEMS: NavItem[] = [
  { label: "Billing", href: "/billing", icon: CreditCard },
  { label: "Docs", href: "/docs", icon: BookOpen },
  { label: "Help center", icon: HelpCircle, onClick: () => window.dispatchEvent(new Event("vello:open-live-chat")) },
];

function NavRow({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) {
  const Icon = item.icon;
  const cls =
    "group relative flex h-10 shrink-0 items-center gap-3 rounded-lg px-2.5 transition-colors " +
    (active ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/[0.06] hover:text-white/90") +
    (collapsed ? " justify-center px-0" : "");
  const content = (
    <>
      <Icon className="size-[18px] shrink-0" />
      <span
        className={`min-w-0 flex-1 truncate text-[13.5px] font-medium transition-[opacity,transform,max-width] duration-200 ${collapsed ? "pointer-events-none max-w-0 -translate-x-1 opacity-0" : "max-w-[160px] translate-x-0 opacity-100"}`}
      >
        {item.label}
      </span>
      {!collapsed && item.badge && (
        <span className="shrink-0 rounded-full bg-white px-1.5 py-px text-[9.5px] font-bold text-neutral-900">{item.badge}</span>
      )}
      {collapsed && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-30 -translate-y-1/2 whitespace-nowrap rounded-md bg-[#1a1b20] px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity group-hover:opacity-100"
        >
          {item.label}
        </span>
      )}
    </>
  );
  return item.href ? (
    <Link href={item.href} className={cls} aria-label={item.label}>{content}</Link>
  ) : (
    <button type="button" onClick={item.onClick} className={cls} aria-label={item.label}>{content}</button>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/home" || href === "/studio") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();

  return (
    <aside
      className={`relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-[#0a0a0c] transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${collapsed ? "w-[64px] px-2.5" : "w-[248px] px-3"} py-3`}
    >
      {/* Brand + collapse toggle */}
      <div className={`flex shrink-0 items-center ${collapsed ? "flex-col gap-2" : "justify-between"}`}>
        <Link href="/" className="flex items-center overflow-hidden rounded-lg" aria-label="Vello">
          <Image src={velloLogo} alt="Solcameo" className="h-9 w-auto shrink-0 object-contain" />
        </Link>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/50 transition-all duration-200 hover:bg-white/[0.06] hover:text-white/85 active:scale-90"
        >
          <PanelLeftClose className={`size-4 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Account — signed out: a real "Sign Up" button (Privy). Signed in: avatar +
          name, opens the full account dropdown (wallet, agents, sign out, …). */}
      {!collapsed && (
        <div className="mt-4 shrink-0">
          <AccountButton fullWidth signInLabel="Sign Up" />
        </div>
      )}

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {MAIN_ITEMS.map((it) => (
          <NavRow key={it.label} item={it} collapsed={collapsed} active={!!it.href && isActive(pathname, it.href)} />
        ))}
      </div>

      <div className="mt-auto flex shrink-0 flex-col gap-0.5 border-t border-white/[0.06] pt-2">
        {BOTTOM_ITEMS.map((it) => (
          <NavRow key={it.label} item={it} collapsed={collapsed} active={!!it.href && isActive(pathname, it.href)} />
        ))}
      </div>
    </aside>
  );
}

/** Full-screen shell: sidebar + a scrollable content column. Wrap any "app"
 *  page's content in this instead of relying on the marketing TopNav/Footer —
 *  remember to add the route to both hide-lists (top-nav.tsx / app-footer.tsx)
 *  so the old chrome doesn't render underneath/around it. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  // Inside the global Solstar shell there is one rail + one top bar: render content only.
  if (useInSolstarShell()) return <>{children}</>;
  return (
    <div data-app-chrome className="flex h-screen w-full overflow-hidden bg-[#08080a] text-white">
      <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div data-app-content className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}

/* ════════ Header variant (no sidebar) ════════
   Same nav items as AppSidebar, laid out as a sticky top header — matches the
   Meteora-minimal: no bottom divider, no active underline — the active item
   is just full-white text against the muted rest.
   Used by /home instead of AppShell so the page gets full width, no rail. */

function HeaderNavLink({ item, active }: { item: NavItem; active: boolean }) {
  const cls = `relative flex h-14 items-center px-3.5 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
    active ? "text-white" : "text-zinc-400 hover:text-zinc-100"
  }`;
  const content = (
    <>
      <span className="whitespace-nowrap">{item.label}</span>
      {item.badge && (
        <span className="ml-1.5 shrink-0 rounded-full bg-white px-1.5 py-px text-[9.5px] font-bold text-neutral-900">{item.badge}</span>
      )}
    </>
  );
  return item.href ? (
    <Link href={item.href} className={cls} aria-label={item.label}>{content}</Link>
  ) : (
    <button type="button" onClick={item.onClick} className={cls} aria-label={item.label}>{content}</button>
  );
}

/* "More" overflow — secondary tools that don't earn a permanent header slot.
   Frosted-glass dropdown to match the app's dark glassmorphism accents. */
const MORE_ITEMS: (NavItem & { href: string })[] = [
  { label: "AI Influencer", href: "/studio/build", icon: UserPlus, badge: "New" },
  { label: "Photo Carousel", href: "/carousel", icon: Images },
  { label: "Content Swarm", href: "/swarm", icon: Users },
  { label: "Documentary", href: "/documentary", icon: Clapperboard },
  { label: "Recreate", href: "/recreate", icon: RefreshCw },
];

/** Full-screen mobile nav sheet — the header navs are `hidden md:flex`, so this
 *  is the only way to reach MAIN/MORE/BOTTOM items on a phone. Shared by the app
 *  header below AND the marketing TopNav, so every page gets the same menu.
 *
 *  Portaled to <body>: rendered inside the sticky z-50 header it was trapped in
 *  that header's stacking context (and any transformed/filtered ancestor turns
 *  `fixed` into relative), so page content and floating widgets painted over it
 *  — the "menu opens but I can't see anything" bug. At body level with z-[200]
 *  (above LiveChatWidget's z-[120]) and a solid background, nothing can cover it. */
const subscribeNoop = () => () => {};

export function MobileNavSheet({
  open,
  onClose,
  pathname,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  /** Extra actions under the account row (e.g. wallet/generations on the marketing nav). */
  footer?: React.ReactNode;
}) {
  const router = useRouter();
  const isClient = useSyncExternalStore(subscribeNoop, () => true, () => false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!isClient) return null;

  const go = (item: NavItem) => {
    if (item.href) router.push(item.href);
    else item.onClick?.();
    onClose();
  };

  const sections: { title: string; items: NavItem[] }[] = [
    { title: "Navigate", items: MAIN_ITEMS },
    { title: "Tools", items: MORE_ITEMS },
    { title: "Account & help", items: BOTTOM_ITEMS },
  ];
  const offsets = sections.map((_, si) => sections.slice(0, si).reduce((n, s) => n + s.items.length, 0));

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[200] flex flex-col bg-[#08080a] text-white md:hidden"
          style={{
            paddingTop: "env(safe-area-inset-top, 0px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            fontFamily: "var(--font-geist-sans)",
          }}
        >
          {/* soft brand glow, same family as the /agents hero */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(80% 45% at 15% 0%, rgba(124,58,237,0.16), transparent 70%), radial-gradient(60% 35% at 100% 100%, rgba(236,72,153,0.08), transparent 70%)" }}
          />

          <div className="relative flex h-14 shrink-0 items-center justify-between px-4">
            <Link href="/home" onClick={onClose} className="flex items-center overflow-hidden rounded-lg" aria-label="Vello">
              <Image src={velloLogo} alt="Solcameo" className="h-8 w-auto shrink-0 object-contain" />
            </Link>
            <motion.button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/80 transition-colors active:scale-95 active:bg-white/10"
            >
              <X className="size-[18px]" />
            </motion.button>
          </div>

          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex-1 overflow-y-auto overscroll-contain px-4 pb-6"
          >
            <div className="mb-5 mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
              <div className="min-w-0 flex-1">
                <AccountButton fullWidth signInLabel="Sign In" />
              </div>
              {footer && <div className="flex w-full flex-wrap items-center gap-2">{footer}</div>}
            </div>

            {sections.map((section, si) => (
              <div key={section.title} className="mb-5">
                <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-white/35">{section.title}</p>
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item, ii) => {
                    const Icon = item.icon;
                    const active = !!item.href && isActive(pathname, item.href);
                    return (
                      <motion.button
                        key={item.label}
                        type="button"
                        onClick={() => go(item)}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.04 + (offsets[si] + ii) * 0.022, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className={`flex h-12 items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium transition-colors active:scale-[0.99] ${
                          active ? "bg-white/[0.09] text-white" : "text-white/70 active:bg-white/[0.06]"
                        }`}
                      >
                        <span
                          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                            active ? "bg-white text-black" : "bg-white/[0.05] text-white/70"
                          }`}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.badge && (
                          <span className="shrink-0 rounded-full bg-white px-1.5 py-px text-[9.5px] font-bold text-neutral-900">{item.badge}</span>
                        )}
                        {active && <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function AppHeader({ transparent = true }: { transparent?: boolean }) {
  const inShell = useInSolstarShell();
  const pathname = usePathname();
  // The path the sheet was opened on — navigating anywhere (link, back/forward)
  // closes it by construction, no effect needed.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const mobileOpen = openedOn === pathname;
  const closeMobile = useCallback(() => setOpenedOn(null), []);

  // The global Solstar shell owns the top bar.
  if (inShell) return null;

  return (
    <header className={`sticky top-0 z-50 ${transparent ? "bg-transparent" : "bg-[#08080a]"}`}>
      <div className="flex h-14 items-center gap-3 px-4 sm:gap-5 sm:px-5" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif' }}>
        <Link href="/home" className="flex shrink-0 items-center overflow-hidden rounded-lg" aria-label="Vello">
          <Image src={velloLogo} alt="Solcameo" className="h-8 w-auto shrink-0 object-contain md:h-7" />
        </Link>
        <nav className="hidden h-full items-center md:flex">
          {MAIN_ITEMS.map((item) => (
            <HeaderNavLink key={item.label} item={item} active={!!item.href && isActive(pathname, item.href)} />
          ))}
        </nav>
        <div className="flex flex-1" />
        <div className="flex items-center gap-1.5">
          <AccountButton />
          <button
            type="button"
            onClick={() => setOpenedOn(pathname)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white md:hidden"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>
      <MobileNavSheet open={mobileOpen} onClose={closeMobile} pathname={pathname} />
    </header>
  );
}

/** Full-screen shell with the header nav on top instead of a sidebar. */
export function AppHeaderShell({ children, transparentHeader = true, flat = false }: { children: React.ReactNode; transparentHeader?: boolean; flat?: boolean }) {
  if (useInSolstarShell()) return <>{children}</>;
  return (
    <div
      data-app-chrome
      className="flex h-screen w-full flex-col overflow-hidden text-white"
      style={{ background: flat ? "#000" : "radial-gradient(ellipse 75% 380px at 20% 0%, rgba(132,204,22,0.18), transparent 72%), radial-gradient(ellipse 48% 320px at 85% 0%, rgba(74,222,128,0.09), transparent 72%), #08080a" }}
    >
      <AppHeader transparent={transparentHeader} />
      <div data-app-content className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

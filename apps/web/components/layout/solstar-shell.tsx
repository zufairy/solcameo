"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { FileText, Workflow, Plus, Radio, X, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { legacyUiEnabled } from "@/lib/flags";
import { BRAND } from "@/lib/solstar/brand";
import { getMenuItems } from "@/lib/solstar/menu";
import { ShellAccount } from "./shell-account";
import { ShellSearch } from "./shell-search";
import { ShellProvider } from "./shell-context";
import { OnchainUpdates } from "@/components/solstar/OnchainUpdates";
import { ErrorBoundary } from "@/components/error/error-boundary";
import { TickerStrip } from "@/components/solstar/TickerStrip";
import { playUiTick } from "@/lib/client/uiSound";

function Logo() {
  const { setOpenMobile } = useSidebar();
  return (
    <Link
      href="/"
      onClick={() => setOpenMobile(false)}
      aria-label={`${BRAND.name} home`}
      className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
    >
      <img src="/brand/solcameo-mark.png" alt="" className="hidden size-6 object-contain group-data-[collapsible=icon]:block" />
      <img src="/brand/solcameo-dark.png" alt="Solcameo" width={190} height={38} className="h-6 w-auto max-w-[150px] object-contain group-data-[collapsible=icon]:hidden" />
    </Link>
  );
}

function RailMenu() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const { setOpenMobile } = useSidebar();
  const items = getMenuItems(legacyUiEnabled());

  return (
    <nav aria-label="Primary">
      <SidebarMenu className="group-data-[collapsible=icon]:items-center">
        {items.map(({ label, href, icon: Icon, match, group }, index) => {
          const active = match(pathname);
          return (
            <SidebarMenuItem key={href}>
              {(index === 0 || items[index - 1].group !== group) && (
                <div className={`solcameo-menu-divider ${index === 0 ? "solcameo-menu-divider-first" : ""}`}>
                  <span className="px-2 text-[10px] font-medium tracking-wide text-zinc-500 group-data-[collapsible=icon]:hidden">
                    {group}
                  </span>
                </div>
              )}
              <SidebarMenuButton
                render={
                  <Link
                    href={href}
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpenMobile(false)}
                  />
                }
                isActive={active}
                tooltip={label}
                className="relative h-10 gap-3 rounded-lg px-3 text-[13px] font-medium text-zinc-400 transition-colors duration-200 hover:bg-white/[0.05] hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-400/60 data-active:bg-transparent data-active:text-white"
              >
                {active && (
                  <motion.span
                    layoutId="solstar-rail-active"
                    aria-hidden
                    className="absolute inset-0 rounded-lg bg-white/[0.08]"
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 500, damping: 38 }
                    }
                  />
                )}
                <span className="solcameo-nav-icon relative"><Icon strokeWidth={1.6} /></span>
                <span className="relative truncate">{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </nav>
  );
}

const CREATE_CLASS =
  "h-10 justify-center gap-2 rounded-lg bg-emerald-300 px-3 text-sm font-semibold text-zinc-950 transition-colors duration-200 hover:bg-emerald-200 hover:text-zinc-950 active:bg-emerald-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-emerald-300 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 motion-reduce:transition-none";

function RailCreate() {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu className="mt-3 group-data-[collapsible=icon]:items-center">
      <SidebarMenuItem>
        <SidebarMenuButton
          render={
            <Link
              href="/create"
              aria-label="Create"
              onClick={() => setOpenMobile(false)}
            />
          }
          tooltip="Create"
          className={CREATE_CLASS}
        >
          <Plus className="relative size-4 shrink-0 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)]" strokeWidth={3} />
          <span className="group-data-[collapsible=icon]:hidden">Create</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function RailFooter() {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu className="group-data-[collapsible=icon]:items-center">
      <SidebarMenuItem>
        <SidebarMenuButton render={<Link href="/how-it-works" onClick={() => setOpenMobile(false)} />} tooltip="How it works" className="h-9 gap-3 rounded-lg px-3 text-[13px] text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200">
          <span className="solcameo-nav-icon"><Workflow strokeWidth={1.6} /></span><span>How it works</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          render={<Link href="/docs" onClick={() => setOpenMobile(false)} />}
          tooltip="Docs"
          className="h-9 gap-3 rounded-lg px-3 text-[13px] text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          <span className="solcameo-nav-icon"><FileText strokeWidth={1.6} /></span>
          <span>Docs</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function SidebarDividerToggle() {
  const { state, toggleSidebar } = useSidebar();
  const expanded = state === "expanded";
  return <button
    type="button"
    aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
    aria-expanded={expanded}
    aria-controls="vello-sidebar"
    onClick={toggleSidebar}
    style={{ left: expanded ? "var(--sidebar-width)" : "var(--sidebar-width-icon)" }}
    className="solcameo-sidebar-toggle fixed top-[15px] z-40 hidden h-6 w-3.5 -translate-x-1/2 items-center justify-center rounded-[2px] border border-white/15 bg-[#202326] text-white shadow-sm transition-[left,color,background-color] duration-200 hover:bg-[#2b2e31] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ec7352] motion-reduce:transition-none md:flex"
  >{expanded ? <ChevronLeft className="size-2.5" strokeWidth={2} /> : <ChevronRight className="size-2.5" strokeWidth={2} />}</button>;
}

function TopBar({ terminal = false }: { terminal?: boolean }) {
  return (
    <header className="solcameo-topbar sticky top-0 z-30 flex h-[48px] shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#181a1c]/95 px-3 backdrop-blur-md">
      {!terminal && <SidebarTrigger className="-ml-1 md:hidden text-zinc-400 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-400/60" />}
      <div className="flex min-w-0 flex-1 items-center">
        <ShellSearch />
      </div>
      <div className="flex shrink-0 items-center">
        <ShellAccount />
      </div>
    </header>
  );
}

/** Global app chrome: collapsible left rail + top bar. One instance, mounted by the root layout. */
export function SolstarShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMarketTerminal = !legacyUiEnabled() && /^\/market\/[^/]+$/.test(pathname);
  const isControl = pathname === "/control" || pathname.startsWith("/control/");
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-slot="sidebar-menu-button"], [data-slot="sidebar-menu-sub-button"]')) playUiTick();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return (
    <ShellProvider value={true}>
      <OnchainUpdates />
      <MotionConfig reducedMotion="user">
        <SidebarProvider
          defaultOpen={false}
          style={{ "--sidebar-width-icon": "3.5rem", "--sidebar-width": "13.5rem" } as React.CSSProperties}
          className={`solcameo-app overflow-x-clip bg-[#08080a] text-white ${["/market", "/explore", "/analytics", "/create-videos"].some(route => pathname.startsWith(route)) ? "vello-market-theme" : ""}`}
        >
          {<Sidebar
            id="vello-sidebar"
            collapsible="icon"
            className="border-r border-white/[0.06] [&_[data-slot=sidebar-inner]]:bg-[#09090b] [&_[data-slot=sidebar-container]]:transition-[width] [&_[data-slot=sidebar-container]]:duration-200 motion-reduce:[&_[data-slot=sidebar-container]]:transition-none"
          >
            <SidebarHeader className="px-3 py-3 group-data-[collapsible=icon]:items-center">
              <Logo />
              <div className="solcameo-rail-search mt-1 w-full"><ShellSearch /></div>
            </SidebarHeader>
            <SidebarContent className="px-2 py-1">
              <SidebarGroup className="p-0">
                <SidebarGroupContent>
                  <RailMenu />
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter className="border-t border-white/[0.08] px-2 pb-3">
              <RailCreate />
              <RailFooter />
            </SidebarFooter>
          </Sidebar>}
          <SidebarDividerToggle />
          <SidebarInset className="h-dvh min-w-0 overflow-hidden bg-[#08080a]">
            {!isMarketTerminal && <ShellAnnouncement autoClose={isControl} />}
            <TopBar terminal={isMarketTerminal} />
            {!pathname.startsWith("/explore") && !pathname.startsWith("/create-videos") && !pathname.startsWith("/analytics") && !pathname.startsWith("/agents") && !isControl && <ErrorBoundary fallback={null}><TickerStrip /></ErrorBoundary>}
            <div className={`min-h-0 min-w-0 flex-1 ${isMarketTerminal ? "solcameo-market-content flex flex-col overflow-hidden" : isControl ? "solcameo-control-content relative isolate flex flex-col overflow-hidden bg-background" : pathname === "/" ? "overflow-y-auto overscroll-contain [container-type:size]" : "overflow-y-auto overscroll-contain"}`}>
              <ErrorBoundary>{children}</ErrorBoundary>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </MotionConfig>
    </ShellProvider>
  );
}

/** Reveals after three seconds on the current page, without shifting the sidebar. */
function ShellAnnouncement({ autoClose = false }: { autoClose?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const reduced = useReducedMotion();
  // On the control page the notice shows briefly, then folds away on its own.
  useEffect(() => {
    if (!autoClose || !visible) return;
    const timer = window.setTimeout(() => setDismissed(true), 5000);
    return () => window.clearTimeout(timer);
  }, [autoClose, visible]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setVisible(!sessionStorage.getItem("solcameo-announcement-dismissed")); }
      catch { setVisible(true); }
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <motion.div
      initial={false}
      animate={{ height: visible && !dismissed ? 36 : 0, opacity: visible && !dismissed ? 1 : 0 }}
      transition={{ duration: reduced ? 0 : 0.38, ease: [0.22, 1, 0.36, 1] }}
      aria-hidden={!visible || dismissed}
      className="shrink-0 overflow-hidden"
    >
      <motion.div
        initial={false}
        animate={{ y: visible || reduced ? 0 : -12 }}
        transition={{ duration: reduced ? 0 : 0.38, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex h-[36px] items-center justify-center gap-2 border-b border-white/[0.08] bg-[#090a0b] px-8 text-sm font-medium text-zinc-200"
      >
        <Radio aria-hidden="true" className="size-3.5 text-[#d7ff00]" />
        <span>AI-native characters. Built to create on Solana.</span>
        <button type="button" aria-label="Dismiss announcement" tabIndex={visible && !dismissed ? 0 : -1} onClick={() => { setDismissed(true); try { sessionStorage.setItem("solcameo-announcement-dismissed", "1"); } catch { /* Closing still works without browser storage. */ } }} className="absolute right-2 grid size-5 place-items-center rounded text-zinc-500 hover:bg-white/5 hover:text-white"><X className="size-3" /></button>
      </motion.div>
    </motion.div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ShieldCheck, Loader2, Users, Bot, Briefcase, Activity, LayoutDashboard, Lock,
  MessagesSquare, Coins, FileBarChart2, Landmark, ArrowLeftRight, Tag, Headset, Video,
  Sparkles, Clapperboard, ChevronDown, MoreHorizontal, Magnet, Terminal, UsersRound,
  SlidersHorizontal, Globe2,
} from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { AppHeaderShell } from "@/components/home/app-shell";

type NavLink = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean };
type NavItem = NavLink | { label: string; icon: React.ComponentType<{ className?: string }>; children: NavLink[] };

const NAV: NavItem[] = [
  { href: "/admin",               label: "Overview",      icon: LayoutDashboard, exact: true },
  { href: "/admin/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/admin/control-panel", label: "Control Panel", icon: SlidersHorizontal },
  { href: "/admin/live-chats",    label: "Live Chat",     icon: Headset },
  { href: "/admin/users",         label: "Users",         icon: Users },
  { href: "/admin/agents",        label: "Agents",        icon: Bot },
  { href: "/admin/content-control", label: "Content Control", icon: Sparkles },
  { href: "/admin/posts",         label: "Posts",         icon: Video },
  { href: "/admin/interns",       label: "Interns",       icon: UsersRound },
  { href: "/admin/campaigns",     label: "Campaigns",     icon: Briefcase },
  { href: "/admin/leads",         label: "Leads",         icon: Magnet },
  { href: "/admin/nodes",         label: "Nodes",         icon: Globe2 },
  {
    label: "Samples", icon: Sparkles, children: [
      { href: "/admin/ugc-sample", label: "UGC Samples",      icon: Clapperboard },
      { href: "/admin/samples",    label: "Clipping Samples", icon: Sparkles },
    ],
  },
  {
    label: "More", icon: MoreHorizontal, children: [
      { href: "/admin/transactions", label: "Transactions", icon: ArrowLeftRight },
      { href: "/admin/pricing",      label: "Pricing",      icon: Tag },
      { href: "/admin/crons",        label: "Heartbeat",    icon: Activity },
      { href: "/admin/investments",  label: "Investments",  icon: Coins },
      { href: "/admin/treasuries",   label: "Treasuries",   icon: Landmark },
      { href: "/admin/submissions",  label: "Submissions",  icon: FileBarChart2 },
      { href: "/dev/team-schedule",  label: "Dev Tools",    icon: Terminal },
    ],
  },
];

const isLinkActive = (l: NavLink, pathname: string) => (l.exact ? pathname === l.href : pathname.startsWith(l.href));

function NavDropdown({ item, pathname }: { item: Extract<NavItem, { children: NavLink[] }>; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const Icon = item.icon;
  const active = item.children.some((c) => isLinkActive(c, pathname));

  // Close on outside click; route changes close via the Link onClick below.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`relative flex items-center gap-1.5 px-4 py-2.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
          active ? "text-emerald-400" : "text-zinc-600 hover:text-zinc-300"
        }`}
      >
        <Icon className="size-3.5" />{item.label}
        <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
        {active && <span className="absolute bottom-0 inset-x-3 h-[2px] bg-emerald-500 rounded-t-full" />}
      </button>
      {open && (
        <div className="absolute left-2 top-full z-40 mt-1 min-w-[190px] rounded-xl border border-[#1e1e24] bg-[#0d0d10] p-1.5 shadow-xl shadow-black/40">
          {item.children.map((c) => {
            const CIcon = c.icon;
            const childActive = isLinkActive(c, pathname);
            return (
              <Link
                key={c.href}
                href={c.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-colors ${
                  childActive ? "bg-emerald-500/10 text-emerald-400" : "text-zinc-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                <CIcon className="size-3.5" />{c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Gate({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] px-8 py-10 max-w-sm text-center">
        <div className="mx-auto mb-4 flex items-center justify-center size-12 rounded-2xl bg-zinc-800/60 border border-zinc-700">
          <Lock className="size-5 text-zinc-400" />
        </div>
        <h1 className="text-[17px] font-bold text-white">{title}</h1>
        <div className="mt-2 text-[13px] text-zinc-500">{children}</div>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading, signInWithGoogle } = useSupabaseAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      <AppHeaderShell>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="size-6 animate-spin text-zinc-600" />
        </div>
      </AppHeaderShell>
    );
  }

  if (!profile) {
    return (
      <AppHeaderShell>
        <Gate title="Admin access">
          <p>Sign in with an admin account to continue.</p>
          <button
            onClick={() => signInWithGoogle()}
            className="mt-4 inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-white text-zinc-900 hover:bg-zinc-100 text-[13px] font-semibold"
          >
            Sign in
          </button>
        </Gate>
      </AppHeaderShell>
    );
  }

  if (!profile.isAdmin) {
    return (
      <AppHeaderShell>
        <Gate title="Not authorized">
          <p>Your account doesn&apos;t have admin access. If this is a mistake, ask an existing admin to grant it.</p>
        </Gate>
      </AppHeaderShell>
    );
  }

  return (
    <AppHeaderShell>
      <div className="min-h-full bg-[#08080a] text-white">
      {/* Sticky sub-nav sits at top-0 INSIDE AppHeaderShell's scroll column —
          the shared app header above it is fixed chrome, not scroll content. */}
      <div className="sticky top-0 z-30 border-b border-[#18181c] bg-[#08080a]/96 backdrop-blur-sm">
        <div className="max-w-[1440px] mx-auto px-6 h-12 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-6 rounded-md bg-emerald-500/15 border border-emerald-500/25">
              <ShieldCheck className="size-3.5 text-emerald-400" />
            </div>
            <span className="text-[13px] font-bold text-white">Platform Admin</span>
          </div>
          <span className="text-[10px] text-zinc-700 border border-[#1e1e24] rounded-md px-1.5 py-0.5 font-mono">vello · devnet</span>
        </div>
        {/* flex-wrap (not overflow-x-auto): an x-scroll container clips vertical
            overflow, which would cut off the dropdown menus below the bar. */}
        <div className="max-w-[1440px] mx-auto px-4 flex items-center flex-wrap gap-0 border-t border-[#121215]">
          {NAV.map((item) => {
            if ("children" in item) return <NavDropdown key={item.label} item={item} pathname={pathname} />;
            const { href, label, icon: Icon } = item;
            const active = isLinkActive(item, pathname);
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
                  active ? "text-emerald-400" : "text-zinc-600 hover:text-zinc-300"
                }`}
              >
                <Icon className="size-3.5" />{label}
                {active && <span className="absolute bottom-0 inset-x-3 h-[2px] bg-emerald-500 rounded-t-full" />}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="max-w-[1440px] mx-auto px-6 py-8">{children}</div>
      </div>
    </AppHeaderShell>
  );
}

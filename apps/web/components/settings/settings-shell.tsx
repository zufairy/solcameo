"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { useFullSignOut } from "@/providers/wallet-provider";
import { AppHeaderShell } from "@/components/home/app-shell";
import flashAvatar from "@/assets/flash.jpeg";
import {
  User, Zap, Receipt, TrendingUp, Layers, LogOut, ShieldCheck, type LucideIcon,
} from "lucide-react";

/** One shared settings hub — /profile, /billing, /billing/history, /earnings,
 *  /generations all render inside this shell so the account area reads as one
 *  product instead of four differently-designed pages. Each page owns only
 *  its content; the identity card, nav, and page-header chrome live here once. */
export type SettingsTab = "profile" | "billing" | "history" | "earnings" | "generations";

const NAV: { id: SettingsTab; label: string; href: string; icon: LucideIcon; blurb: string }[] = [
  { id: "profile", label: "Profile", href: "/profile", icon: User, blurb: "Account & wallets" },
  { id: "billing", label: "Billing", href: "/billing", icon: Zap, blurb: "Credits & top up" },
  { id: "history", label: "History", href: "/billing/history", icon: Receipt, blurb: "All transactions" },
  { id: "earnings", label: "Earnings", href: "/earnings", icon: TrendingUp, blurb: "Agent payouts" },
  { id: "generations", label: "Generations", href: "/generations", icon: Layers, blurb: "Everything made" },
];

export const blurIn = (delay = 0) => ({
  initial: { opacity: 0, y: 10, filter: "blur(10px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const },
});

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl ${className}`}>{children}</div>;
}

export function Kpi({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-white/40">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-[22px] font-semibold tabular-nums leading-none text-white" style={accent ? { color: accent } : undefined}>{value}</p>
      <p className="mt-1.5 text-[11px] text-white/35">{sub}</p>
    </div>
  );
}

function SidebarIdentity() {
  const { profile } = useSupabaseAuth();
  const handleSignOut = useFullSignOut();
  if (!profile) return null;
  const name = profile.name ?? profile.email ?? "Account";
  const avatarSrc = profile.image || flashAvatar.src;
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatarSrc} alt="" className="size-9 shrink-0 rounded-full object-cover ring-1 ring-white/10" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 truncate text-[13px] font-semibold text-white">
          {name}
          {profile.isAdmin && <ShieldCheck className="size-3 shrink-0 text-emerald-400" />}
        </p>
        {profile.email && <p className="truncate text-[11px] text-white/40">{profile.email}</p>}
      </div>
      <button
        type="button"
        title="Sign out"
        onClick={() => handleSignOut()}
        className="shrink-0 rounded-lg p-1.5 text-white/30 transition-colors hover:bg-red-500/10 hover:text-red-400"
      >
        <LogOut className="size-3.5" />
      </button>
    </div>
  );
}

function SettingsSidebar({ active }: { active: SettingsTab }) {
  return (
    <Panel className="w-full shrink-0 self-start overflow-hidden lg:sticky lg:top-6 lg:w-60">
      <SidebarIdentity />
      <nav className="flex flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const isActive = item.id === active;
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                isActive ? "bg-white/[0.08] text-white" : "text-white/55 hover:bg-white/[0.04] hover:text-white/85"
              }`}
            >
              <span className={`grid size-7 shrink-0 place-items-center rounded-lg border ${
                isActive ? "border-emerald-400/30 bg-emerald-400/[0.12] text-emerald-300" : "border-white/10 bg-white/[0.03] text-white/50 group-hover:text-white/70"
              }`}>
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{item.label}</span>
                <span className="block truncate text-[10.5px] text-white/35">{item.blurb}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    </Panel>
  );
}

export function SettingsShell({
  active,
  title,
  description,
  icon: Icon,
  actions,
  children,
}: {
  active: SettingsTab;
  title: string;
  description: string;
  icon: LucideIcon;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <AppHeaderShell>
      <div className="flex min-h-full flex-col bg-[#202326] text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10 lg:flex-row lg:items-stretch lg:gap-6">
          <SettingsSidebar key={pathname} active={active} />
          <div className="mt-6 flex min-w-0 flex-1 flex-col lg:mt-0">
            <motion.div {...blurIn(0)} className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="flex items-center gap-2.5 text-[26px] font-thin tracking-tight text-white">
                  <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                    <Icon className="size-4.5 text-white/80" strokeWidth={1.75} />
                  </span>
                  {title}
                </h1>
                <p className="mt-1 text-[13px] text-white/40">{description}</p>
              </div>
              {actions}
            </motion.div>
            <div className="mt-6 flex flex-1 flex-col">{children}</div>
          </div>
        </div>
      </div>
    </AppHeaderShell>
  );
}

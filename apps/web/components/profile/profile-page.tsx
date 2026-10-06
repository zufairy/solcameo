"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useQuery, useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { unionWalletAddresses } from "@/lib/solana/activeWallet";
import { AccountButton } from "@/components/layout/account-button";
import { SettingsShell, Panel, Kpi, blurIn } from "@/components/settings/settings-shell";
import flashAvatar from "@/assets/flash.jpeg";
import {
  Check, Copy, ChevronRight, Wallet, Bot, User, Pencil, Eye, Film, Users as UsersIcon,
  Camera, Loader2, X,
} from "lucide-react";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-white/40">{children}</p>;
}

function Row({
  icon: Icon, label, value, onClick, href, trailing,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
  onClick?: () => void;
  href?: string;
  trailing?: React.ReactNode;
}) {
  const content = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
        <Icon className="size-[15px] text-white/70" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] text-white">{label}</span>
        {value && <span className="block truncate text-[11.5px] text-white/40">{value}</span>}
      </span>
      {trailing ?? (onClick || href ? <ChevronRight className="size-4 shrink-0 text-white/25" /> : null)}
    </>
  );
  const cls = "flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors";
  if (href) return <Link href={href} className={`${cls} hover:bg-white/[0.04]`}>{content}</Link>;
  return (
    <button type="button" onClick={onClick} className={`${cls} ${onClick ? "hover:bg-white/[0.04] cursor-pointer" : ""}`} disabled={!onClick}>
      {content}
    </button>
  );
}

function WalletRow({ address, isPrimary }: { address: string; isPrimary: boolean }) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
  return (
    <Row
      icon={Wallet}
      label={short}
      value={isPrimary ? "Primary wallet" : "Linked wallet"}
      onClick={async () => {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      trailing={copied ? <Check className="size-4 shrink-0 text-emerald-400" /> : <Copy className="size-4 shrink-0 text-white/25" />}
    />
  );
}

const nf = (n: number) => n.toLocaleString("en-US");

type CreatorDoc = { mintAddress: string; name: string; handle: string; avatarUrl?: string };
type FeedItem = FunctionReturnType<typeof api.clipJobs.videoFeedByMints>["items"][number];

const AGENTS_PREVIEW_COUNT = 5;

/** Like <Row>, but with the influencer's real profile photo instead of the generic
 *  Bot icon (falls back to a gradient initial when there's no avatar, or it
 *  fails to load — same graceful-fallback pattern as the marketplace card). */
function AgentRow({ agent }: { agent: CreatorDoc }) {
  const [broken, setBroken] = useState(false);
  const hasImage = !!agent.avatarUrl && !broken;
  return (
    <Link href={`/builder?mint=${agent.mintAddress}`} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.04]">
      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/[0.06]">
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={agent.avatarUrl} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <span className="text-[11px] font-bold text-white/60">{agent.name?.[0]?.toUpperCase() ?? "?"}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] text-white">{agent.name}</span>
        <span className="block truncate text-[11.5px] text-white/40">@{agent.handle}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-white/25" />
    </Link>
  );
}

/** Convert a File to a data URL for /api/upload-ref (accepts raw base64 or a
 *  data: URL and strips the prefix itself). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProfilePage() {
  const { profile, getFreshToken, refreshProfile } = useSupabaseAuth();
  const { connected, publicKey } = useUnifiedSolanaWallet();
  const address = connected && publicKey ? publicKey.toBase58() : null;
  const creatorWallets = useMemo(
    () => unionWalletAddresses(profile?.walletAddresses, address),
    [profile?.walletAddresses, address],
  );
  const rawDocs = useQuery(
    api.influencers.listByCreators,
    creatorWallets.length ? { creatorWallets } : "skip",
  ) as CreatorDoc[] | undefined;
  const agents = rawDocs ?? [];
  const loadingAgents = creatorWallets.length > 0 && rawDocs === undefined;

  const mintAddresses = useMemo(() => agents.map((a) => a.mintAddress), [agents]);
  const feedResult = useQuery(
    api.clipJobs.videoFeedByMints,
    mintAddresses.length ? { mintAddresses } : "skip",
  ) as { items: FeedItem[] } | undefined;
  const feedItems = feedResult?.items ?? [];
  const totalViews = useMemo(() => feedItems.reduce((s, v) => s + (v.viewCount ?? 0), 0), [feedItems]);
  const totalPosted = useMemo(() => feedItems.filter((v) => v.state === "posted").length, [feedItems]);

  const updateProfile = useAction(api.users.updateProfile);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  const copyAddress = () => {
    if (!address) return;
    void navigator.clipboard.writeText(address).then(() => { setAddrCopied(true); setTimeout(() => setAddrCopied(false), 1500); });
  };


  const handleAvatarPick = async (file: File) => {
    setUploadingAvatar(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch("/api/upload-ref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64: dataUrl }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) throw new Error(j.error ?? "Upload failed");
      const token = await getFreshToken();
      if (!token) throw new Error("Not signed in");
      await updateProfile({ accessToken: token, image: j.url });
      await refreshProfile();
    } catch (e) {
      console.warn("[profile] avatar upload failed:", e instanceof Error ? e.message : e);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const startEditName = () => {
    setNameDraft(profile?.name ?? "");
    setEditingName(true);
  };

  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === profile?.name) { setEditingName(false); return; }
    setSavingName(true);
    try {
      const token = await getFreshToken();
      if (!token) throw new Error("Not signed in");
      await updateProfile({ accessToken: token, name: trimmed });
      await refreshProfile();
      setEditingName(false);
    } catch (e) {
      console.warn("[profile] name save failed:", e instanceof Error ? e.message : e);
    } finally {
      setSavingName(false);
    }
  };

  if (!profile) {
    return (
      <SettingsShell active="profile" icon={User} title="Profile" description="Your identity, wallets, and influencers on Solcameo.">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-[15px] text-white/60">Sign in to view your profile.</p>
          <AccountButton />
        </div>
      </SettingsShell>
    );
  }

  const wallets = profile.walletAddresses ?? [];
  const avatarSrc = profile.image || flashAvatar.src;

  return (
    <SettingsShell active="profile" icon={User} title="Profile" description="Your identity, wallets, and influencers on Solcameo.">
      {/* ── Identity ── */}
      <motion.div {...blurIn(0.04)}>
        <Panel className="overflow-hidden">
          <div className="flex items-center gap-4 px-5 py-6">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleAvatarPick(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="group relative size-16 shrink-0 overflow-hidden rounded-full bg-emerald-600"
              aria-label="Change avatar"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarSrc} alt="" className="size-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                {uploadingAvatar ? <Loader2 className="size-5 animate-spin text-white" /> : <Camera className="size-5 text-white" />}
              </span>
            </button>
            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveName();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    maxLength={80}
                    className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-[16px] font-semibold text-white outline-none focus:border-emerald-500/50"
                  />
                  <button type="button" onClick={() => void saveName()} disabled={savingName} className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                    {savingName ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  </button>
                  <button type="button" onClick={() => setEditingName(false)} className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/50 hover:bg-white/[0.1]">
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={startEditName} title="Edit name" className="group flex items-center gap-1.5">
                  <p className="truncate text-[18px] font-semibold text-white">{profile.name ?? profile.email ?? "Account"}</p>
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-white/40 transition-colors group-hover:bg-white/[0.08] group-hover:text-white">
                    <Pencil className="size-3" />
                  </span>
                </button>
              )}
              {address && (
                <button type="button" onClick={copyAddress} title="Copy wallet address" className="group mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-2.5 pr-2 text-[12px] text-white/70 transition-colors hover:border-white/20 hover:text-white">
                  <Wallet className="size-3.5 shrink-0 text-white/40" />
                  <span className="truncate font-mono">{address.slice(0, 4)}…{address.slice(-4)}</span>
                  {addrCopied ? <Check className="size-3.5 shrink-0 text-emerald-400" /> : <Copy className="size-3.5 shrink-0 text-white/35 group-hover:text-white/70" />}
                </button>
              )}
              <p className="mt-1.5 truncate text-[12.5px] text-white/45">
                {profile.joinedAt ? `Joined ${new Date(profile.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}` : null}
                {profile.joinedAt && profile.email ? " · " : null}
                {profile.email}
              </p>
            </div>
          </div>
        </Panel>
      </motion.div>

      {/* ── Stats ── */}
      <motion.div {...blurIn(0.08)} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi icon={<Eye className="size-3" />} label="Total views" value={nf(totalViews)} sub="Across all influencers" />
        <Kpi icon={<Film className="size-3" />} label="Videos posted" value={nf(totalPosted)} sub="Live on platforms" />
        <Kpi icon={<UsersIcon className="size-3" />} label="Influencers" value={nf(agents.length)} sub="You manage" />
      </motion.div>

      {/* ── Wallets ── */}
      <motion.div {...blurIn(0.12)} className="mt-6">
        <SectionLabel>Wallets</SectionLabel>
        <Panel className="mt-2 divide-y divide-white/[0.06] overflow-hidden">
          {wallets.length === 0 ? (
            <div className="px-5 py-4 text-[13px] text-white/40">No wallet linked yet.</div>
          ) : (
            wallets.map((w) => <WalletRow key={w} address={w} isPrimary={w === profile.walletAddress} />)
          )}
          <Row icon={Wallet} label="Wallet & balance" value="Portfolio, transactions, and payouts" href="/wallet" />
        </Panel>
      </motion.div>

      {/* ── My Agents ── */}
      <motion.div {...blurIn(0.16)} className="mt-6">
        <SectionLabel>My Influencers</SectionLabel>
        <Panel className="mt-2 divide-y divide-white/[0.06] overflow-hidden">
          {loadingAgents ? (
            <div className="px-5 py-4 text-[13px] text-white/40">Loading…</div>
          ) : agents.length === 0 ? (
            <div className="px-5 py-4 text-[13px] text-white/40">No influencers yet.</div>
          ) : (
            <>
              {(showAllAgents ? agents : agents.slice(0, AGENTS_PREVIEW_COUNT)).map((a) => (
                <AgentRow key={a.mintAddress} agent={a} />
              ))}
              {!showAllAgents && agents.length > AGENTS_PREVIEW_COUNT && (
                <button
                  type="button"
                  onClick={() => setShowAllAgents(true)}
                  className="flex w-full items-center justify-center gap-1.5 px-5 py-3 text-[13px] font-medium text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white"
                >
                  Show all {agents.length} influencers
                </button>
              )}
            </>
          )}
          <Row icon={Bot} label="Manage all influencers" href="/studio" />
        </Panel>
      </motion.div>

      {/* ── Plans ── */}
      <motion.div {...blurIn(0.2)} className="mt-6">
        <SectionLabel>Plans</SectionLabel>
        <Panel className="mt-2 overflow-hidden">
          <div className="px-5 py-4">
            <p className="text-[14px] text-white">
              {agents.length === 0 ? "Your first influencer is free, no subscription yet." : `${agents.length} active influencer${agents.length === 1 ? "" : "s"} on Solcameo.`}
            </p>
            <p className="mt-1 text-[12px] text-white/40">Each influencer after your first carries a one-time mint fee plus a monthly fee, billed in USDC from your wallet.</p>
          </div>
          <div className="h-px bg-white/[0.06]" />
        </Panel>
      </motion.div>
    </SettingsShell>
  );
}

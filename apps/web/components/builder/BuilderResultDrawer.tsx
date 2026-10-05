"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";

import type { CampaignBlueprint, ClientAction } from "@/lib/builder/campaignBlueprint";
import type { IntelligentNode } from "@/lib/builder/intelligentNode";

type SetupStep = "idle" | "saving" | "done";

interface BuilderResultDrawerProps {
  open: boolean;
  onClose: () => void;
  campaignBlueprint?: CampaignBlueprint;
  clientActions?: ClientAction[];
  communityId?: string;
  websiteTitle?: string;
  canvasNodes?: IntelligentNode[];
  onNavigate: (href: string) => void;
  onCommunityResolved?: (communityId: string) => void;
  onWorkspaceCreated?: (communityId: string, campaignId: string) => void;
}

function SectionBullets({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-3 space-y-2.5">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-r-xl border-l-2 border-lime-300/45 bg-lime-400/[0.05] px-3 py-2 text-[12px] leading-relaxed text-white/[0.84] [overflow-wrap:anywhere]"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function extractKnowledgeBaseSeed(nodes?: IntelligentNode[]) {
  const list = nodes || [];
  const knowledgeNode = list.find(
    (node) =>
      node.category === "foundation" &&
      typeof node.label === "string" &&
      /\bknowledge\b/i.test(node.label) &&
      typeof node.description === "string" &&
      node.description.trim(),
  );
  const fallbackNode =
    knowledgeNode ||
    list.find(
      (node) =>
        typeof node.sourceUrl === "string" &&
        node.sourceUrl.trim() &&
        typeof node.description === "string" &&
        node.description.trim(),
    ) ||
    list.find((node) => typeof node.sourceUrl === "string" && node.sourceUrl.trim());

  return {
    text: typeof fallbackNode?.description === "string" ? fallbackNode.description.trim() : "",
    sourceUrl: typeof fallbackNode?.sourceUrl === "string" ? fallbackNode.sourceUrl.trim() : "",
    sourceImageUrl:
      (typeof fallbackNode?.sourceCoverImageUrl === "string" && fallbackNode.sourceCoverImageUrl.trim()) ||
      (typeof fallbackNode?.sourceImageUrl === "string" && fallbackNode.sourceImageUrl.trim()) ||
      (typeof fallbackNode?.sourceProfileImageUrl === "string" && fallbackNode.sourceProfileImageUrl.trim()) ||
      "",
  };
}

function extractCommunityImageSeed(nodes?: IntelligentNode[]) {
  const preferredNode = (nodes || []).find(
    (node) =>
      node.category === "foundation" &&
      !/\bknowledge\b/i.test(node.label) &&
      (node.sourceCoverImageUrl || node.sourceImageUrl || node.sourceProfileImageUrl),
  ) || (nodes || []).find(
    (node) =>
      node.category === "foundation" &&
      /\bknowledge\b/i.test(node.label) &&
      (node.sourceCoverImageUrl || node.sourceImageUrl || node.sourceProfileImageUrl),
  );

  return (
    preferredNode?.sourceCoverImageUrl ||
    preferredNode?.sourceImageUrl ||
    preferredNode?.sourceProfileImageUrl ||
    ""
  );
}

function extractCommunityProfileSeed(nodes?: IntelligentNode[]) {
  const preferredNode = (nodes || []).find(
    (node) =>
      node.category === "foundation" &&
      !/\bknowledge\b/i.test(node.label) &&
      (node.sourceProfileImageUrl || node.sourceImageUrl || node.sourceCoverImageUrl),
  ) || (nodes || []).find(
    (node) =>
      node.category === "foundation" &&
      /\bknowledge\b/i.test(node.label) &&
      (node.sourceProfileImageUrl || node.sourceImageUrl || node.sourceCoverImageUrl),
  );

  return (
    preferredNode?.sourceProfileImageUrl ||
    preferredNode?.sourceImageUrl ||
    preferredNode?.sourceCoverImageUrl ||
    ""
  );
}

function SectionEyebrow({ children, tint = "neutral" }: { children: ReactNode; tint?: string }) {
  const color =
    tint === "sky"
      ? "text-sky-300/55"
      : tint === "emerald"
        ? "text-emerald-300/55"
        : tint === "violet"
          ? "text-violet-300/55"
          : tint === "amber"
            ? "text-amber-300/60"
            : "text-white/38";
  return <p className={`text-[9px] uppercase tracking-[0.2em] ${color}`}>{children}</p>;
}

export default function BuilderResultDrawer({
  open,
  onClose,
  campaignBlueprint,
  clientActions = [],
  communityId,
  websiteTitle,
  canvasNodes = [],
  onNavigate,
  onCommunityResolved,
  onWorkspaceCreated,
}: BuilderResultDrawerProps) {
  const { publicKey } = useUnifiedSolanaWallet();
  const meaningful =
    Boolean(campaignBlueprint?.summary) ||
    Boolean(campaignBlueprint?.community?.name) ||
    Boolean(campaignBlueprint?.product?.name) ||
    Boolean(campaignBlueprint?.campaign?.name);

  const drawerActions = clientActions.filter((action) => !action.payload.href.includes("/web3-campaign/new"));
  const [setupStep, setSetupStep] = useState<SetupStep>("idle");
  const [setupError, setSetupError] = useState("");
  const [setupProgress, setSetupProgress] = useState("");
  const [resolvedCommunityId, setResolvedCommunityId] = useState(communityId || "");
  const [resolvedCampaignId, setResolvedCampaignId] = useState("");

  useEffect(() => {
    if (setupStep !== "saving") {
      setSetupProgress("");
      return;
    }
    setSetupProgress("Saving workspace draft…");
    const t1 = setTimeout(() => setSetupProgress("Creating campaign brief…"), 4000);
    const t2 = setTimeout(() => setSetupProgress("Saving product details…"), 9000);
    const t3 = setTimeout(() => setSetupProgress("Almost there, finalizing workspace…"), 16000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [setupStep]);
  const [dockedNarrow, setDockedNarrow] = useState(false);
  const knowledgeBaseSeed = useMemo(() => extractKnowledgeBaseSeed(canvasNodes), [canvasNodes]);
  const communityDisplayImage = useMemo(
    () => campaignBlueprint?.community?.imageUrl || extractCommunityImageSeed(canvasNodes),
    [campaignBlueprint?.community?.imageUrl, canvasNodes],
  );
  const communityProfileImage = useMemo(
    () => extractCommunityProfileSeed(canvasNodes) || communityDisplayImage,
    [canvasNodes, communityDisplayImage],
  );

  useEffect(() => {
    if (!open) setDockedNarrow(false);
  }, [open]);

  useEffect(() => {
    setResolvedCommunityId(communityId || "");
    if (!communityId) {
      setResolvedCampaignId("");
    }
  }, [communityId]);

  async function applyCommunitySetup() {
    setSetupError("");
    setSetupStep("saving");

    const abortCtrl = new AbortController();
    const clientTimeout = setTimeout(
      () => abortCtrl.abort(new DOMException("Workspace setup timed out. Try again from the dashboard.", "AbortError")),
      30000,
    );

    try {
      const resolvedUserId = publicKey?.toString() || "";

      if (!resolvedUserId) {
        throw new Error("Connect your wallet first so Vello can create the community workspace.");
      }

      const res = await fetch("/api/builder/community-setup", {
        method: "POST",
        signal: abortCtrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          communityId: resolvedCommunityId || communityId,
          userId: resolvedUserId,
          campaignBlueprint,
          knowledgeBaseText: knowledgeBaseSeed.text,
          knowledgeBaseSourceUrl: knowledgeBaseSeed.sourceUrl,
          knowledgeBaseSourceImageUrl: knowledgeBaseSeed.sourceImageUrl,
          communityImageUrl: communityDisplayImage,
          campaignImageUrl: campaignBlueprint?.campaign?.imageUrl || communityDisplayImage,
        }),
      });

      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch { /* empty response body is fine */ }

      if (!res.ok) {
        throw new Error((data?.error as string | undefined) || `Server error ${res.status}. Please try again.`);
      }

      if (data?.community && typeof data.community === "object") {
        const c = data.community as Record<string, unknown>;
        if (typeof c.id === "string" && c.id) {
          setResolvedCommunityId(c.id);
          onCommunityResolved?.(c.id);
        }
      }
      if (data?.campaign && typeof data.campaign === "object") {
        const camp = data.campaign as Record<string, unknown>;
        if (typeof camp.id === "string" && camp.id) {
          setResolvedCampaignId(camp.id);
          if (data?.community && typeof data.community === "object") {
            const c = data.community as Record<string, unknown>;
            if (typeof c.id === "string" && c.id) {
              onWorkspaceCreated?.(c.id, camp.id);
            }
          }
        }
      }

      setSetupStep("done");
    } catch (error) {
      const isDomAbort =
        error instanceof DOMException && (error.name === "AbortError" || error.code === 20);
      const isNamedAbort =
        error instanceof Error &&
        (error.name === "AbortError" || /aborted|signal/i.test(error.message));
      if (isDomAbort || isNamedAbort) {
        setSetupError("The request took too long. Your workspace may still have been saved, check your dashboard before retrying.");
      } else {
        setSetupError(error instanceof Error ? error.message : "Failed to setup workspace. Please try again.");
      }
      setSetupStep("idle");
    } finally {
      clearTimeout(clientTimeout);
    }
  }

  const workspaceSettingsHref = resolvedCommunityId
    ? `/studio?workspace=${encodeURIComponent(resolvedCommunityId)}`
    : "";
  const communityPreviewHref = resolvedCommunityId
    ? `/market?workspace=${encodeURIComponent(resolvedCommunityId)}`
    : "";
  // On-chain funding used to happen inline here via a fetch to routes that were
  // never implemented (404 on click). Funding now happens on the Stage, which
  // reads/writes real `campaigns` rows via `campaigns/set-pda` + `campaigns/topup`.
  // Deep-link to the campaign's Stage page once one exists; otherwise send the
  // user to create one.
  const fundingHref = resolvedCampaignId ? `/stage/${resolvedCampaignId}` : "/stage/create";

  return (
    <AnimatePresence>
      {open && (
        <>
          {!dockedNarrow && (
            <motion.button
              type="button"
              aria-label="Close panel"
              className="absolute inset-0 z-20 bg-black/45 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
            />
          )}

          <motion.aside
            initial={{ x: "104%" }}
            animate={{ x: 0 }}
            exit={{ x: "104%" }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className={
              dockedNarrow
                ? "absolute inset-y-0 right-0 z-40 flex w-[52px] flex-col overflow-hidden border-l border-white/[0.08] bg-[#080809]/[0.98] shadow-[-18px_0_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
                : "absolute inset-y-0 right-0 z-40 flex max-h-full min-h-0 w-[min(100%,400px)] max-w-[100%] flex-col overflow-hidden rounded-l-2xl border-l border-white/[0.09] bg-[#080809]/[0.96] shadow-[-28px_0_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:w-[380px]"
            }
          >
            {dockedNarrow ? (
              <div className="flex h-full flex-col items-center pt-4">
                <button
                  type="button"
                  onClick={() => setDockedNarrow(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-white/55 transition hover:bg-white/[0.06] hover:text-white"
                  aria-label="Expand community plan"
                >
                  <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2.25} />
                </button>
                <div className="mt-6 flex flex-1 items-start justify-center pt-8">
                  <span
                    className="select-none text-[10px] font-semibold uppercase tracking-[0.35em] text-white/30"
                    style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
                  >
                    Plan
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="mb-5 flex h-9 w-9 items-center justify-center rounded-md text-white/40 transition hover:bg-white/[0.06] hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-[17px] w-[17px]" />
                </button>
              </div>
            ) : (
              <>
                <header className="flex shrink-0 items-start gap-2 border-b border-white/[0.06] px-3 py-3 sm:items-center sm:gap-3 sm:px-4 sm:py-3.5">
                  <button
                    type="button"
                    onClick={() => setDockedNarrow(true)}
                    className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/45 transition hover:bg-white/[0.06] hover:text-white"
                    aria-label="Minimize panel"
                  >
                    <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2.25} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <SectionEyebrow tint="emerald">{meaningful ? "Build Phase" : "Agentic plan"}</SectionEyebrow>
                    <h2 className="mt-1 truncate text-[15px] font-medium tracking-tight text-white/[0.96]">
                      {meaningful ? "Build this workspace" : "Workspace instructions"}
                    </h2>
                    {websiteTitle ? (
                      <p className="mt-1 truncate text-[11px] text-white/48">Source context: {websiteTitle}</p>
                    ) : !meaningful ? (
                      <p className="mt-1 truncate text-[11px] text-white/48">The agent will turn your prompt into a workspace, apps, and a first campaign.</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/45 transition hover:bg-white/[0.07] hover:text-white"
                    aria-label="Close"
                  >
                    <X className="h-[17px] w-[17px]" />
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 [scrollbar-gutter:stable] sm:px-4 sm:py-4">
                  {!meaningful ? (
                    <div className="rounded-2xl border border-lime-300/15 bg-[linear-gradient(180deg,rgba(132,255,91,0.12),rgba(8,10,9,0.55))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                      <p className="text-[13px] font-semibold text-lime-50">Start with one plain-English goal.</p>
                      <p className="mt-2 break-words text-[13px] leading-relaxed text-white/72">
                        The center canvas saves static cards from fetched website context and confirmed builder replies. Once the plan is solid, this panel will help you create the workspace, install chat and content rewards, and save the first campaign.
                      </p>
                    </div>
                  ) : null}

                  {meaningful ? (
                    <section className="mb-5 border-b border-white/[0.05] pb-5">
                      <SectionEyebrow>Implementation Steps</SectionEyebrow>
                      <div className="mt-4 space-y-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 font-mono text-[11px] font-bold text-white/90">1</div>
                          <div className="min-w-0 pt-0.5">
                            <p className="text-[13px] font-semibold text-white/95">Build Workspace Shell</p>
                            <p className="mt-0.5 text-[12px] leading-relaxed text-white/50">Establishes core database identity and community configurations.</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 font-mono text-[11px] font-bold text-white/90">2</div>
                          <div className="min-w-0 pt-0.5">
                            <p className="text-[13px] font-semibold text-white/95">Deploy Core App Matrix</p>
                            <p className="mt-0.5 text-[12px] leading-relaxed text-white/50">Mounts high-speed group Chat and Content Reward logic automatically.</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 font-mono text-[11px] font-bold text-white/90">3</div>
                          <div className="min-w-0 pt-0.5">
                            <p className="text-[13px] font-semibold text-white/95">Stage Blueprint Campaign</p>
                            <p className="mt-0.5 text-[12px] leading-relaxed text-white/50">Prepares the launch draft rewards pool and validation parameters.</p>
                          </div>
                        </div>
                      </div>
                    </section>
                  ) : null}

                  {meaningful && campaignBlueprint?.summary ? (
                    <section className="border-b border-white/[0.05] pb-5">
                      <SectionEyebrow>Overview</SectionEyebrow>
                      <p className="mt-2 break-words text-[13px] leading-relaxed text-white/[0.82]">{campaignBlueprint.summary}</p>
                    </section>
                  ) : null}

                  {meaningful && knowledgeBaseSeed.text ? (
                    <section className="border-b border-white/[0.05] py-5">
                      <SectionEyebrow tint="amber">Knowledge Base</SectionEyebrow>
                      <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2.5">
                        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-white/74">
                          {knowledgeBaseSeed.text}
                        </p>
                      </div>
                      {knowledgeBaseSeed.sourceUrl ? (
                        <p className="mt-2 break-all text-[11px] text-white/48">Source · {knowledgeBaseSeed.sourceUrl}</p>
                      ) : null}
                    </section>
                  ) : null}

                  {meaningful && campaignBlueprint?.community?.name ? (
                    <section className={campaignBlueprint.summary ? "border-b border-white/[0.05] py-5" : "border-b border-white/[0.05] pb-5 pt-1"}>
                      <SectionEyebrow tint="sky">Community</SectionEyebrow>
                      {communityDisplayImage ? (
                        <div className="relative mt-3 overflow-hidden rounded-md">
                          <img
                            src={communityDisplayImage}
                            alt={campaignBlueprint.community.name}
                            className="aspect-[21/9] w-full object-cover opacity-95"
                          />
                          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,8,10,0.02),rgba(6,8,10,0.12)_45%,rgba(6,8,10,0.72)_100%)]" />
                          {communityProfileImage ? (
                            <div className="absolute bottom-0 left-3 translate-y-1/2">
                              <img
                                src={communityProfileImage}
                                alt={`${campaignBlueprint.community.name} profile`}
                                className="h-12 w-12 rounded-2xl border-2 border-[#0b0d0c] object-cover shadow-[0_12px_28px_rgba(0,0,0,0.45)]"
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <h3 className={`break-words text-[16px] font-medium leading-snug text-white/[0.95] ${communityDisplayImage ? "mt-9" : "mt-3"}`}>
                        {campaignBlueprint.community.name}
                      </h3>
                      {campaignBlueprint.community.description ? (
                        <p className="mt-2 break-words text-[12px] leading-relaxed text-white/72">{campaignBlueprint.community.description}</p>
                      ) : null}
                      {campaignBlueprint.community.audience ? (
                        <p className="mt-2 text-[11px] text-white/48">Audience · {campaignBlueprint.community.audience}</p>
                      ) : null}
                      <SectionBullets items={campaignBlueprint.community.keyFeatures} />
                      <button
                        type="button"
                        onClick={() => void applyCommunitySetup()}
                        disabled={setupStep === "saving"}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-lime-300/35 bg-[linear-gradient(180deg,rgba(163,230,53,0.28),rgba(98,178,30,0.18))] px-4 py-3 text-[13px] font-semibold text-lime-50 shadow-[0_14px_28px_rgba(132,255,91,0.12),inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:border-lime-200/45 hover:bg-[linear-gradient(180deg,rgba(190,242,100,0.34),rgba(120,200,40,0.2))] disabled:opacity-55"
                      >
                        {setupStep === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
                        {setupStep === "idle" && (resolvedCommunityId ? "Update workspace now" : "Build workspace now")}
                        {setupStep === "saving" && (setupProgress || "Saving…")}
                        {setupStep === "done" && "Update workspace again"}
                      </button>
                      <p className="mt-2 text-[11px] leading-relaxed text-white/52">
                        This saves the community draft, the starter product, and creates the first content rewards campaign as a draft.
                      </p>
                      {setupError ? <p className="mt-2 text-[11px] text-rose-300">{setupError}</p> : null}
                      {setupStep === "done" ? (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                          className="mt-4 overflow-hidden rounded-2xl border border-emerald-300/20 bg-[linear-gradient(180deg,rgba(52,211,153,0.10),rgba(6,10,8,0.65))] shadow-[0_12px_36px_rgba(0,0,0,0.30)]"
                        >
                          {communityDisplayImage ? (
                            <div className="relative h-24 w-full overflow-hidden">
                              <img
                                src={communityDisplayImage}
                                alt={campaignBlueprint?.community?.name || "Community"}
                                className="h-full w-full object-cover opacity-90"
                              />
                              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#080809]/80" />
                              {communityProfileImage && (
                                <div className="absolute bottom-0 left-3 translate-y-1/2">
                                  <img
                                    src={communityProfileImage}
                                    alt="Community profile"
                                    className="h-10 w-10 rounded-xl border-2 border-[#080809] object-cover shadow-lg"
                                  />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex h-16 items-center justify-center bg-emerald-400/[0.06]">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/20">
                                <span className="text-[18px]">✅</span>
                              </div>
                            </div>
                          )}
                          <div className={`px-3 pb-3 ${communityDisplayImage && communityProfileImage ? "pt-7" : "pt-3"}`}>
                            <p className="text-[9px] uppercase tracking-[0.2em] text-emerald-300/70">Workspace created</p>
                            <h4 className="mt-1 break-words text-[14px] font-semibold text-white/95">
                              {campaignBlueprint?.community?.name || "Your Community"}
                            </h4>
                            {campaignBlueprint?.community?.description ? (
                              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-white/60">
                                {campaignBlueprint.community.description}
                              </p>
                            ) : null}
                            <p className="mt-2 text-[10px] leading-relaxed text-emerald-200/65">
                              Workspace, campaign, and product saved to Vello database.
                            </p>
                          </div>
                          {workspaceSettingsHref ? (
                            <div className="grid grid-cols-2 gap-1.5 border-t border-white/[0.06] px-3 pb-3 pt-2">
                              <button
                                type="button"
                                onClick={() => onNavigate(workspaceSettingsHref)}
                                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-sky-300/25 bg-sky-400/[0.07] px-3 py-2 text-[11px] font-medium text-sky-100 transition hover:bg-sky-400/[0.13]"
                              >
                                Studio
                                <ExternalLink className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onNavigate(communityPreviewHref)}
                                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-white/75 transition hover:bg-white/[0.07]"
                              >
                                Market
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            </div>
                          ) : null}
                        </motion.div>
                      ) : null}
                    </section>
                  ) : null}

                  {meaningful && campaignBlueprint?.product?.name ? (
                    <section className="border-b border-white/[0.05] py-5">
                      <SectionEyebrow tint="emerald">Product</SectionEyebrow>
                      <h3 className="mt-2 break-words text-[16px] font-medium leading-snug text-white/[0.95]">{campaignBlueprint.product.name}</h3>
                      {campaignBlueprint.product.headline ? (
                        <p className="mt-1 text-[12px] font-medium text-white/80">{campaignBlueprint.product.headline}</p>
                      ) : null}
                      {campaignBlueprint.product.description ? (
                        <p className="mt-2 text-[12px] leading-relaxed text-white/72">{campaignBlueprint.product.description}</p>
                      ) : null}
                      {campaignBlueprint.product.pricingIdea ? (
                        <p className="mt-2 text-[11px] text-white/48">Pricing · {campaignBlueprint.product.pricingIdea}</p>
                      ) : null}
                      <SectionBullets items={campaignBlueprint.product.features} />
                    </section>
                  ) : null}

                  {meaningful && campaignBlueprint?.campaign?.name ? (
                    <section className="border-b border-white/[0.05] py-5">
                      <SectionEyebrow tint="violet">Campaign</SectionEyebrow>
                      {campaignBlueprint.campaign.imageUrl ? (
                        <img
                          src={campaignBlueprint.campaign.imageUrl}
                          alt={campaignBlueprint.campaign.name}
                          className="mt-3 aspect-[21/9] w-full rounded-md object-cover opacity-95"
                        />
                      ) : null}
                      <h3 className="mt-3 break-words text-[16px] font-medium leading-snug text-white/[0.95]">{campaignBlueprint.campaign.name}</h3>
                      {campaignBlueprint.campaign.angle ? (
                        <p className="mt-2 text-[12px] leading-relaxed text-white/72">{campaignBlueprint.campaign.angle}</p>
                      ) : null}
                      {campaignBlueprint.campaign.creatorBrief ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-white/50">Brief · {campaignBlueprint.campaign.creatorBrief}</p>
                      ) : null}
                      <SectionBullets items={campaignBlueprint.campaign.deliverables} />
                    </section>
                  ) : null}

                  {meaningful && campaignBlueprint?.campaign?.contentInputsNeeded?.length ? (
                    <section className="border-b border-white/[0.05] py-5">
                      <SectionEyebrow tint="amber">From you</SectionEyebrow>
                      <SectionBullets items={campaignBlueprint.campaign.contentInputsNeeded} />
                    </section>
                  ) : null}

                  {meaningful && drawerActions.length > 0 ? (
                    <div className="grid gap-2.5 pb-5 pt-1">
                      {drawerActions.map((action) => (
                        <button
                          key={`${action.type}:${action.payload.href}`}
                          type="button"
                          onClick={() => onNavigate(action.payload.href)}
                          className="inline-flex w-full items-center justify-between gap-3 rounded-xl border border-lime-300/18 bg-lime-400/[0.06] px-3.5 py-3 text-left text-[12px] font-medium text-white/88 transition hover:border-lime-200/28 hover:bg-lime-400/[0.1]"
                        >
                          <span className="leading-relaxed">{action.payload.label}</span>
                          <ExternalLink className="h-4 w-4 shrink-0 text-lime-100/80" />
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {meaningful && resolvedCommunityId ? (
                    <div className="border-t border-white/[0.06] pt-5">
                      <SectionEyebrow tint="amber">Treasury</SectionEyebrow>
                      <p className="mt-2 text-[12px] leading-relaxed text-white/60">
                        Fund this campaign&apos;s on-chain treasury on the Stage, connect your wallet and deposit
                        USDC there.
                      </p>
                      <button
                        type="button"
                        onClick={() => onNavigate(fundingHref)}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-lime-300/35 bg-[linear-gradient(180deg,rgba(163,230,53,0.28),rgba(98,178,30,0.18))] px-4 py-3 text-[13px] font-semibold text-lime-50 shadow-[0_14px_28px_rgba(132,255,91,0.12),inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:border-lime-200/45 hover:bg-[linear-gradient(180deg,rgba(190,242,100,0.34),rgba(120,200,40,0.2))]"
                      >
                        Fund this campaign on the Stage
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                  {meaningful && !resolvedCommunityId ? (
                    <p className="pb-6 pt-4 text-[12px] leading-relaxed text-white/54">
                      Build a workspace above to unlock funding from this panel.
                    </p>
                  ) : null}
                </div>

                <footer className="shrink-0 border-t border-white/[0.06] px-3 py-2.5 sm:px-4 sm:py-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] py-2.5 text-[12px] font-medium text-white/70 transition hover:border-lime-300/18 hover:text-white"
                  >
                    Back to canvas
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                </footer>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

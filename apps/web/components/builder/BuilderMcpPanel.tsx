"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Zap,
  Video,
  Mail,
  CheckSquare,
  Loader2,
  ChevronRight,
  ExternalLink,
  Plug,
  Sparkles,
} from "lucide-react";
import type { CampaignBlueprint } from "@/lib/builder/campaignBlueprint";

export interface McpTool {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: "video" | "email" | "tasks" | "ai";
  connected: boolean;
}

export interface ToolCallAction {
  id: string;
  toolId: string;
  label: string;
  description: string;
  status: "pending" | "running" | "done" | "error";
  result?: string;
  params?: Record<string, unknown>;
}

interface BuilderMcpPanelProps {
  open: boolean;
  onClose: () => void;
  campaignBlueprint: CampaignBlueprint;
  pendingToolCalls?: ToolCallAction[];
  onToolCallApprove?: (call: ToolCallAction) => void;
  onToolCallDismiss?: (callId: string) => void;
  onMessage?: (text: string) => void;
}

const DEFAULT_TOOLS: McpTool[] = [
  {
    id: "higgsfield",
    label: "Higgsfield",
    description: "Generate AI marketing videos & images for your campaign",
    icon: <Video className="w-4 h-4" />,
    category: "video",
    connected: false,
  },
  {
    id: "gmail",
    label: "Gmail",
    description: "Draft and send campaign outreach & creator invitations",
    icon: <Mail className="w-4 h-4" />,
    category: "email",
    connected: false,
  },
  {
    id: "clickup",
    label: "ClickUp",
    description: "Auto-create campaign tasks and track deliverables",
    icon: <CheckSquare className="w-4 h-4" />,
    category: "tasks",
    connected: false,
  },
];

const TOOL_COLORS: Record<string, string> = {
  video: "#f59e0b",
  email: "#3b82f6",
  tasks: "#8b5cf6",
  ai: "#10b981",
};

function ToolCard({
  tool,
  onConnect,
  onTrigger,
  loading,
}: {
  tool: McpTool;
  onConnect: (id: string) => void;
  onTrigger: (id: string) => void;
  loading: boolean;
}) {
  const color = TOOL_COLORS[tool.category] || "#6b7280";

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 hover:bg-white/[0.05] transition-colors">
      <div className="flex items-start gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: `${color}1a`, color }}
        >
          {tool.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-white/90">{tool.label}</span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide"
              style={{
                backgroundColor: tool.connected ? `${color}22` : "rgba(255,255,255,0.06)",
                color: tool.connected ? color : "rgba(255,255,255,0.35)",
              }}
            >
              {tool.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-white/50 leading-relaxed">{tool.description}</p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        {!tool.connected ? (
          <button
            type="button"
            onClick={() => onConnect(tool.id)}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Plug className="w-3 h-3" />
            Connect
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onTrigger(tool.id)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: `${color}22`, color }}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Run
          </button>
        )}
      </div>
    </div>
  );
}

function ToolCallCard({
  call,
  onApprove,
  onDismiss,
}: {
  call: ToolCallAction;
  onApprove: (c: ToolCallAction) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-lg border border-lime-500/20 bg-lime-400/[0.04] p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-lime-400 shrink-0" />
          <span className="text-[11px] font-medium text-lime-200">{call.label}</span>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(call.id)}
          className="text-white/30 hover:text-white/70 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <p className="mt-1 text-[10px] text-white/55 leading-relaxed">{call.description}</p>
      {call.status === "running" && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-lime-300/70">
          <Loader2 className="w-3 h-3 animate-spin" />
          Running…
        </div>
      )}
      {call.status === "done" && call.result && (
        <div className="mt-2 rounded bg-white/[0.04] px-2 py-1.5 text-[10px] text-white/60 leading-relaxed">
          {call.result}
        </div>
      )}
      {call.status === "error" && (
        <div className="mt-2 text-[10px] text-red-400/80">{call.result || "Tool call failed."}</div>
      )}
      {call.status === "pending" && (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => onApprove(call)}
            className="inline-flex items-center gap-1 rounded-md bg-lime-400 px-2.5 py-1 text-[11px] font-bold text-lime-950 hover:bg-lime-300 transition-colors"
          >
            <ChevronRight className="w-3 h-3" />
            Approve & Run
          </button>
          <button
            type="button"
            onClick={() => onDismiss(call.id)}
            className="text-[11px] text-white/40 hover:text-white/70 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </motion.div>
  );
}

export default function BuilderMcpPanel({
  open,
  onClose,
  campaignBlueprint,
  pendingToolCalls = [],
  onToolCallApprove,
  onToolCallDismiss,
  onMessage,
}: BuilderMcpPanelProps) {
  const [tools, setTools] = useState<McpTool[]>(DEFAULT_TOOLS);
  const [loadingTool, setLoadingTool] = useState<string | null>(null);
  const [connectingTool, setConnectingTool] = useState<string | null>(null);

  const handleConnect = useCallback(
    async (toolId: string) => {
      setConnectingTool(toolId);
      try {
        const res = await fetch("/api/builder/tool-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "connect", toolId }),
        });
        if (res.ok) {
          setTools((prev) =>
            prev.map((t) => (t.id === toolId ? { ...t, connected: true } : t)),
          );
          onMessage?.(`${toolId} connected. You can now trigger it from the builder.`);
        } else {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          onMessage?.(`Could not connect ${toolId}: ${data.error || "Unknown error"}.`);
        }
      } catch {
        onMessage?.(`Could not connect ${toolId}. Check your network.`);
      } finally {
        setConnectingTool(null);
      }
    },
    [onMessage],
  );

  const handleTrigger = useCallback(
    async (toolId: string) => {
      setLoadingTool(toolId);
      const name =
        campaignBlueprint.campaign?.name ||
        campaignBlueprint.community?.name ||
        "my campaign";
      const prompt =
        campaignBlueprint.campaign?.angle ||
        campaignBlueprint.product?.headline ||
        campaignBlueprint.community?.description ||
        name;

      try {
        const res = await fetch("/api/builder/tool-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "trigger", toolId, campaignBlueprint, prompt }),
        });
        const data = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
        if (res.ok && data.result) {
          onMessage?.(`${toolId} result: ${data.result}`);
        } else {
          onMessage?.(`${toolId} returned an error: ${data.error || "Unknown"}.`);
        }
      } catch {
        onMessage?.(`${toolId} tool call failed. Check connection.`);
      } finally {
        setLoadingTool(null);
      }
    },
    [campaignBlueprint, onMessage],
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            onClick={onClose}
          />
          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="absolute right-0 top-0 bottom-0 z-50 flex w-[320px] max-w-[calc(100vw-2.5rem)] flex-col border-l border-white/[0.08] bg-[#141414] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 shrink-0">
              <div className="flex items-center gap-2">
                <Plug className="w-3.5 h-3.5 text-white/40" />
                <span className="text-xs font-semibold text-white/90">AI Tools & Connections</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-white/40 hover:text-white/80 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
              {/* Pending AI tool calls */}
              {pendingToolCalls.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] uppercase tracking-widest text-white/30">
                    AI requested
                  </p>
                  <div className="space-y-2">
                    <AnimatePresence>
                      {pendingToolCalls.map((call) => (
                        <ToolCallCard
                          key={call.id}
                          call={call}
                          onApprove={onToolCallApprove || (() => {})}
                          onDismiss={onToolCallDismiss || (() => {})}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* Quick actions based on campaign blueprint */}
              {(campaignBlueprint.campaign?.name || campaignBlueprint.product?.name) && (
                <div>
                  <p className="mb-2 text-[10px] uppercase tracking-widest text-white/30">
                    Quick actions
                  </p>
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => handleTrigger("higgsfield")}
                      disabled={!!loadingTool}
                      className="w-full flex items-center justify-between rounded-md border border-amber-500/15 bg-amber-400/[0.04] px-3 py-2 text-[11px] text-amber-200/80 hover:bg-amber-400/[0.08] transition-colors disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2">
                        {loadingTool === "higgsfield" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Video className="w-3 h-3" />
                        )}
                        Generate campaign video
                      </span>
                      <ExternalLink className="w-3 h-3 opacity-50" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTrigger("gmail")}
                      disabled={!!loadingTool}
                      className="w-full flex items-center justify-between rounded-md border border-blue-500/15 bg-blue-400/[0.04] px-3 py-2 text-[11px] text-blue-200/80 hover:bg-blue-400/[0.08] transition-colors disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2">
                        {loadingTool === "gmail" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Mail className="w-3 h-3" />
                        )}
                        Draft creator outreach
                      </span>
                      <ExternalLink className="w-3 h-3 opacity-50" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTrigger("clickup")}
                      disabled={!!loadingTool}
                      className="w-full flex items-center justify-between rounded-md border border-purple-500/15 bg-purple-400/[0.04] px-3 py-2 text-[11px] text-purple-200/80 hover:bg-purple-400/[0.08] transition-colors disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2">
                        {loadingTool === "clickup" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckSquare className="w-3 h-3" />
                        )}
                        Create launch tasks
                      </span>
                      <ExternalLink className="w-3 h-3 opacity-50" />
                    </button>
                  </div>
                </div>
              )}

              {/* Tool connections */}
              <div>
                <p className="mb-2 text-[10px] uppercase tracking-widest text-white/30">
                  Integrations
                </p>
                <div className="space-y-2">
                  {tools.map((tool) => (
                    <ToolCard
                      key={tool.id}
                      tool={tool}
                      onConnect={handleConnect}
                      onTrigger={handleTrigger}
                      loading={loadingTool === tool.id || connectingTool === tool.id}
                    />
                  ))}
                </div>
              </div>

              {/* About */}
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="text-[10px] text-white/40 leading-relaxed">
                  Connected tools let the AI autonomously generate videos, send emails, and manage
                  tasks on your behalf, all triggered from the chat conversation.
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

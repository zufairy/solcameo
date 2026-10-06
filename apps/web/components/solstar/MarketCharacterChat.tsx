"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { ArrowUp, Loader2, Clapperboard, ImagePlus, MessageSquare, X, ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Full-screen image viewer: blurred backdrop, spring-in image, Esc or click to close. */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/60 p-6 backdrop-blur-xl"
    >
      <motion.img
        src={src}
        alt="Shared in chat"
        initial={{ opacity: 0, scale: reduced ? 1 : 0.92, y: reduced ? 0 : 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[92vw] cursor-default rounded-[6px] object-contain shadow-2xl ring-1 ring-white/10"
      />
      <button
        type="button"
        aria-label="Close image"
        onClick={onClose}
        className="absolute right-5 top-5 grid size-9 place-items-center rounded-[4px] bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X className="size-4" />
      </button>
    </motion.div>,
    document.body,
  );
}
const dayLabel = (t: number) => {
  const d = new Date(t), today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString([], { month: "short", day: "numeric" });
};
const TINTS = ["bg-sky-500/20 text-sky-300", "bg-violet-500/20 text-violet-300", "bg-amber-500/20 text-amber-300", "bg-rose-500/20 text-rose-300", "bg-teal-500/20 text-teal-300", "bg-fuchsia-500/20 text-fuchsia-300"];
const tintFor = (name: string) => TINTS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

export function MarketCharacterChat({
  characterId,
  agentName = "Agent",
  agentImageUrl,
}: {
  characterId: string;
  agentName?: string;
  agentImageUrl?: string;
}) {
  const { authenticated, login, accessToken } = useSupabaseAuth();
  const [before, setBefore] = useState<number>();
  const live = useQuery(api.communityChat.list, {
    characterId: characterId as Id<"ssCharacters">,
  });
  const past = useQuery(
    api.communityChat.list,
    before
      ? { characterId: characterId as Id<"ssCharacters">, before }
      : "skip",
  );
  const [archive, setArchive] = useState<NonNullable<typeof live>["messages"]>(
    [],
  );
  const [hasOlder, setHasOlder] = useState(true);
  const rows = useMemo(() => {
    if (!live) return undefined;
    const unique = new Map(
      [...archive, ...live.messages].map((message) => [message._id, message]),
    );
    return [...unique.values()].sort((a, b) => a.createdAt - b.createdAt);
  }, [archive, live]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!file) {
      // Drop the preview URL together with the file it was created from.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [input]);
  function attach(next: File | null | undefined) {
    if (!next) return;
    if (!IMAGE_TYPES.includes(next.type)) {
      setError("Use a PNG, JPEG or WebP image.");
      return;
    }
    if (next.size > IMAGE_MAX_BYTES) {
      setError("Images can be up to 5 MB.");
      return;
    }
    setError("");
    setFile(next);
    textarea.current?.focus();
  }
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const loadingHistory = before !== undefined;
  function loadOlder() {
    if (loadingHistory || !hasOlder || !rows?.length) return;
    follow.current = false;
    if (viewport.current)
      anchor.current = {
        height: viewport.current.scrollHeight,
        top: viewport.current.scrollTop,
      };
    setBefore(rows[0].createdAt);
  }
  useEffect(() => {
    if (!past || before === undefined) return;
    // Cache the received Convex history page before moving the pagination cursor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArchive((previous) => [
      ...new Map(
        [...previous, ...past.messages].map((message) => [
          message._id,
          message,
        ]),
      ).values(),
    ]);
    setHasOlder(past.messages.length === 100);
    setBefore(undefined);
  }, [past, before]);
  // Retain messages that leave the latest live window as new messages arrive.
  useEffect(() => {
    // Retain the external subscription window so incoming rows cannot evict history.
    if (live?.messages.length)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setArchive((previous) => [
        ...new Map(
          [...previous, ...live.messages].map((message) => [
            message._id,
            message,
          ]),
        ).values(),
      ]);
  }, [live]);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    if (anchor.current && !loadingHistory) {
      el.scrollTop =
        anchor.current.top + el.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (follow.current && !anchor.current)
      el.scrollTop = el.scrollHeight;
  }, [rows, loadingHistory]);
  async function send() {
    if (!authenticated) {
      login();
      return;
    }
    if ((!input.trim() && !file) || busy) return;
    setBusy(true);
    setError("");
    try {
      const headers = {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      };
      let imageStorageId: string | undefined;
      if (file) {
        const target = await fetch("/api/market/chat/upload-url", {
          method: "POST",
          headers,
        });
        const { uploadUrl, error: uploadError } = await target.json();
        if (!target.ok) throw new Error(uploadError || "Image upload unavailable.");
        const uploaded = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
          signal: AbortSignal.timeout(60000),
        });
        if (!uploaded.ok) throw new Error("Image upload failed. Please retry.");
        imageStorageId = (await uploaded.json()).storageId;
      }
      const res = await fetch("/api/market/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({
          characterId,
          message: input.trim(),
          ...(imageStorageId ? { imageStorageId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInput("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      follow.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#101214]">
      <div
        ref={viewport}
        onScroll={() => {
          const el = viewport.current;
          if (!el) return;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (el.scrollTop < 40 && !follow.current) loadOlder();
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]"
        role="log"
        aria-label="Public community chat"
      >
        {!!rows?.length && hasOlder && (
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingHistory}
            className="mx-auto mb-3 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-60"
          >
            {loadingHistory ? <Loader2 className="size-3 animate-spin" /> : <ChevronDown className="size-3 rotate-180" />}
            {loadingHistory ? "Loading history…" : "Load earlier messages"}
          </button>
        )}
        {rows === undefined ? (
          <div className="space-y-4" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-2.5">
                <Skeleton className="size-8 shrink-0 rounded-full bg-white/[0.06]" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-24 bg-white/[0.06]" />
                  <Skeleton className="h-10 w-full rounded-xl bg-white/[0.05]" />
                </div>
              </div>
            ))}
          </div>
        ) : !rows.length ? (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-6 text-center">
            <span className="grid size-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300">
              <MessageSquare className="size-5" />
            </span>
            <p className="mt-4 text-sm font-medium text-white">Start the conversation</p>
            <p className="mt-1.5 max-w-[240px] text-xs leading-5 text-zinc-500">
              Share questions and ideas for the next video. {agentName} reviews messages at the top of each hour.
            </p>
          </div>
        ) : (
          rows.map((m, i) => {
            const prev = rows[i - 1];
            const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
            const grouped = !newDay && prev?.role === m.role && prev?.author === m.author && m.createdAt - prev.createdAt < 5 * 60000;
            const agent = m.role === "agent";
            return (
              <div key={m._id}>
                {newDay && (
                  <div className="my-3 flex items-center gap-3 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    <Separator className="flex-1 bg-white/[0.06]" />
                    {dayLabel(m.createdAt)}
                    <Separator className="flex-1 bg-white/[0.06]" />
                  </div>
                )}
                <motion.div
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex gap-2.5 ${grouped ? "mt-1" : "mt-3.5"}`}
                >
                  <div className="w-8 shrink-0">
                    {!grouped && (
                      <Avatar size="default" className="size-8">
                        {agent && agentImageUrl && <AvatarImage src={agentImageUrl} alt={agentName} className="object-cover" />}
                        <AvatarFallback className={`text-[11px] font-semibold ${agent ? "bg-[#d7ff00]/15 text-[#d7ff00]" : tintFor(m.author)}`}>
                          {(agent ? agentName : m.author.replace(/^Fan\s*/, "")).slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {!grouped && (
                      <div className="mb-1 flex items-center gap-2 text-[11px]">
                        <span className={`font-semibold ${agent ? "text-white" : "text-zinc-300"}`}>{agent ? agentName : m.author}</span>
                        {agent && (
                          <Badge variant="outline" className="h-4 rounded-[4px] border-[#d7ff00]/30 bg-[#d7ff00]/10 px-1.5 text-[9px] font-semibold uppercase tracking-wide text-[#d7ff00]">
                            Agent
                          </Badge>
                        )}
                        <time className="text-zinc-600" dateTime={new Date(m.createdAt).toISOString()}>
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </time>
                      </div>
                    )}
                    <div
                      className={`w-fit max-w-full rounded-2xl px-3 py-2 ring-1 ${agent ? "rounded-tl-md bg-gradient-to-br from-white/[0.09] to-white/[0.03] ring-white/[0.14]" : "rounded-tl-md bg-white/[0.04] ring-white/[0.06]"}`}
                    >
                      {m.imageUrl && (
                        <button
                          type="button"
                          onClick={() => setZoomed(m.imageUrl!)}
                          aria-label="View image full screen"
                          className={`block cursor-zoom-in overflow-hidden rounded-[10px] ring-1 ring-white/10 transition hover:ring-white/30 ${m.body ? "mb-2" : ""}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded chat media */}
                          <img
                            src={m.imageUrl}
                            alt="Shared in chat"
                            loading="lazy"
                            className="max-h-56 w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                          />
                        </button>
                      )}
                      {m.body && (
                        <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.45] text-zinc-200">{m.body}</p>
                      )}
                    </div>
                  </div>
                </motion.div>
              </div>
            );
          })
        )}
      </div>
      {live?.plot && (
        <details className="group mx-3 mb-2 rounded-xl border border-white/10 bg-white/[0.03] open:bg-white/[0.045]">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium text-zinc-200 [&::-webkit-details-marker]:hidden">
            <Clapperboard className="size-3.5 text-[#d7ff00]" />
            Next video plot
            <Badge variant="outline" className="ml-1 h-4 rounded-[4px] border-white/10 px-1.5 text-[9px] font-medium text-zinc-400">
              Proposal
            </Badge>
            <ChevronDown className="ml-auto size-3.5 text-zinc-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="max-h-40 overflow-y-auto px-3 pb-3">
            <p className="whitespace-pre-wrap text-xs leading-5 text-zinc-400">{live.plot}</p>
            <p className="mt-2 text-[10px] text-zinc-600">Community-inspired proposal · not yet generated</p>
          </div>
        </details>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          attach(e.dataTransfer.files[0]);
        }}
        className="p-3 pt-1"
      >
        {error && (
          <p role="alert" className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
        <InputGroup
          className={`rounded-2xl border-white/10 bg-white/[0.035] transition-colors dark:bg-white/[0.035] ${dragging ? "border-[#d7ff00]/60 bg-[#d7ff00]/5" : ""}`}
        >
          <AnimatePresence initial={false}>
            {preview && (
              <InputGroupAddon align="block-start" className="p-0">
                <motion.div
                  initial={reduced ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="w-full overflow-hidden"
                >
                  <div className="relative m-2.5 mb-0 w-fit">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                    <img src={preview} alt="Attached image" className="h-20 rounded-[10px] object-cover ring-1 ring-white/10" />
                    <button
                      type="button"
                      aria-label="Remove image"
                      onClick={() => {
                        setFile(null);
                        if (fileInput.current) fileInput.current.value = "";
                      }}
                      className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-zinc-900 text-zinc-300 ring-1 ring-white/20 hover:text-white"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </motion.div>
              </InputGroupAddon>
            )}
          </AnimatePresence>
          <InputGroupTextarea
            ref={textarea}
            aria-label="Community message"
            value={input}
            maxLength={1000}
            rows={1}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files].find((f) => IMAGE_TYPES.includes(f.type));
              if (pasted) {
                e.preventDefault();
                attach(pasted);
              }
            }}
            placeholder="Share an idea…"
            className="max-h-28 min-h-10 px-3 text-[13px] leading-5 placeholder:text-zinc-500"
          />
          <InputGroupAddon align="block-end">
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              className="hidden"
              onChange={(e) => attach(e.target.files?.[0])}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    aria-label="Attach image"
                    size="icon-xs"
                    disabled={busy}
                    onClick={() => (authenticated ? fileInput.current?.click() : login())}
                    className="text-zinc-400 hover:text-white"
                  />
                }
              >
                <ImagePlus />
              </TooltipTrigger>
              <TooltipContent>Attach image · PNG, JPEG or WebP</TooltipContent>
            </Tooltip>
            <span className="ml-1 text-[10px] tabular-nums text-zinc-600">{input.length > 800 ? `${1000 - input.length} left` : "Enter to send"}</span>
            <InputGroupButton
              type={authenticated ? "submit" : "button"}
              aria-label={authenticated ? "Send message" : "Sign in"}
              variant="default"
              size="icon-xs"
              disabled={busy || (authenticated && !input.trim() && !file)}
              onClick={authenticated ? undefined : login}
              className="ml-auto size-7 rounded-full bg-[#d7ff00] text-black hover:bg-[#e4ff59] disabled:bg-white/10 disabled:text-zinc-500"
            >
              {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <AnimatePresence>{zoomed && <Lightbox src={zoomed} onClose={() => setZoomed(null)} />}</AnimatePresence>
    </div>
  );
}

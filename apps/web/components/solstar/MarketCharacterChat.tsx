"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Send, Loader2, Clapperboard, ImagePlus, X } from "lucide-react";

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
export function MarketCharacterChat({ characterId }: { characterId: string }) {
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
    <div className="flex h-full min-h-0 flex-col bg-[#111315]">
      <div
        ref={viewport}
        onScroll={() => {
          const el = viewport.current;
          if (!el) return;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (el.scrollTop < 40 && !follow.current) loadOlder();
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3"
        role="log"
        aria-label="Public community chat"
      >
        {!!rows?.length && hasOlder && (
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingHistory}
            className="w-full py-1 text-[10px] text-zinc-500 hover:text-zinc-200"
          >
            {loadingHistory ? "Loading history…" : "Load earlier messages"}
          </button>
        )}
        {rows === undefined ? (
          <Loader2 className="size-4 animate-spin text-zinc-500" />
        ) : !rows.length ? (
          <p className="text-xs leading-5 text-zinc-500">
            Start the conversation. Share questions and ideas for the next
            video. The agent reviews community messages at the top of each hour.
          </p>
        ) : (
          rows.map((m) => (
            <motion.div
              key={m._id}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`rounded-lg p-2.5 ${m.role === "agent" ? "border border-[#d7ff00]/20 bg-[#d7ff00]/5" : "bg-white/[.025]"}`}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                <span
                  className={
                    m.role === "agent"
                      ? "font-medium text-[#d7ff00]"
                      : "text-zinc-500"
                  }
                >
                  {m.role === "agent" ? "Agent · hourly reply" : m.author}
                </span>
                <time className="text-zinc-600">
                  {new Date(m.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              {m.imageUrl && (
                <button
                  type="button"
                  onClick={() => setZoomed(m.imageUrl!)}
                  aria-label="View image full screen"
                  className="mb-1.5 block cursor-zoom-in overflow-hidden rounded-[6px] ring-1 ring-white/10 transition hover:ring-white/30"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded chat media */}
                  <img
                    src={m.imageUrl}
                    alt="Shared in chat"
                    loading="lazy"
                    className="max-h-52 w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                  />
                </button>
              )}
              {m.body && (
                <p className="whitespace-pre-wrap break-words text-xs leading-5 text-zinc-300">
                  {m.body}
                </p>
              )}
            </motion.div>
          ))
        )}
      </div>
      {live?.plot && (
        <details className="border-t border-white/10 px-3 py-3">
          <summary className="flex cursor-pointer items-center gap-2 text-xs text-[#d7ff00]">
            <Clapperboard className="size-3.5" />
            Next video plot
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-400">
            {live.plot}
          </p>
          <p className="mt-2 text-[10px] text-zinc-600">
            Community-inspired proposal · not yet generated
          </p>
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
        className="border-t border-white/10 p-3"
      >
        {error && (
          <p role="alert" className="mb-2 text-xs text-red-300">
            {error}
          </p>
        )}
        <div
          className={`rounded-xl border bg-white/[.03] transition-colors focus-within:border-white/25 ${dragging ? "border-[#d7ff00]/60 bg-[#d7ff00]/5" : "border-white/10"}`}
        >
          <AnimatePresence initial={false}>
            {preview && (
              <motion.div
                initial={reduced ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="relative m-2 mb-0 w-fit">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                  <img
                    src={preview}
                    alt="Attached image"
                    className="h-20 rounded-[6px] object-cover ring-1 ring-white/10"
                  />
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
            )}
          </AnimatePresence>
          <div className="flex items-end gap-1.5 p-1.5">
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              className="hidden"
              onChange={(e) => attach(e.target.files?.[0])}
            />
            <button
              type="button"
              aria-label="Attach image"
              title="Attach image"
              disabled={busy}
              onClick={() =>
                authenticated ? fileInput.current?.click() : login()
              }
              className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
            >
              <ImagePlus className="size-4" />
            </button>
            <textarea
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
                const pasted = [...e.clipboardData.files].find((f) =>
                  IMAGE_TYPES.includes(f.type),
                );
                if (pasted) {
                  e.preventDefault();
                  attach(pasted);
                }
              }}
              placeholder="Share an idea…"
              className="max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-xs leading-5 text-zinc-200 outline-none placeholder:text-zinc-500 disabled:opacity-60"
            />
            <button
              type={authenticated ? "submit" : "button"}
              aria-label={authenticated ? "Send message" : "Sign in"}
              disabled={busy || (authenticated && !input.trim() && !file)}
              onClick={authenticated ? undefined : login}
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#d7ff00] text-black transition active:scale-95 hover:bg-[#e4ff59] disabled:bg-white/10 disabled:text-zinc-500"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
            </button>
          </div>
        </div>
      </form>
      <AnimatePresence>
        {zoomed && <Lightbox src={zoomed} onClose={() => setZoomed(null)} />}
      </AnimatePresence>
    </div>
  );
}

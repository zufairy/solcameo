"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

/**
 * Live X timeline for the influencer, served by X's own embed widget so posts
 * are fetched live from X (no stored copy, no API key). Needs the profile URL
 * the creator saved on the character; without one we say so instead of
 * showing a blank slide.
 */
declare global {
  interface Window { twttr?: { widgets?: { load: (el?: HTMLElement) => void } } }
}

const SCRIPT_SRC = "https://platform.twitter.com/widgets.js";

function handleFrom(xUrl?: string): string | null {
  if (!xUrl) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(xUrl) ? xUrl : `https://${xUrl}`);
    if (!/(^|\.)(x|twitter)\.com$/i.test(u.hostname)) return null;
    const h = u.pathname.split("/").filter(Boolean)[0];
    return h && /^[A-Za-z0-9_]{1,15}$/.test(h) ? h : null;
  } catch { return null; }
}

function loadWidgets(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.twttr?.widgets) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const s = existing ?? Object.assign(document.createElement("script"), { src: SCRIPT_SRC, async: true });
    s.addEventListener("load", () => resolve(), { once: true });
    s.addEventListener("error", () => reject(new Error("X widgets blocked")), { once: true });
    if (!existing) document.body.appendChild(s);
  });
}

export function XFeedPanel({ xUrl, name }: { xUrl?: string; name: string }) {
  const handle = handleFrom(xUrl);
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "blocked">("loading");

  useEffect(() => {
    const el = box.current;
    if (!handle || !el) return;
    let alive = true;
    setState("loading");
    el.innerHTML = "";
    const a = document.createElement("a");
    a.className = "twitter-timeline";
    a.href = `https://twitter.com/${handle}`;
    a.setAttribute("data-theme", "dark");
    a.setAttribute("data-height", "220");
    a.setAttribute("data-chrome", "noheader nofooter noborders transparent");
    a.setAttribute("data-dnt", "true");
    a.textContent = `Posts by @${handle}`;
    el.appendChild(a);
    loadWidgets()
      .then(() => { window.twttr?.widgets?.load(el); if (alive) window.setTimeout(() => alive && setState("ready"), 1200); })
      .catch(() => { if (alive) setState("blocked"); });
    return () => { alive = false; };
  }, [handle]);

  if (!handle) {
    return (
      <div className="space-y-1.5 p-4 text-xs text-zinc-500">
        <p className="text-white/80">No X account linked yet</p>
        <p>When {name}&apos;s creator adds their X profile, the live feed shows up here.</p>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-medium text-white">@{handle}</span>
        <a href={`https://x.com/${handle}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white">
          Open on X <ExternalLink className="size-3" />
        </a>
      </div>
      <div ref={box} className="min-h-[200px]" />
      {state === "loading" && <p className="px-1 pt-1 text-[10px] text-zinc-500">Loading live posts from X…</p>}
      {state === "blocked" && <p className="px-1 pt-1 text-[10px] text-zinc-500">X embeds are blocked in this browser. Use “Open on X”.</p>}
    </div>
  );
}

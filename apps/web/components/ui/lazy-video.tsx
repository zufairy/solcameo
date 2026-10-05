"use client";

import { useEffect, useRef, useState, type VideoHTMLAttributes } from "react";

/**
 * A `<video>` that stays `preload="none"` until it scrolls into view, then
 * upgrades to `preload="metadata"` so the first frame renders. A list of 100+
 * `<video preload="metadata">` tiles fires 100+ concurrent media range fetches
 * on mount; the browser throttles media players + per-host connections and the
 * panel sits on "loading" for a long time. Only the ~dozen visible tiles need
 * their header — the rest load as they scroll in.
 */
export function LazyVideo({ preload = "metadata", ...rest }: VideoHTMLAttributes<HTMLVideoElement>) {
  const ref = useRef<HTMLVideoElement>(null);
  // No IntersectionObserver (SSR / very old browsers) → behave like a plain <video>.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return <video ref={ref} preload={visible ? preload : "none"} {...rest} />;
}

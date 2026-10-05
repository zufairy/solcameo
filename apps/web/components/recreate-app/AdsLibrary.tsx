"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Clock, Flame, RefreshCw, Repeat, ThumbsUp, X } from "lucide-react";
import { AppHeaderShell } from "@/components/home/app-shell";

/* ════════ /recreate/library — Ads Library ════════
   Trending, top-converting UGC ad creatives (TikTok Creative Center Top Ads,
   scraped per-country server-side, 24h content cycle). Click a video for a
   big popup player; every card's RECREATE button lands back on /recreate with
   the ad imported and ready to replicate with your own product/context. */

const BG = "#08080a";
const INTER = { fontFamily: "var(--font-inter, var(--font-geist-sans, system-ui))" } as const;

const COUNTRIES = [
  { id: "GLOBAL", label: "🌍 Global" },
  { id: "US", label: "🇺🇸 United States" },
  { id: "MY", label: "🇲🇾 Malaysia" },
  { id: "GB", label: "🇬🇧 United Kingdom" },
  { id: "SG", label: "🇸🇬 Singapore" },
] as const;

type AdItem = {
  id: string;
  title: string;
  brandName: string;
  videoUrl: string;
  coverUrl: string;
  durationSeconds: number;
  ctr: number;
  likes: number;
  industry: string;
};

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const s = total % 60;
  return `${m}m ${s}s`;
}

/** Big smooth popup player — backdrop blur, Esc/backdrop close, native controls. */
function AdVideoModal({ ad, onClose, onRecreate }: { ad: AdItem; onClose: () => void; onRecreate: (ad: AdItem) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm" onClick={onClose}>
      <button type="button" onClick={onClose} aria-label="Close"
        className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20">
        <X className="size-5" />
      </button>
      <div className="flex max-h-[92vh] flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <video
          src={ad.videoUrl}
          controls
          autoPlay
          playsInline
          poster={ad.coverUrl || undefined}
          className="max-h-[78vh] max-w-[92vw] rounded-xl bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
        />
        <div className="flex w-full max-w-[560px] items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-white">{ad.brandName || ad.title}</p>
            <p className="truncate text-[11.5px] text-white/45">{ad.title}</p>
          </div>
          <button type="button" onClick={() => onRecreate(ad)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-[13px] font-semibold text-black transition-all hover:bg-white/90 active:scale-[0.98]">
            <Repeat className="size-3.5" /> Recreate
          </button>
        </div>
      </div>
    </div>
  );
}

function AdCard({ ad, onOpen, onRecreate }: { ad: AdItem; onOpen: (ad: AdItem) => void; onRecreate: (ad: AdItem) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] transition-transform hover:-translate-y-0.5"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button type="button" onClick={() => onOpen(ad)} className="relative block aspect-[9/16] w-full cursor-pointer bg-black">
        {hover ? (
          <video src={ad.videoUrl} muted playsInline autoPlay loop className="size-full object-cover" poster={ad.coverUrl || undefined} />
        ) : ad.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.coverUrl} alt={ad.title} className="size-full object-cover" loading="lazy" />
        ) : (
          <video src={`${ad.videoUrl}#t=0.001`} muted playsInline preload="metadata" className="size-full object-cover" />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-8 text-left">
          <p className="truncate text-[12px] font-semibold text-white">{ad.brandName || ad.title}</p>
          <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-white/60">
            {ad.ctr > 0 && (
              <span className="inline-flex items-center gap-0.5"><Flame className="size-3 text-orange-400" /> {ad.ctr.toFixed(2)}% CTR</span>
            )}
            {ad.likes > 0 && (
              <span className="inline-flex items-center gap-0.5"><ThumbsUp className="size-3" /> {fmtCompact(ad.likes)}</span>
            )}
            {ad.durationSeconds > 0 && <span>{ad.durationSeconds}s</span>}
          </div>
        </div>
        {ad.industry && (
          <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium capitalize text-white/80 backdrop-blur-sm">
            {ad.industry}
          </span>
        )}
      </button>
      <div className="p-2.5">
        <p className="line-clamp-2 min-h-[30px] text-[11.5px] leading-snug text-white/60">{ad.title}</p>
        <button
          type="button"
          onClick={() => onRecreate(ad)}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-[12.5px] font-semibold text-black transition-all hover:bg-white/90 active:scale-[0.98]"
        >
          <Repeat className="size-3.5" /> Recreate
        </button>
      </div>
    </div>
  );
}

export function AdsLibrary() {
  const router = useRouter();
  const [items, setItems] = useState<AdItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState<string>("GLOBAL");
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [openAd, setOpenAd] = useState<AdItem | null>(null);

  // Tick the 24h-cycle countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async (cc: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/recreate/ads-library?country=${encodeURIComponent(cc)}`);
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; items?: AdItem[]; error?: string; nextRefreshAt?: number };
      if (!res.ok || !j.ok || !j.items) {
        setError(j.error ?? `Could not load (HTTP ${res.status})`);
        setItems([]);
        return;
      }
      setItems(j.items);
      setNextRefreshAt(j.nextRefreshAt ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(country); }, [load, country]);

  const recreate = useCallback((ad: AdItem) => {
    router.push(`/recreate?src=${encodeURIComponent(ad.videoUrl)}&title=${encodeURIComponent(ad.brandName || ad.title)}`);
  }, [router]);

  return (
    <AppHeaderShell>
      <div className="min-h-full px-8 py-10" style={{ background: BG, ...INTER }}>
        <div className="mx-auto max-w-[1180px]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => router.push("/recreate")}
                className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-white/60 transition-colors hover:text-white">
                <ArrowLeft className="size-4" />
              </button>
              <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                <Flame className="size-4.5 text-white/80" strokeWidth={1.75} />
              </span>
              <div>
                <h1 className="text-[26px] font-thin tracking-tight text-white">Ads Library</h1>
                <p className="text-[13px] text-white/40">The internet&apos;s top converting UGC ads right now. Pick one and recreate it with your product.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* 24h content-cycle countdown */}
              {nextRefreshAt && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[12px] font-medium text-white/60" title="The feed rotates to fresh ads every 24 hours">
                  <Clock className="size-3.5" /> New ads in {fmtCountdown(nextRefreshAt - now)}
                </span>
              )}
              {/* Country picker */}
              <div className="relative">
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="appearance-none rounded-lg border border-white/10 bg-white/[0.05] py-1.5 pl-3 pr-8 text-[12.5px] font-medium text-white/80 outline-none transition-colors hover:bg-white/10 [&>option]:bg-neutral-900"
                >
                  {COUNTRIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/40" />
              </div>
              <button type="button" onClick={() => void load(country)} disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[12.5px] font-medium text-white/75 transition-colors hover:bg-white/10 disabled:opacity-40">
                <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
          </div>

          {loading && (
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="aspect-[9/16] animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="mt-16 flex flex-col items-center gap-3 text-center">
              <p className="text-[13.5px] text-white/60">{error}</p>
              <button type="button" onClick={() => void load(country)} className="rounded-lg bg-white px-4 py-2 text-[13px] font-semibold text-black">Try again</button>
            </div>
          )}

          {!loading && !error && items && items.length > 0 && (
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {items.map((ad) => <AdCard key={ad.id} ad={ad} onOpen={setOpenAd} onRecreate={recreate} />)}
            </div>
          )}
        </div>
      </div>
      {openAd && <AdVideoModal ad={openAd} onClose={() => setOpenAd(null)} onRecreate={recreate} />}
    </AppHeaderShell>
  );
}

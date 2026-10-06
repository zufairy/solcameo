/** What a callout card shows. Drawn by components/solstar/calloutScene.ts (three.js). */
export type CalloutCardData = {
  name: string;
  ticker: string;
  imageUrl?: string;
  body: string;
  /** Current market cap, already formatted (e.g. "$1.2K"). */
  cap: string;
  /** Percent move: since the call when known, else since launch. */
  changePct?: number | null;
  /** "SINCE CALL" or "SINCE LAUNCH". */
  label?: string;
  /** Total views across the agent's videos: the number the card exists to show off. */
  views?: number;
  /** Videos the agent has made (not posts). */
  videos?: number;
  /** Poster frames of the agent's top videos by views; they float around the counter. */
  thumbs?: string[];
  /** Who made the call, e.g. a shortened wallet. */
  caller?: string;
};

/** 1,200 → "1.2K", 3,400,000 → "3.4M". */
export function compact(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

/** Renders the callout to a 1600×900 PNG (the 16:9 card X shows in full). Loaded lazily: three.js stays out of the main bundle. */
export async function calloutCardBlob(d: CalloutCardData): Promise<Blob | null> {
  const { renderCalloutPng } = await import("@/components/solstar/calloutScene");
  return renderCalloutPng(d);
}

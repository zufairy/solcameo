// Top placement (not bottom): TikTok's own UI — caption, username, sound
// ticker, the right-hand action rail — runs along the BOTTOM of the frame, so
// a bottom-left mark sat right in that zone and got cropped/covered once
// posted. top-[6.5%] clears the status bar / "Following · For You" tabs
// instead of sitting flush on the edge; left-[8%] (was 5%) nudges it right of
// that same top-left corner so it reads inside the frame on every platform's
// safe area, not clipped at the edge. Keep in sync with the server burn in
// lib/server/velloWatermark.ts — same design, same numbers, top vs. bottom.
export function VelloWatermark() {
  return <div aria-label="Made by Solcameo watermark" className="pointer-events-none absolute top-[6.5%] left-[8%] z-20 flex select-none flex-col items-start gap-[3px]"
    style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.55)) drop-shadow(0 2px 10px rgba(0,0,0,.3))" }}>
    <span className="text-[6px] font-medium uppercase leading-none tracking-[0.32em] text-white/65" style={{ fontFamily: '"lab Manrope Medium", Manrope, sans-serif' }}>Made by</span>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/brand/solcameo-dark.png" alt="Solcameo" className="h-[14px] w-auto object-contain" />
  </div>;
}

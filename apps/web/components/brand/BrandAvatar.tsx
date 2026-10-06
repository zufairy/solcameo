/* eslint-disable @next/next/no-img-element -- bundled brand mark */
/**
 * Placeholder avatar built from the Solcameo star. Every seed gets one of several looks (colour, tilt, crop, flip),
 * so a chat full of people without a profile picture still looks varied and on brand instead of showing initials.
 */
const LOOKS: { bg: string; img: string }[] = [
  { bg: "bg-[radial-gradient(circle_at_30%_20%,#f4ffb0,#d7ff00)]", img: "" },
  { bg: "bg-[linear-gradient(145deg,#0f1a12,#1c2b1f)]", img: "hue-rotate-[75deg] saturate-150" },
  { bg: "bg-[linear-gradient(145deg,#6d28d9,#312e81)]", img: "hue-rotate-[190deg] saturate-150 brightness-110" },
  { bg: "bg-white", img: "-rotate-[14deg] scale-[0.92]" },
  { bg: "bg-[radial-gradient(circle_at_70%_30%,#fef9c3,#a3e635)]", img: "scale-[1.9] origin-[48%_36%]" },
  { bg: "bg-[linear-gradient(145deg,#fb7185,#be123c)]", img: "-scale-x-100 hue-rotate-[290deg] saturate-200 brightness-110" },
  { bg: "bg-[linear-gradient(145deg,#27272a,#09090b)]", img: "grayscale brightness-125 rotate-[10deg]" },
  { bg: "bg-[linear-gradient(145deg,#7dd3fc,#0369a1)]", img: "rotate-[16deg] scale-[0.88] hue-rotate-[140deg] saturate-150" },
];
export const brandLookFor = (seed: string) => LOOKS[[...seed].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % LOOKS.length];

export function BrandAvatar({ seed, className = "", look }: { seed: string; className?: string; look?: number }) {
  const l = look != null ? LOOKS[look % LOOKS.length] : brandLookFor(seed);
  return (
    <span aria-hidden="true" className={`relative grid size-full place-items-center overflow-hidden ${l.bg} ${className}`}>
      <img src="/brand/solcameo-mark.png" alt="" draggable={false} className={`size-[78%] object-contain ${l.img}`} />
    </span>
  );
}

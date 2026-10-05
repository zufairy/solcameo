"use client";

/** Hand-drawn 12x12 pixel glyphs for the platforms we post to. */
const GRIDS: Record<string, string[]> = {
  tiktok: [
    "......##....",
    "......##.##.",
    "......##..##",
    "......##...#",
    "......##....",
    ".###..##....",
    "##.##.##....",
    "##.#####....",
    "##.##.......",
    ".###........",
    "............",
    "............",
  ],
  instagram: [
    ".##########.",
    "#..........#",
    "#.......##.#",
    "#...####...#",
    "#..#....#..#",
    "#..#....#..#",
    "#..#....#..#",
    "#..#....#..#",
    "#...####...#",
    "#..........#",
    "#..........#",
    ".##########.",
  ],
  youtube: [
    "............",
    ".##########.",
    "#..........#",
    "#...#......#",
    "#...##.....#",
    "#...###....#",
    "#...####...#",
    "#...###....#",
    "#...##.....#",
    "#...#......#",
    "#..........#",
    ".##########.",
  ],
};

GRIDS.x = [
  "##........##",
  ".##......##.",
  "..##....##..",
  "...##..##...",
  "....####....",
  ".....##.....",
  ".....##.....",
  "....####....",
  "...##..##...",
  "..##....##..",
  ".##......##.",
  "##........##",
];
GRIDS.facebook = [
  "......####..",
  ".....##..##.",
  ".....##.....",
  ".....##.....",
  "...######...",
  "...######...",
  ".....##.....",
  ".....##.....",
  ".....##.....",
  ".....##.....",
  ".....##.....",
  ".....##.....",
];
GRIDS.threads = [
  "...######...",
  "..##....##..",
  ".##..##..##.",
  ".##.#..#.##.",
  ".##.#..#.##.",
  ".##..###.##.",
  ".##......##.",
  ".##.....##..",
  "..##...##...",
  "...#####....",
  "............",
  "............",
];

export function hasPixelIcon(id: string): boolean {
  return id in GRIDS;
}

/** Crisp pixel icon. `twinkle` makes a scatter of pixels pulse like a tiny LCD. */
export function PixelIcon({ id, className = "size-7", twinkle = false }: { id: string; className?: string; twinkle?: boolean }) {
  const grid = GRIDS[id];
  if (!grid) return null;
  const rects: React.ReactNode[] = [];
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== "#") return;
      const delay = ((x * 7 + y * 13) % 11) * 0.18;
      rects.push(
        <rect
          key={`${x}-${y}`}
          x={x + 0.06}
          y={y + 0.06}
          width={0.88}
          height={0.88}
          rx={0.12}
          className={twinkle && (x + y * 3) % 4 === 0 ? "vello-px-twinkle" : undefined}
          style={twinkle ? { animationDelay: `${delay}s` } : undefined}
        />,
      );
    });
  });
  return (
    <svg viewBox="0 0 12 12" className={className} fill="currentColor" shapeRendering="crispEdges" aria-hidden>
      <style>{`@keyframes vello-px-twinkle{0%,100%{opacity:1}50%{opacity:.25}}.vello-px-twinkle{animation:vello-px-twinkle 1.6s ease-in-out infinite}`}</style>
      {rects}
    </svg>
  );
}

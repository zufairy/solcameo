/** Keep at most `max` points, evenly spread, always including the first and last. */
export function downsample<T>(items: T[], max: number): T[] {
  if (max < 2 || items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  return out;
}

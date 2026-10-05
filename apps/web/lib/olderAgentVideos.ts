const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/** Public agent gallery excludes the latest 72 hours of output. */
export function olderAgentVideos<T extends { createdAt: number }>(videos: readonly T[], now: number): T[] {
  const cutoff = now - THREE_DAYS_MS;
  return videos.filter((video) => Number.isFinite(video.createdAt) && video.createdAt < cutoff);
}

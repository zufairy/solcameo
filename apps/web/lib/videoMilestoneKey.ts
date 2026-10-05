/** Keep the video identity while dropping tracking parameters and host aliases. */
export function videoMilestoneIdentity(video: { key: string; postUrl?: string; platform?: string; platformPostId?: string }): string {
  if (video.postUrl) {
    try {
      const url = new URL(video.postUrl);
      const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "").replace(/^twitter\.com$/, "x.com");
      if (host === "youtube.com" || host === "youtu.be") {
        const id = host === "youtu.be" ? url.pathname.split("/")[1] : url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
        if (id) return `youtube:${id}`;
      }
      if (host === "x.com") {
        const id = url.pathname.match(/\/status\/(\d+)/)?.[1];
        if (id) return `x:${id}`;
      }
      if (host === "tiktok.com") {
        const id = url.pathname.match(/\/video\/(\d+)/)?.[1];
        if (id) return `tiktok:${id}`;
      }
      if (host === "instagram.com") {
        const id = url.pathname.match(/^\/(?:p|reel|reels)\/([^/]+)/)?.[1];
        if (id) return `instagram:${id}`;
      }
      const nativeId = url.searchParams.get("v") || url.searchParams.get("story_fbid");
      return `${host}${url.pathname.replace(/\/$/, "")}${nativeId ? `:${nativeId}` : ""}`;
    } catch { /* Fall back to the trusted native or row identity. */ }
  }
  if (video.platform && video.platformPostId) return `${video.platform === "twitter" ? "x" : video.platform}:${video.platformPostId}`;
  return video.key;
}

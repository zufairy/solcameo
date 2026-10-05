/** Public profile links from the account actually connected through Upload-Post.
 * Upload-Post's `username` is a stable platform ID, not necessarily a public @handle. */
export type ConnectedSocialIdentity = { id?: string; handle?: string; displayName?: string };

export function socialProfileUrl(platform: string, account: ConnectedSocialIdentity): string | null {
  const id = account.id?.trim() ?? "";
  const handle = account.handle?.trim().replace(/^@/, "") ?? "";
  const segment = (value: string) => encodeURIComponent(value);

  // These platforms expose durable IDs that resolve directly even after a rename.
  if (platform === "youtube" && /^UC[A-Za-z0-9_-]{20,}$/.test(id)) return `https://www.youtube.com/channel/${segment(id)}`;
  if (platform === "facebook" && /^\d+$/.test(id)) return `https://www.facebook.com/${segment(id)}`;
  if (platform === "discord" && /^\d+$/.test(id)) return `https://discord.com/users/${segment(id)}`;

  // TikTok's Upload-Post ID is an app-scoped open_id; Instagram's is a numeric
  // API ID. Neither belongs in a public profile URL. Use THEIR connected handle.
  if (!handle) return null;
  const templates: Record<string, string> = {
    tiktok: "https://www.tiktok.com/@{value}",
    instagram: "https://www.instagram.com/{value}/",
    youtube: "https://www.youtube.com/@{value}",
    facebook: "https://www.facebook.com/{value}",
    linkedin: "https://www.linkedin.com/in/{value}",
    x: "https://x.com/{value}",
    threads: "https://www.threads.net/@{value}",
    bluesky: "https://bsky.app/profile/{value}",
    reddit: "https://www.reddit.com/user/{value}",
    pinterest: "https://www.pinterest.com/{value}",
    telegram: "https://t.me/{value}",
  };
  return templates[platform]?.replace("{value}", segment(handle)) ?? null;
}

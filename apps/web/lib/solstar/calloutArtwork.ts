/** Remote theme photographs stay on their source CDNs; no server image fetch is needed.
 * Sources: Unsplash photo collections and the Pexels Lamborghini photo.
 */
const unsplash = (photo: string) => `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=1200&q=75`;
export const CALLOUT_ARTWORK: Record<string, { image: string; source: string }> = {
  colosseum: { image: unsplash("photo-1552832230-c0197dd311b5"), source: "https://unsplash.com/s/photos/italy" },
  solana: { image: unsplash("photo-1696362398472-739591920666"), source: "https://unsplash.com/photos/3KNt8DEvbP0" },
  lambo: { image: "https://images.pexels.com/photos/14843592/pexels-photo-14843592.jpeg?auto=compress&cs=tinysrgb&w=1200", source: "https://www.pexels.com/photo/photo-of-yellow-lamborghini-on-road-14843592/" },
  bullrun: { image: unsplash("photo-1581002758623-095845779b3c"), source: "https://unsplash.com/photos/j9K9bIgQ_RU" },
  neon: { image: unsplash("photo-1498036882173-b41c28a8ba34"), source: "https://unsplash.com/s/photos/neon-city" },
  ferrari: { image: unsplash("photo-1614200179396-2bdb77ebf81b"), source: "https://unsplash.com/photos/Wl6OeSGyOf4" },
  vault: { image: unsplash("photo-1762463176312-1757d5125c85"), source: "https://unsplash.com/s/photos/gold-store" },
  aurora: { image: unsplash("photo-1715763306006-9777a0873742"), source: "https://unsplash.com/photos/D5pJWYajWpI" },
};
export function calloutArtwork(theme?: string) {
  return CALLOUT_ARTWORK[theme ?? "colosseum"] ?? CALLOUT_ARTWORK.colosseum;
}

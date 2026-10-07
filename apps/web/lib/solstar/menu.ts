import {
  Activity,
  BarChart3,
  FolderOpen,
  Home,
  Video,
  LayoutGrid,
  TrendingUp,
  Trophy,
  Compass,
  Clapperboard,
  Share2,
  type LucideIcon,
} from "lucide-react";

export type MenuItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  group: "Launchpad" | "Workspace";
  /** Only shown to signed-in users. */
  authOnly?: boolean;
  match: (pathname: string) => boolean;
};
const item = (
  label: string,
  href: string,
  icon: LucideIcon,
  group: MenuItem["group"],
  authOnly = false,
): MenuItem => ({
  label,
  href,
  icon,
  group,
  ...(authOnly ? { authOnly } : {}),
  match: (pathname) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/"),
});
const ITEMS: MenuItem[] = [
  item("Home", "/", Home, "Launchpad"),
  item("Create Videos", "/create-videos", Clapperboard, "Launchpad", true),
  item("My Influencers", "/control", FolderOpen, "Launchpad", true),
  item("Video Feed", "/make", Video, "Launchpad"),
  item("Market", "/market", TrendingUp, "Launchpad"),
  item("Agent Marketplace", "/agents", LayoutGrid, "Launchpad"),
  item("Explore", "/explore", Compass, "Workspace"),
  item("Leaderboards", "/tournament", Trophy, "Workspace"),
  item("Tokenomics", "/tokenomics", Activity, "Workspace"),
  item("Referrals", "/referrals", Share2, "Workspace"),
  item("Analytics", "/analytics", BarChart3, "Workspace"),
];
/**
 * Influencer-focused navigation, independent of the old landing-page flag. "My Influencers" and "Create Videos" belong
 * to an account, so they only appear once the user is signed in.
 */
export function getMenuItems(legacy: boolean, signedIn = true): MenuItem[] {
  void legacy;
  return ITEMS.filter((i) => signedIn || !i.authOnly);
}

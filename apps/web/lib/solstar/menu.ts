import {
  BarChart3,
  FolderOpen,
  Home,
  Video,
  LayoutGrid,
  TrendingUp,
  Trophy,
  Coins,
  Compass,
  type LucideIcon,
} from "lucide-react";

export type MenuItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  group: "Launchpad" | "Workspace";
  match: (pathname: string) => boolean;
};
const item = (
  label: string,
  href: string,
  icon: LucideIcon,
  group: MenuItem["group"],
): MenuItem => ({
  label,
  href,
  icon,
  group,
  match: (pathname) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/"),
});
const ITEMS: MenuItem[] = [
  item("Home", "/", Home, "Launchpad"),
  item("My Agents", "/control", FolderOpen, "Launchpad"),
  item("Video Feed", "/make", Video, "Launchpad"),
  item("Market", "/market", TrendingUp, "Launchpad"),
  item("Agent Marketplace", "/agents", LayoutGrid, "Launchpad"),
  item("Explore", "/explore", Compass, "Workspace"),
  item("Leaderboards", "/tournament", Trophy, "Workspace"),
  item("Analytics", "/analytics", BarChart3, "Workspace"),
  item("Earnings", "/earnings", Coins, "Workspace"),
];
/** Influencer-focused navigation, independent of the old landing-page flag. */
export function getMenuItems(legacy: boolean): MenuItem[] {
  void legacy;
  return [...ITEMS];
}

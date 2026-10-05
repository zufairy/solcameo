import type { Metadata } from "next";
import { ProfilePage } from "@/components/profile/profile-page";

export const metadata: Metadata = {
  title: "Profile — Vello",
  description: "Your Vello account, wallets, agents, and subscription.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <ProfilePage />;
}

import type { Metadata } from "next";

// Private surface — logged-in operators only. Keep it out of Google.
export const metadata: Metadata = {
  title: "Creator Studio: Manage Your AI Influencers",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

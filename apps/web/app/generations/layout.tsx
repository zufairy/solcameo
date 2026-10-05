import type { Metadata } from "next";

// This account-specific library has no public search result to offer.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function GenerationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}

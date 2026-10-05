import type { Metadata } from "next";

// Signed-in app surface / internal page — keep it out of search results so it
// never competes with the marketing pages for brand queries.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";

// Private surface — logged-in operators only. Keep it out of Google.
export const metadata: Metadata = {
  title: "Wallet: Balance, Earnings & Payouts",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

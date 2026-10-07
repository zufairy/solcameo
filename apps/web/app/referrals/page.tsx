import type { Metadata } from "next";
import { ReferralsPage } from "@/components/referrals/ReferralsPage";

export const metadata: Metadata = {
  title: "Referrals",
  description: "Earn USDC every time someone you refer makes a video. Link your wallet, hold a little SOLCAMEO, share your link, and get a share of Solcameo's margin on every on-chain payment.",
  alternates: { canonical: "/referrals" },
};

export default function Page() {
  return <ReferralsPage />;
}

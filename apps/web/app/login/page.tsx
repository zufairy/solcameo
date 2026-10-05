import type { Metadata } from "next";
import { LoginPage } from "@/components/auth/login-page";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in or create a Vello Agents account.",
  robots: { index: false, follow: true },
};

export default function Page() {
  return <LoginPage />;
}

"use client";
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** A friend's referral link: remember the code (it is attached when this visitor signs in) and send them to make their first video. */
export default function ReferralLanding() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  useEffect(() => {
    const clean = String(code ?? "").toUpperCase();
    try { if (/^[A-Z0-9]{4,16}$/.test(clean)) window.localStorage.setItem("solcameo:ref", clean); } catch { /* storage blocked */ }
    router.replace("/create-videos");
  }, [code, router]);
  return <p className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-zinc-400"><Loader2 className="size-4 animate-spin" /> Opening Solcameo…</p>;
}

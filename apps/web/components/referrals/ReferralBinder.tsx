"use client";
import { useEffect } from "react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { getCurrentSiwsToken } from "@/lib/client/siwsIdentity";

const KEY = "solcameo:ref";

/**
 * Attaches a saved referral code to the signed-in wallet. It waits until the visitor has proven their wallet, tries a few times,
 * and clears the code once it is attached or can never be (unknown code, own code, already referred).
 */
export function ReferralBinder() {
  const { authenticated } = useSupabaseAuth();
  useEffect(() => {
    if (!authenticated) return;
    let stopped = false, tries = 0;
    const attempt = async () => {
      let code: string | null = null;
      try { code = window.localStorage.getItem(KEY); } catch { return true; }
      if (!code) return true;
      if (!getCurrentSiwsToken()) return false;
      try {
        const res = await fetch("/api/referrals/bind", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
        const data = await res.json().catch(() => ({}));
        if (res.ok || [422, 400].includes(res.status)) { try { window.localStorage.removeItem(KEY); } catch { /* ignore */ } return true; }
        void data;
      } catch { /* try again */ }
      return false;
    };
    const run = async () => { if (stopped) return; tries += 1; if (await attempt() || tries >= 30) return; timer = setTimeout(run, 4000); };
    let timer = setTimeout(run, 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [authenticated]);
  return null;
}

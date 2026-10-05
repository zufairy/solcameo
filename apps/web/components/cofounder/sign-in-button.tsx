"use client";

import type { ReactNode } from "react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

/* Client trigger that opens Privy's native login modal (Google + Solana wallet).
   Used by the otherwise-static landing chrome so "Sign In" pops the modal in
   place instead of navigating to a separate page. */
export function SignInButton({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { promptLogin } = useSupabaseAuth();
  return (
    <button type="button" onClick={() => promptLogin()} className={className}>
      {children}
    </button>
  );
}

"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

/**
 * Global sign-in modal — popped automatically when an authed API call returns 401
 * (session expired / signed out), so the user can re-auth and continue without
 * losing the page. Rendered once by SupabaseAuthProvider.
 */
export function LoginModal({
  open,
  onClose,
  onSignIn,
}: {
  open: boolean;
  onClose: () => void;
  onSignIn: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onSignIn(); // OAuth → full-page redirect; returns here signed in
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign-in failed");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-[#0e0f13] p-6 text-center shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>
        <h2 className="text-[18px] font-bold text-white">Sign in to continue</h2>
        <p className="mx-auto mt-1.5 max-w-[18rem] text-[13px] leading-relaxed text-white/55">
          Your session expired or you&apos;re signed out. Sign in to pick up right where you left off — nothing is lost.
        </p>
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-[14px] font-bold text-zinc-900 transition-all hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <GoogleGlyph className="size-4" />}
          Continue with Google
        </button>
        {err && <p className="mt-3 text-[12px] text-rose-400">{err}</p>}
      </div>
    </div>
  );
}

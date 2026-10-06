"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { useFullSignOut } from "@/providers/wallet-provider";
import flashAvatar from "@/assets/flash.jpeg";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

export function AccountButton({
  fullWidth = false,
  signInLabel = "Sign In",
  light = false,
}: { fullWidth?: boolean; signInLabel?: string; light?: boolean } = {}) {
  const { profile, signInWithGoogle } = useSupabaseAuth();
  const { user, authenticated, ready } = usePrivy();
  const handleSignOut = useFullSignOut();
  const router = useRouter();

  // This container represents the GOOGLE account. A wallet-only login (no Google
  // identity) has no account to show here — the wallet itself lives in WalletButton.
  // Detect Google/email identity from Privy's linked accounts and hide the whole
  // container otherwise, so a wallet-only user sees ONE wallet (no second, stale
  // linked address from a previous Google session).
  const hasGoogleIdentity = useMemo(() => {
    const accts = (user?.linkedAccounts ?? []) as Array<{ type?: string }>;
    return accts.some((a) => a.type === "google_oauth" || a.type === "email");
  }, [user]);

  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  // A signed-in Google user's profile resolves a beat after Privy reports the
  // session (the whoami round-trip). Show the brief spinner ONLY during that
  // window, and bound it: if the session is stale/half-broken and never yields a
  // profile, stop waiting after a grace period and fall back to the Sign-in
  // button — so the header is NEVER stuck spinning forever (mirrors WalletButton's
  // "Preparing wallet…" grace fallback). Hook stays above every conditional return.
  const [graceExpired, setGraceExpired] = useState(false);
  const resolvingProfile = ready && authenticated && hasGoogleIdentity && !profile;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!resolvingProfile) { setGraceExpired(false); return; }
    const id = setTimeout(() => setGraceExpired(true), 5000);
    return () => clearTimeout(id);
  }, [resolvingProfile]);

  function handleSignIn() {
    setError(null);
    setSigningIn(true);
    try {
      // Opens the Privy modal (Google + Solana wallet). Non-blocking — the button
      // is replaced by the account view once `profile` resolves post-login.
      signInWithGoogle();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Sign-in failed: ${msg}`);
    } finally {
      setSigningIn(false);
    }
  }

  // Wallet-only session (connected a wallet, never signed in with Google) → no
  // account container. WalletButton already shows the connected wallet + sign-out.
  if (authenticated && !hasGoogleIdentity) {
    return null;
  }

  // Only spin while actively resolving a signed-in Google profile, and only until
  // the grace period expires. Privy failing/slow to init (ready=false) does NOT
  // hold the header hostage on a spinner anymore — we fall straight through to the
  // Sign-in button, exactly like "Connect Wallet" stays clickable.
  if (resolvingProfile && !graceExpired) {
    return (
      <div className={`flex items-center gap-2 h-9 px-3 rounded-xl border text-[13px] ${light ? "border-black/10 bg-white text-neutral-500" : "border-white/[0.18] bg-white/[0.07] text-white/60 backdrop-blur-2xl"}`}>
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="relative">
        <button
          onClick={handleSignIn}
          disabled={signingIn}
          // Sleek + boxy — square corners (rounded-sm, not -xl) and the same
          // h-[31px] as the Arena button beside it, instead of the taller h-9 pill.
          // fullWidth (sidebar placements) stretches it, softens the corners, and
          // swaps the solid-white fill for the app's frosted-glass treatment
          // (translucent + backdrop-blur + hairline border) instead of the flat
          // compact topbar pill used everywhere else.
          className={
            fullWidth
              ? "flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] text-white backdrop-blur-xl hover:bg-white/[0.1] text-[13px] font-semibold transition-colors disabled:opacity-70"
              : `flex h-9 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-semibold backdrop-blur-2xl transition-all duration-200 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-500/60 ${light ? "border-black/10 bg-neutral-900 text-white hover:bg-neutral-800" : "border-white/[0.18] bg-[linear-gradient(145deg,rgba(255,255,255,0.15),rgba(255,255,255,0.055)_55%,rgba(132,204,22,0.08))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_6px_18px_rgba(0,0,0,0.28)] hover:border-lime-300/30 hover:bg-white/[0.14] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_8px_22px_rgba(0,0,0,0.32)]"}`
          }
        >
          {signingIn ? <Loader2 className="size-4 animate-spin" /> : <GoogleGlyph />} {signInLabel}
        </button>
        {error && (
          <p className="absolute right-0 mt-1 w-60 text-[11px] text-amber-400 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 z-50">
            {error}
          </p>
        )}
      </div>
    );
  }

  const name = profile.name ?? profile.email ?? "Account";
  // Logged-in profile avatar — use the bundled Flash image for every signed-in user.
  const avatarSrc = flashAvatar.src;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          fullWidth ? (
            <button className="flex w-full items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900 p-2 hover:border-zinc-700 transition-colors cursor-pointer">
              <span className="size-8 rounded-full bg-emerald-600 overflow-hidden shrink-0 flex items-center justify-center text-[12px] font-bold text-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
              </span>
              <span className="min-w-0 flex-1 text-left text-[13px] font-semibold text-white truncate">{name}</span>
              <ChevronDown className="size-3.5 shrink-0 text-zinc-500" />
            </button>
          ) : (
            <button className={`flex h-9 max-w-[min(48vw,180px)] items-center gap-2 rounded-xl border pl-1.5 pr-2.5 backdrop-blur-2xl transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-500/60 ${light ? "border-black/10 bg-white/80 hover:bg-white" : "border-white/[0.18] bg-[linear-gradient(145deg,rgba(255,255,255,0.15),rgba(255,255,255,0.045)_60%,rgba(132,204,22,0.07))] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_6px_18px_rgba(0,0,0,0.28)] hover:border-lime-300/30 hover:bg-white/[0.14]"}`}>
              <span className="size-6 rounded-full bg-emerald-600 overflow-hidden shrink-0 flex items-center justify-center text-[11px] font-bold text-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
              </span>
              <span className={`text-[13px] font-medium max-w-[120px] truncate ${light ? "text-neutral-900" : "text-white"}`}>{name}</span>
              <ChevronDown className={`size-3.5 shrink-0 ${light ? "text-neutral-500" : "text-zinc-500"}`} />
            </button>
          )
        }
      />
      <DropdownMenuContent
        align={fullWidth ? "start" : "end"}
        className="w-60 max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/15 bg-[#17191d]/95 text-white shadow-2xl ring-0 backdrop-blur-2xl"
        style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" }}
      >
        <div className="px-2 py-1.5">
          <p className="text-[13px] font-semibold text-white truncate">{profile.name ?? "Signed in"}</p>
          {profile.email && <p className="text-[11px] text-white/45 truncate">{profile.email}</p>}
        </div>

        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem onClick={() => router.push("/home")}>
          Home
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          My Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/control")}>
          My Influencers
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/generations")}>
          Generations
        </DropdownMenuItem>

        {profile.isAdmin && (
          <DropdownMenuItem onClick={() => router.push("/admin")}>
            Admin panel
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem className="text-red-400 focus:text-red-400" onClick={() => handleSignOut()}>
          Sign out
        </DropdownMenuItem>
        {error && <p className="px-2 py-1 text-[10.5px] text-amber-400">{error}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

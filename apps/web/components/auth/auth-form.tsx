"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

/** The login/signup form itself — Google + email/password with the login
 *  page's exact styling and blur-in animations. Shared by the full /login
 *  page and the landing page's LoginModal so the two can never drift. */

export function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

export type AuthMode = "signup" | "signin";

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const authContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
export const authItem = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: EASE_OUT } },
};

export function AuthForm({ onSuccess, initialMode = "signup" }: { onSuccess: (mode: AuthMode) => void; initialMode?: AuthMode }) {
  const { login, signUpWithPassword, signInWithPassword } = useSupabaseAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const heading = mode === "signup" ? "Create an account" : "Welcome back";

  function handleGoogle() {
    setError(null);
    setBusy("google");
    try {
      login(); // Privy modal → Google OAuth redirect; returns signed in.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("email");
    try {
      if (mode === "signup") {
        await signUpWithPassword(email, password);
      } else {
        await signInWithPassword(email, password);
      }
      onSuccess(mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div variants={authContainer} initial="hidden" animate="show" className="w-full">
      <AnimatePresence mode="wait">
        <motion.h1
          key={heading}
          initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
          transition={{ duration: 0.32, ease: EASE_OUT }}
          className="text-center text-[22px] font-semibold text-white lg:text-left"
        >
          {heading}
        </motion.h1>
      </AnimatePresence>

      <motion.button
        variants={authItem}
        type="button"
        onClick={handleGoogle}
        disabled={busy !== null}
        className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-lg border border-white/15 bg-white/[0.04] py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-white/[0.08] disabled:opacity-60"
      >
        {busy === "google" ? <Loader2 className="size-4 animate-spin" /> : <GoogleGlyph />}
        Continue with Google
      </motion.button>

      <motion.div variants={authItem} className="my-5 flex items-center gap-3 text-[12px] text-white/35">
        <div className="h-px flex-1 bg-white/10" />
        or
        <div className="h-px flex-1 bg-white/10" />
      </motion.div>

      <motion.form variants={authItem} onSubmit={handleSubmit} className="space-y-3.5">
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="w-full rounded-lg border border-white/15 bg-white/[0.03] px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/35 outline-none transition-colors focus:border-lime-400/50"
        />

        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "Create a password" : "Password"}
            className="w-full rounded-lg border border-white/15 bg-white/[0.03] px-3.5 py-2.5 pr-10 text-[14px] text-white placeholder:text-white/35 outline-none transition-colors focus:border-lime-400/50"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>

        {error && <p className="text-[12.5px] text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy !== null}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-lime-400 py-2.5 text-[14px] font-semibold text-zinc-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
        >
          {busy === "email" ? <Loader2 className="size-4 animate-spin" /> : null}
          Continue
        </button>
      </motion.form>

      <motion.div variants={authItem} className="mt-6 overflow-hidden text-center text-[13px] text-white/45">
        <AnimatePresence mode="wait">
          <motion.p
            key={mode}
            initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            {mode === "signup" ? "Already have an account? " : "Don't have an account? "}
            <button
              type="button"
              onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); }}
              className="font-semibold text-white hover:underline"
            >
              {mode === "signup" ? "Sign in" : "Sign up"}
            </button>
          </motion.p>
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

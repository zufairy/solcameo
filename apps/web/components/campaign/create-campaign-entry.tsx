"use client";

import { useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, LockKeyhole } from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { EASE, PaperScreen } from "./wizard-ui";

const CampaignForm = dynamic(
  () => import("@/components/campaign/campaign-form").then((mod) => mod.CampaignForm),
  {
    loading: () => (
      <PaperScreen>
        <div role="status" className="flex items-center gap-3 text-[15px] text-[#141413]/60"><Loader2 className="size-5 animate-spin" /> Preparing your campaign…</div>
      </PaperScreen>
    ),
  },
);

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function CreateCampaignEntry() {
  const router = useRouter();
  const { authenticated, loading, promptLogin } = useSupabaseAuth();
  // The server has no browser wallet/session. Keep the hydration render
  // identical to SSR, then resolve auth before mounting the form.
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  if (!mounted || loading) {
    return (
      <PaperScreen onClose={() => router.push("/stage")}>
        <div role="status" className="flex items-center gap-3 text-[15px] text-[#141413]/60"><Loader2 className="size-5 animate-spin" /> Checking your account…</div>
      </PaperScreen>
    );
  }

  if (authenticated) return <CampaignForm />;

  return (
    <PaperScreen onClose={() => router.push("/stage")}>
      <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="w-full text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-[#141413] text-[#A3E635]"><LockKeyhole className="size-6" strokeWidth={1.75} /></div>
        <h1 className="mt-6 text-balance text-[34px] font-semibold leading-tight tracking-[-0.035em]">Sign in to create a campaign</h1>
        <p className="mx-auto mt-3 max-w-sm text-[16px] leading-relaxed text-[#141413]/60">Build your brief, set the reward and review everything before funding. Your campaign starts with your account.</p>
        <button type="button" onClick={promptLogin} className="group mt-8 inline-flex h-14 items-center gap-2.5 rounded-2xl bg-[#141413] pl-7 pr-5 text-[15px] font-semibold text-white transition-colors hover:bg-black">
          Sign in to continue <ArrowRight className="size-4 text-[#A3E635] transition-transform group-hover:translate-x-0.5" />
        </button>
        <p className="mt-5 text-[13px] text-[#141413]/45">No campaign is created or funded until you confirm it.</p>
      </motion.section>
    </PaperScreen>
  );
}

"use client";

import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VIDEO_ENGINES, clipsForLength, videoCreditsForLength, VIDEO_STORYBOARD_COST_USDC } from "@/lib/builder/agentTypes";
import { creditsPerMinute, estimateClipRunCredits, perClipCredits } from "@/lib/economy/clipCreditPricing";
import { CLIP_SKILL_PRICE_USDC } from "@/lib/economy/servicePrices";

export function CreditUsageGuide() {
  const hourCost = estimateClipRunCredits(3600);
  return (
    <Dialog>
      <DialogTrigger className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white" aria-label="How credits work">
        <CircleHelp className="size-3.5" /><span className="hidden md:inline">How credits work</span>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto border border-white/15 bg-zinc-950 p-6 text-zinc-200 sm:max-w-2xl">
        <DialogTitle className="text-xl font-semibold text-white">How credits work</DialogTitle>
        <DialogDescription className="text-sm text-zinc-400">The balance in the builder is usage credits. These are separate from an on-chain token. At the standard rate, 1 credit covers $0.01 of usage.</DialogDescription>
        <section className="space-y-3">
          <h3 className="font-semibold text-white">Clipping an existing video</h3>
          <p className="text-sm">The standard base rate is {creditsPerMinute()} credits per minute of source video processed, rounded up. It depends on the source length, not the number or length of finished clips.</p>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {[10, 30, 60].map(minutes => <div key={minutes} className="rounded-lg bg-white/5 p-3"><p className="text-zinc-400">{minutes} min source</p><p className="mt-1 font-semibold text-white">{estimateClipRunCredits(minutes * 60)} credits</p></div>)}
          </div>
          <p className="text-sm text-zinc-400">Example: a 1-hour source costs {hourCost} base credits. If it produces 10 clips, that averages {perClipCredits(hourCost, 10)} credits per clip. Producing fewer clips does not reduce the source-processing charge. A 10-minute, 1-second source rounds up to 11 minutes.</p>
          <details className="rounded-lg border border-white/10 p-3 text-sm"><summary className="cursor-pointer font-medium text-white">Optional editing skills add to the base cost</summary><p className="my-2 text-zinc-400">Installing a skill is free. Running a paid skill adds a charge. Standard run-start prices include:</p><ul className="space-y-1">{[["clip.captions", "Captions"], ["clip.facetrack", "Face tracking"], ["clip.hook", "Hook writing"], ["clip.filters", "Filters"]].map(([id, label]) => <li key={id} className="flex justify-between gap-3"><span>{label}</span><span>{Math.round(CLIP_SKILL_PRICE_USDC[id] * 100)} credits / run</span></li>)}</ul><p className="mt-2 text-zinc-400">Additional editing operations can incur skill charges. These examples exclude add-ons.</p></details>
        </section>
        <section className="space-y-3 border-t border-white/10 pt-4">
          <h3 className="font-semibold text-white">Generating a new AI video</h3>
          <p className="text-sm">Generation is charged by model and requested duration. Duration rounds up to whole model segments, plus {Math.round(VIDEO_STORYBOARD_COST_USDC * 100)} storyboard credits per generation. This is different from clipping existing footage.</p>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="pb-2 text-left text-xs text-zinc-400">Standard generation estimates, including storyboard</caption><thead className="text-zinc-400"><tr><th className="py-2">Model</th><th className="px-2">Segment</th><th className="px-2">10s video</th><th className="px-2">30s video</th></tr></thead><tbody>{VIDEO_ENGINES.map(engine => <tr key={engine.id} className="border-t border-white/10"><td className="py-2 pr-2">{engine.label}</td><td className="px-2">{engine.maxClipSeconds}s</td><td className="px-2 tabular-nums">{videoCreditsForLength(engine, 10)}</td><td className="px-2 tabular-nums">{videoCreditsForLength(engine, 30)}</td></tr>)}</tbody></table></div>
          <p className="text-sm text-zinc-400">For example, a 30s Veo Fast video needs {clipsForLength(VIDEO_ENGINES.find(e => e.id === "veo3-fast")!, 30)} separate 8s segments, plus its storyboard. It costs {videoCreditsForLength(VIDEO_ENGINES.find(e => e.id === "veo3-fast")!, 30)} credits, rather than one segment&apos;s price.</p>
        </section>
        <section className="space-y-2 border-t border-white/10 pt-4 text-sm">
          <h3 className="font-semibold text-white">Why your balance can drop quickly</h3>
          <ul className="list-disc space-y-1 pl-5 text-zinc-400"><li>Long sources consume more clipping credits, even if you request only a few clips.</li><li>Premium models and longer generated videos cost more.</li><li>New generations and successful rerolls are separate paid work.</li><li>Enabled automation can run work while you are away. Review its schedule and pause it when needed.</li><li>Generation reserves credits while work is pending. A lower available balance can include a pending reservation. Failed tasks release their reserved credits; check billing history for the refund.</li></ul>
          <p className="text-xs text-zinc-500">These are standard rates from the pricing configuration. Admin price overrides, additional services, and the specific workflow can change the total. Check the estimate before starting and your billing history for actual debits and refunds.</p>
          <Link href="/billing/history" className="inline-block pt-2 font-medium text-lime-300 underline underline-offset-4">View my usage and billing history</Link>
        </section>
      </DialogContent>
    </Dialog>
  );
}

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

type Tone = "error" | "warn" | "info" | "success";

const TONES: Record<Tone, { icon: typeof Info; tile: string; ring: string; bar: string; title: string }> = {
  error: { icon: XCircle, tile: "bg-rose-400/15 text-rose-300", ring: "border-rose-400/20 bg-gradient-to-r from-rose-500/[0.09] to-transparent", bar: "bg-rose-400", title: "text-rose-200" },
  warn: { icon: AlertTriangle, tile: "bg-amber-400/15 text-amber-300", ring: "border-amber-400/20 bg-gradient-to-r from-amber-500/[0.08] to-transparent", bar: "bg-amber-400", title: "text-amber-200" },
  info: { icon: Info, tile: "bg-[#d7ff00]/12 text-[#d7ff00]", ring: "border-[#d7ff00]/15 bg-gradient-to-r from-[#d7ff00]/[0.07] to-transparent", bar: "bg-[#d7ff00]", title: "text-white" },
  success: { icon: CheckCircle2, tile: "bg-emerald-400/15 text-emerald-300", ring: "border-emerald-400/20 bg-gradient-to-r from-emerald-500/[0.08] to-transparent", bar: "bg-emerald-400", title: "text-emerald-200" },
};

/** Sleek inline notice: a left accent bar and an icon tile centered against the text, whatever its height. */
export function Notice({ tone = "info", title, children, role }: { tone?: Tone; title?: string; children: ReactNode; role?: "alert" | "status" }) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div role={role ?? (tone === "error" ? "alert" : undefined)} className={`relative flex items-center gap-3.5 overflow-hidden rounded-xl border py-3 pl-4 pr-4 ${t.ring}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${t.bar}`} />
      <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-lg ${t.tile}`}><Icon className="size-[18px]" /></span>
      <div className="min-w-0 flex-1 text-[13px] leading-5 text-zinc-300">
        {title && <p className={`mb-0.5 text-[13px] font-semibold ${t.title}`}>{title}</p>}
        {children}
      </div>
    </div>
  );
}

import { Zap, CreditCard, Repeat, Wallet, RotateCcw, Settings, Gift, Receipt, type LucideIcon } from "lucide-react";

export const nf = (n: number) => n.toLocaleString("en-US");
export const fmt$ = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export const LEDGER_KIND: Record<string, { icon: LucideIcon; label: string; tone: "up" | "down" | "neutral" }> = {
  purchase: { icon: CreditCard, label: "Purchase", tone: "up" },
  subscription_grant: { icon: Repeat, label: "Subscription grant", tone: "up" },
  crypto_deposit: { icon: Wallet, label: "Crypto deposit", tone: "up" },
  spend: { icon: Zap, label: "Spend", tone: "down" },
  refund: { icon: RotateCcw, label: "Refund", tone: "up" },
  admin_adjustment: { icon: Settings, label: "Adjustment", tone: "neutral" },
  signup_grant: { icon: Gift, label: "Signup bonus", tone: "up" },
};

export const LEDGER_ICON_FALLBACK: LucideIcon = Receipt;

import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, Wallet, Zap } from "lucide-react";

interface PortfolioSummaryProps {
  totalInvested: number;
  currentValue: number;
  totalEarned: number;
  pendingWithdrawal: number;
}

export function PortfolioSummary({
  totalInvested,
  currentValue,
  totalEarned,
  pendingWithdrawal,
}: PortfolioSummaryProps) {
  const pnl = currentValue - totalInvested;
  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        {
          label: "Portfolio value",
          value: `$${currentValue.toLocaleString()}`,
          sub: `${pnl >= 0 ? "+" : ""}$${pnl.toLocaleString()} (${pnlPct.toFixed(1)}%)`,
          subColor: pnl >= 0 ? "text-emerald-400" : "text-red-400",
          icon: Wallet,
        },
        {
          label: "Total earned",
          value: `$${totalEarned.toLocaleString()} USDC`,
          sub: "All time yield",
          subColor: "text-muted-foreground",
          icon: TrendingUp,
        },
        {
          label: "Total invested",
          value: `$${totalInvested.toLocaleString()} USDC`,
          sub: "Cost basis",
          subColor: "text-muted-foreground",
          icon: Zap,
        },
        {
          label: "Ready to withdraw",
          value: `$${pendingWithdrawal.toLocaleString()} USDC`,
          sub: "Claimable now",
          subColor: "text-muted-foreground",
          icon: Wallet,
        },
      ].map(({ label, value, sub, subColor, icon: Icon }) => (
        <Card key={label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Icon className="size-3.5" />
              {label}
            </div>
            <p className="font-mono font-bold text-lg">{value}</p>
            <p className={`text-xs mt-0.5 ${subColor}`}>{sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

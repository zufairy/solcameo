import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowDownLeft, ArrowUpRight, Zap } from "lucide-react";

const MOCK_ACTIVITY = [
  {
    id: "a1",
    type: "yield" as const,
    description: "Yield from Aisha Rahman",
    amount: 42.5,
    date: "2026-05-25",
  },
  {
    id: "a2",
    type: "deposit" as const,
    description: "Invested in Marcus Chen",
    amount: -1300,
    date: "2026-05-20",
  },
  {
    id: "a3",
    type: "yield" as const,
    description: "Yield from Marcus Chen",
    amount: 98.2,
    date: "2026-05-18",
  },
  {
    id: "a4",
    type: "deposit" as const,
    description: "Invested in Aisha Rahman",
    amount: -1900,
    date: "2026-05-01",
  },
];

const TYPE_CONFIG = {
  yield: { icon: ArrowDownLeft, color: "text-emerald-400", label: "Yield" },
  deposit: { icon: ArrowUpRight, color: "text-blue-400", label: "Invested" },
  withdrawal: { icon: Zap, color: "text-yellow-400", label: "Withdrawal" },
};

export function ActivityFeed() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        {MOCK_ACTIVITY.map(({ id, type, description, amount, date }) => {
          const { icon: Icon, color, label } = TYPE_CONFIG[type];
          return (
            <div
              key={id}
              className="flex items-center gap-3 py-3 border-b border-border last:border-0"
            >
              <div className={`rounded-full bg-secondary p-2 ${color}`}>
                <Icon className="size-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{description}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(date).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={`font-mono text-sm font-semibold ${
                    amount > 0 ? "text-emerald-400" : "text-foreground"
                  }`}
                >
                  {amount > 0 ? "+" : ""}${Math.abs(amount).toLocaleString()}{" "}
                  USDC
                </p>
                <Badge variant="secondary" className="text-xs">
                  {label}
                </Badge>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const MOCK_EARNINGS_MONTHS = [
  { month: "May 2026", earned: 284, status: "claimable" as const },
  { month: "Apr 2026", earned: 201, status: "claimed" as const },
  { month: "Mar 2026", earned: 143, status: "claimed" as const },
];

export function EarningsBreakdown() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Earnings Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        {MOCK_EARNINGS_MONTHS.map(({ month, earned, status }) => (
          <div
            key={month}
            className="flex items-center justify-between py-3 border-b border-border last:border-0"
          >
            <div>
              <p className="text-sm font-medium">{month}</p>
              <Badge
                variant={status === "claimable" ? "default" : "secondary"}
                className="text-xs mt-0.5"
              >
                {status}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <p className="font-mono font-semibold">
                +${earned.toLocaleString()} USDC
              </p>
              {status === "claimable" && (
                <Button size="sm" variant="outline">
                  Claim
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

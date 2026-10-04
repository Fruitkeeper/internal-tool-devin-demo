import { Badge } from "@/platform/ui/components";
import { riskBand } from "@/apps/kyc/workflow";

const STATUS_TONE = { pending: "slate", in_review: "blue", recommended: "amber", approved: "green", rejected: "red" } as const;

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "slate"}>{status.replace("_", " ")}</Badge>;
}

export function RiskBadge({ score }: { score: number }) {
  const band = riskBand(score);
  return <Badge tone={band === "high" ? "red" : band === "medium" ? "amber" : "green"}>{score} · {band}</Badge>;
}

export function FlagBadges({ sanctionsHit, pepHit, escalated }: { sanctionsHit: boolean; pepHit: boolean; escalated?: boolean }) {
  return (
    <span className="inline-flex gap-1">
      {sanctionsHit && <Badge tone="red">sanctions</Badge>}
      {pepHit && <Badge tone="amber">PEP</Badge>}
      {escalated && <Badge tone="red">escalated</Badge>}
    </span>
  );
}

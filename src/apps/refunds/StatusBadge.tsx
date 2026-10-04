import { Badge } from "@/platform/ui/components";

const TONE = { pending: "slate", recommended: "amber", approved: "green", rejected: "red" } as const;

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONE[status as keyof typeof TONE] ?? "slate"}>{status}</Badge>;
}

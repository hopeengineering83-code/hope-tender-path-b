import { formatTenderStatus } from "../lib/tender-workflow";

const styles: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  INTAKE: "bg-indigo-100 text-indigo-700",
  ANALYZED: "bg-sky-100 text-sky-700",
  MATCHED: "bg-violet-100 text-violet-700",
  COMPLIANCE_REVIEW: "bg-amber-100 text-amber-700",
  READY_FOR_GENERATION: "bg-cyan-100 text-cyan-700",
  GENERATED: "bg-blue-100 text-blue-700",
  IN_REVIEW: "bg-orange-100 text-orange-700",
  APPROVED: "bg-green-100 text-green-700",
  EXPORTED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-rose-100 text-rose-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        styles[status] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {formatTenderStatus(status)}
    </span>
  );
}

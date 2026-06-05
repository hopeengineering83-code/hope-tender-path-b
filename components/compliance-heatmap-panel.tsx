// Compliance Requirement Heatmap Panel — server component.
//
// Shows a visual heatmap table of requirements with their compliance matrix status.
// Color-codes rows: green=FULLY_MET, amber=PARTIALLY_MET, red=NOT_MET, gray=UNKNOWN.
// Maps ComplianceMatrix.supportLevel (SUPPORTED / PARTIAL / UNSUPPORTED / EVIDENCE_PENDING_REVIEW)
// to the display-level compliance status used in the heatmap.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";

type HeatmapStatus = "FULLY_MET" | "PARTIALLY_MET" | "NOT_MET" | "UNKNOWN";

function toHeatmapStatus(supportLevel: string): HeatmapStatus {
  const s = (supportLevel ?? "").toUpperCase();
  if (s === "SUPPORTED") return "FULLY_MET";
  if (s === "PARTIAL" || s === "EVIDENCE_PENDING_REVIEW") return "PARTIALLY_MET";
  if (s === "UNSUPPORTED") return "NOT_MET";
  return "UNKNOWN";
}

function riskLevel(status: HeatmapStatus, priority: string): "HIGH" | "MEDIUM" | "LOW" | "NONE" {
  const isMandatory = (priority ?? "").toUpperCase() === "MANDATORY";
  if (status === "NOT_MET" && isMandatory) return "HIGH";
  if (status === "NOT_MET" && !isMandatory) return "MEDIUM";
  if (status === "PARTIALLY_MET" && isMandatory) return "MEDIUM";
  if (status === "PARTIALLY_MET" && !isMandatory) return "LOW";
  if (status === "UNKNOWN" && isMandatory) return "MEDIUM";
  return "NONE";
}

const STATUS_STYLES: Record<HeatmapStatus, { row: string; badge: string; label: string }> = {
  FULLY_MET:     { row: "border-emerald-100 bg-emerald-50",  badge: "bg-emerald-100 text-emerald-700", label: "FULLY MET" },
  PARTIALLY_MET: { row: "border-amber-100 bg-amber-50",     badge: "bg-amber-100 text-amber-700",     label: "PARTIAL" },
  NOT_MET:       { row: "border-red-100 bg-red-50",         badge: "bg-red-100 text-red-700",          label: "NOT MET" },
  UNKNOWN:       { row: "border-slate-100 bg-slate-50",     badge: "bg-slate-100 text-slate-500",     label: "UNKNOWN" },
};

const RISK_STYLES: Record<string, string> = {
  HIGH:   "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW:    "bg-slate-100 text-slate-600",
  NONE:   "bg-emerald-100 text-emerald-700",
};

export async function ComplianceHeatmapPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;

  const ownsTender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: { id: true },
  }).catch(() => null);
  if (!ownsTender) return null;

  // Load compliance matrix rows joined to their requirements.
  const matrixRows = await prisma.complianceMatrix.findMany({
    where: { tenderId },
    orderBy: { createdAt: "asc" },
    include: {
      requirement: {
        select: {
          id: true,
          title: true,
          requirementType: true,
          priority: true,
        },
      },
    },
  }).catch(() => [] as Array<{
    id: string;
    requirementId: string | null;
    evidenceType: string;
    evidenceSource: string;
    evidenceReference: string | null;
    supportLevel: string;
    notes: string | null;
    requirement: {
      id: string;
      title: string;
      requirementType: string;
      priority: string;
    } | null;
  }>);

  if (matrixRows.length === 0) return null;

  // Build display rows.
  const rows = matrixRows.map((row) => {
    const status = toHeatmapStatus(row.supportLevel);
    const priority = row.requirement?.priority ?? "OPTIONAL";
    const risk = riskLevel(status, priority);
    return {
      id: row.id,
      title: row.requirement?.title ?? `Requirement ${row.requirementId ?? "—"}`,
      requirementType: row.requirement?.requirementType ?? row.evidenceType ?? "—",
      priority,
      status,
      risk,
      evidenceSource: row.evidenceSource,
      notes: row.notes,
    };
  });

  // Summary counts.
  const fullyMet     = rows.filter((r) => r.status === "FULLY_MET").length;
  const partiallyMet = rows.filter((r) => r.status === "PARTIALLY_MET").length;
  const notMet       = rows.filter((r) => r.status === "NOT_MET").length;
  const unknown      = rows.filter((r) => r.status === "UNKNOWN").length;
  const highRisk     = rows.filter((r) => r.risk === "HIGH").length;

  return (
    <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Compliance Heatmap</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Requirement compliance status</h2>
          <p className="mt-1 text-sm text-slate-600">
            Visual overview of how well company evidence covers each tender requirement.
            High-risk rows must be resolved before final proposal generation.
          </p>
        </div>
        {highRisk > 0 && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
            {highRisk} high-risk requirement{highRisk !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Summary counts */}
      <div className="mb-4 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2">
          <p className="text-lg font-bold text-slate-900">{rows.length}</p>
          <p className="text-slate-500">Total</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2">
          <p className="text-lg font-bold text-emerald-700">{fullyMet}</p>
          <p className="text-emerald-600">Fully Met</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-2">
          <p className="text-lg font-bold text-amber-700">{partiallyMet}</p>
          <p className="text-amber-600">Partial</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 px-2 py-2">
          <p className="text-lg font-bold text-red-700">{notMet}</p>
          <p className="text-red-600">Not Met</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2">
          <p className="text-lg font-bold text-slate-500">{unknown}</p>
          <p className="text-slate-400">Unknown</p>
        </div>
      </div>

      {/* Heatmap table */}
      <div className="space-y-2">
        {rows.map((row) => {
          const style = STATUS_STYLES[row.status];
          return (
            <div
              key={row.id}
              className={`rounded-xl border p-3 ${style.row}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900 text-sm">{row.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {row.requirementType} · Evidence: {row.evidenceSource}
                  </p>
                  {row.notes && (
                    <p className="mt-1 text-xs text-slate-600 italic">{row.notes}</p>
                  )}
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
                  {/* Priority badge */}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    row.priority === "MANDATORY"
                      ? "bg-red-100 text-red-700"
                      : row.priority === "PREFERRED"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-500"
                  }`}>
                    {row.priority}
                  </span>
                  {/* Compliance status badge */}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${style.badge}`}>
                    {style.label}
                  </span>
                  {/* Risk badge */}
                  {row.risk !== "NONE" && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${RISK_STYLES[row.risk]}`}>
                      {row.risk} RISK
                    </span>
                  )}
                  {row.risk === "NONE" && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${RISK_STYLES.NONE}`}>
                      LOW RISK
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {highRisk > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>{highRisk} mandatory requirement{highRisk !== 1 ? "s" : ""} ha{highRisk === 1 ? "s" : "ve"} no evidence coverage.</strong>{" "}
          Upload supporting documents or run the compliance engine to close these gaps before final generation.
        </div>
      )}
    </section>
  );
}

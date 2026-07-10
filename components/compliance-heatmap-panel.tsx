// Compliance Requirement Heatmap Panel — server component.
// Shows summary counts first. Large partial / fully met rows are collapsed by default.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { clientLogger } from "@/lib/ui/client-logger";
import { PanelErrorFallback } from "./panel-error-fallback";

type HeatmapStatus = "FULLY_MET" | "PARTIALLY_MET" | "NOT_MET" | "UNKNOWN";

type HeatmapRow = {
  id: string;
  title: string;
  requirementType: string;
  priority: string;
  status: HeatmapStatus;
  risk: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  evidenceSource: string;
  notes: string | null;
};

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

function HeatmapRows({ rows }: { rows: HeatmapRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const style = STATUS_STYLES[row.status];
        return (
          <div key={row.id} className={`rounded-xl border p-3 ${style.row}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{row.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{row.requirementType} · Evidence: {row.evidenceSource}</p>
                {row.notes && <p className="mt-1 text-xs italic text-slate-600">{row.notes}</p>}
              </div>
              <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${row.priority === "MANDATORY" ? "bg-red-100 text-red-700" : row.priority === "PREFERRED" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{row.priority}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${style.badge}`}>{style.label}</span>
                {row.risk !== "NONE" ? (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${RISK_STYLES[row.risk]}`}>{row.risk} RISK</span>
                ) : (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${RISK_STYLES.NONE}`}>LOW RISK</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export async function ComplianceHeatmapPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  try {
    await prismaReady;

    const ownsTender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, select: { id: true } }).catch(() => null);
    if (!ownsTender) return null;

    const matrixRows = await prisma.complianceMatrix.findMany({
      where: { tenderId },
      orderBy: { createdAt: "asc" },
      include: {
        requirement: { select: { id: true, title: true, requirementType: true, priority: true } },
      },
    }).catch(() => [] as Array<{
      id: string;
      requirementId: string | null;
      evidenceType: string;
      evidenceSource: string;
      evidenceReference: string | null;
      supportLevel: string;
      notes: string | null;
      requirement: { id: string; title: string; requirementType: string; priority: string } | null;
    }>);

    if (matrixRows.length === 0) return null;

    const rows: HeatmapRow[] = matrixRows.map((row) => {
      const status = toHeatmapStatus(row.supportLevel);
      const priority = row.requirement?.priority ?? "OPTIONAL";
      return {
        id: row.id,
        title: row.requirement?.title ?? `Requirement ${row.requirementId ?? "—"}`,
        requirementType: row.requirement?.requirementType ?? row.evidenceType ?? "—",
        priority,
        status,
        risk: riskLevel(status, priority),
        evidenceSource: row.evidenceSource,
        notes: row.notes,
      };
    });

    const fullyMetRows = rows.filter((r) => r.status === "FULLY_MET");
    const partialRows = rows.filter((r) => r.status === "PARTIALLY_MET");
    const notMetRows = rows.filter((r) => r.status === "NOT_MET");
    const unknownRows = rows.filter((r) => r.status === "UNKNOWN");
    const highRiskRows = rows.filter((r) => r.risk === "HIGH");
    const visibleRiskRows = rows.filter((r) => r.risk === "HIGH" || r.status === "NOT_MET");

    return (
      <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Compliance Heatmap</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Requirement compliance status</h2>
            <p className="mt-1 text-sm text-slate-600">Summary first. Partial and fully-met rows are collapsed by default to avoid a long page.</p>
          </div>
          {highRiskRows.length > 0 && <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">{highRiskRows.length} high-risk requirement{highRiskRows.length !== 1 ? "s" : ""}</span>}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2"><p className="text-lg font-bold text-slate-900">{rows.length}</p><p className="text-slate-500">Total</p></div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2"><p className="text-lg font-bold text-emerald-700">{fullyMetRows.length}</p><p className="text-emerald-600">Fully Met</p></div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-2"><p className="text-lg font-bold text-amber-700">{partialRows.length}</p><p className="text-amber-600">Partial</p></div>
          <div className="rounded-xl border border-red-200 bg-red-50 px-2 py-2"><p className="text-lg font-bold text-red-700">{notMetRows.length}</p><p className="text-red-600">Not Met</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2"><p className="text-lg font-bold text-slate-500">{unknownRows.length}</p><p className="text-slate-400">Unknown</p></div>
        </div>

        {visibleRiskRows.length > 0 && (
          <div className="mb-3">
            <h3 className="mb-2 text-sm font-semibold text-red-800">Visible blockers and high-risk rows</h3>
            <HeatmapRows rows={visibleRiskRows.slice(0, 25)} />
          </div>
        )}

        <div className="space-y-3">
          {partialRows.length > 0 && (
            <details className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-amber-800">Show partial requirements ({partialRows.length})</summary>
              <div className="mt-3"><HeatmapRows rows={partialRows.slice(0, 50)} /></div>
              {partialRows.length > 50 && <p className="mt-2 text-xs text-amber-700">Showing first 50 partial rows. Use compliance review filters for the full list.</p>}
            </details>
          )}

          {fullyMetRows.length > 0 && (
            <details className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-emerald-800">Show fully met requirements ({fullyMetRows.length})</summary>
              <div className="mt-3"><HeatmapRows rows={fullyMetRows.slice(0, 50)} /></div>
              {fullyMetRows.length > 50 && <p className="mt-2 text-xs text-emerald-700">Showing first 50 fully met rows. Use compliance review filters for the full list.</p>}
            </details>
          )}

          {unknownRows.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Show unknown requirements ({unknownRows.length})</summary>
              <div className="mt-3"><HeatmapRows rows={unknownRows.slice(0, 50)} /></div>
            </details>
          )}
        </div>

        {highRiskRows.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>{highRiskRows.length} mandatory requirement{highRiskRows.length !== 1 ? "s" : ""} need attention.</strong> Upload supporting documents or run the compliance engine before final generation.
          </div>
        )}
      </section>
    );
  } catch (err) {
    clientLogger.error("[ComplianceHeatmapPanel] render error:", err instanceof Error ? { message: err.message } : { error: String(err) });
    return <PanelErrorFallback panelName="Complianceheatmappanel" />
  }
}

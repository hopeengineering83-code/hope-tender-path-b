// Final Package Manifest panel — server component.
//
// Shows a compact pre-export manifest summary by default. Long excluded / superseded
// rows are intentionally hidden behind a native dropdown so the tender page stays
// reviewable while export blockers remain visible.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { CheckIcon, CrossIcon } from "./icons";
import {
  isFinalExportCandidateDocument,
  deriveDocumentOutputState,
  exportBlockReason,
  isExportReady,
  type DocumentLike,
} from "../lib/engine/document-output-state";
import { clientLogger } from "@/lib/ui/client-logger";
import { getFinalPackageReadinessModel } from "../lib/engine/final-package-readiness-model";
import { PanelErrorFallback } from "./panel-error-fallback";

type DocRow = {
  id: string;
  name: string;
  exactFileName: string | null;
  documentType: string | null;
  envelope: string;
  exactOrder: number | null;
  generationStatus: string | null;
  validationStatus: string | null;
  reviewStatus: string | null;
  storagePath: string | null;
  fileContent: string | null;
  format: string | null;
};

type ManifestRow = {
  doc: DocRow;
  isCandidate: boolean;
  outputState: string;
  blockReason: string | null;
  ready: boolean;
  inPlan: boolean;
  includedInZip: boolean;
  excludedReason: string | null;
};

function envelopeLabel(doc: DocRow): string {
  const dtype = (doc.documentType ?? "").toUpperCase();
  if (dtype === "FINANCIAL" || dtype === "PRICE_SCHEDULE" || dtype === "FINANCIAL_PROPOSAL") return "Financial";
  if (dtype === "COVER_LETTER") return "Cover";
  if (dtype === "OFFICIAL_ORIGINAL" || dtype === "OFFICIAL_FORM") return "Official Original";
  if (dtype === "COMPLIANCE" || dtype === "COMPLIANCE_MATRIX") return "Technical / Compliance";
  return "Technical";
}

function statusBadge(state: string) {
  if (state === "READY_FOR_EXPORT") return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Ready</span>;
  if (state === "VALIDATED" || state === "DOCX_GENERATED" || state === "PDF_GENERATED") return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Not approved</span>;
  if (state === "SUPERSEDED") return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Superseded</span>;
  if (state === "ORIGINAL_REQUIRED") return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Original required</span>;
  if (state === "NEEDS_REVALIDATION") return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Needs revalidation</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Pending</span>;
}

function ManifestRowsTable({ rows, hasExplicitPlan, faded = false }: { rows: ManifestRow[]; hasExplicitPlan: boolean; faded?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div id="final-package-manifest" className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 font-semibold">File name</th>
            <th className="py-2 pr-4 font-semibold">Envelope</th>
            <th className="py-2 pr-4 text-center font-semibold">In plan</th>
            <th className="py-2 pr-4 font-semibold">Status</th>
            <th className="py-2 pr-4 text-center font-semibold">In ZIP</th>
            <th className="py-2 font-semibold">Reason if excluded</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ doc, outputState, includedInZip, excludedReason, inPlan }) => (
            <tr key={doc.id} className={`border-b border-slate-100 ${faded || !includedInZip ? "opacity-60" : ""}`}>
              <td className="max-w-[220px] truncate py-2 pr-4 font-medium text-slate-900" title={doc.exactFileName ?? doc.name}>
                {doc.exactFileName ?? doc.name}
              </td>
              <td className="py-2 pr-4 text-slate-600">{doc.envelope}</td>
              <td className="py-2 pr-4 text-center">
                {!hasExplicitPlan
                  ? <span className="text-slate-400">—</span>
                  : inPlan
                    ? <CheckIcon className="inline h-4 w-4 text-emerald-600" />
                    : <span className="font-medium text-amber-600">Outside plan</span>
                }
              </td>
              <td className="py-2 pr-4">{statusBadge(outputState)}</td>
              <td className="py-2 pr-4 text-center">
                {includedInZip
                  ? <CheckIcon className="inline h-4 w-4 font-bold text-emerald-600" />
                  : <CrossIcon className="inline h-4 w-4 font-bold text-red-600" />
                }
              </td>
              <td className="max-w-[260px] py-2 text-slate-500">
                {excludedReason ?? <span className="text-emerald-600">Included</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function FinalPackageManifestPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  try {
    await prismaReady;

    const tender = await prisma.tender.findFirst({
      where: { id: tenderId, userId },
      select: {
        id: true,
        title: true,
        exactFileNaming: true,
        exactFileOrder: true,
        pageLimit: true,
        requirements: {
          select: { id: true, title: true, priority: true, requirementType: true },
        },
        generatedDocuments: {
          orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            exactFileName: true,
            documentType: true,
            exactOrder: true,
            generationStatus: true,
            validationStatus: true,
            reviewStatus: true,
            storagePath: true,
            fileContent: true,
            format: true,
          },
        },
      },
    }).catch(() => null);

    if (!tender) return null;
    if (tender.generatedDocuments.length === 0) return null;

    const finalPackage = await getFinalPackageReadinessModel(prisma, tenderId, userId);
    const hasExplicitPlan = finalPackage.documents.planned.length > 0;
    const generatedById = new Map(finalPackage.documents.generated.map((doc) => [doc.id, doc]));

    const docs: DocRow[] = tender.generatedDocuments.map((d) => ({
      ...d,
      name: d.name ?? "Untitled",
      envelope: envelopeLabel(d as unknown as DocRow),
    }));

    const rows: ManifestRow[] = docs.map((doc) => {
      const docLike: DocumentLike = {
        id: doc.id,
        name: doc.name,
        exactFileName: doc.exactFileName,
        documentType: doc.documentType,
        format: doc.format,
        storagePath: doc.storagePath,
        fileContent: doc.fileContent,
        generationStatus: doc.generationStatus,
        validationStatus: doc.validationStatus,
        reviewStatus: doc.reviewStatus,
      };
      const modelDoc = generatedById.get(doc.id);
      const isCandidate = modelDoc?.exportCandidate ?? isFinalExportCandidateDocument(docLike);
      const outputState = modelDoc?.outputState ?? deriveDocumentOutputState(docLike);
      const blockReason = modelDoc?.blockerReason ?? exportBlockReason(outputState);
      const ready = modelDoc?.exportReady ?? isExportReady(docLike);
      const inPlan = Boolean(modelDoc?.plannedDocumentKey);

      return {
        doc,
        isCandidate,
        outputState,
        blockReason,
        ready,
        inPlan,
        includedInZip: Boolean(modelDoc?.exportReady),
        excludedReason: modelDoc?.exclusionReason ?? (!isCandidate
          ? "Excluded from export (internal/control/superseded)"
          : !ready
            ? (blockReason ?? "Not export-ready")
            : null),
      };
    });

    const includedRows = rows.filter((r) => r.includedInZip);
    const blockedRows = rows.filter((r) => r.isCandidate && !r.ready);
    const excludedRows = rows.filter((r) => !r.includedInZip && !blockedRows.some((b) => b.doc.id === r.doc.id));

    return (
      <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final Package Manifest</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Submission file list — before ZIP export</h2>
            <p className="mt-1 text-sm text-slate-600">Counters stay visible; excluded/superseded rows are collapsed to keep review compact.</p>
          </div>
          <div className="flex gap-3 text-center">
            <div className="rounded-xl border bg-emerald-50 px-4 py-2">
              <p className="text-xs text-emerald-600">In ZIP</p>
              <p className="text-xl font-bold text-emerald-700">{includedRows.length}</p>
            </div>
            <div className="rounded-xl border bg-amber-50 px-4 py-2">
              <p className="text-xs text-amber-600">Blocked</p>
              <p className="text-xl font-bold text-amber-800">{blockedRows.length}</p>
            </div>
            <div className="rounded-xl border bg-slate-50 px-4 py-2">
              <p className="text-xs text-slate-500">Excluded</p>
              <p className="text-xl font-bold text-slate-700">{excludedRows.length}</p>
            </div>
          </div>
        </div>

        {blockedRows.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>{blockedRows.length} document(s) are not export-ready.</strong> The durable post-Engine workflow validates and finalizes safe outputs automatically; intervene only for the specific source, evidence, quality, authority, legal, or integrity blocker shown. These rows stay visible.
          </div>
        )}

        {includedRows.length > 0 && (
          <details open className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/30 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-emerald-800">In ZIP documents ({includedRows.length})</summary>
            <div className="mt-3 rounded-lg bg-white p-2">
              <ManifestRowsTable rows={includedRows} hasExplicitPlan={hasExplicitPlan} />
            </div>
          </details>
        )}

        {blockedRows.length > 0 && (
          <details open className="mb-3 rounded-xl border border-amber-100 bg-amber-50/30 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-amber-800">Blocked documents ({blockedRows.length})</summary>
            <div className="mt-3 rounded-lg bg-white p-2">
              <ManifestRowsTable rows={blockedRows} hasExplicitPlan={hasExplicitPlan} />
            </div>
          </details>
        )}

        {excludedRows.length > 0 && (
          <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Show excluded/superseded documents ({excludedRows.length})</summary>
            <p className="mt-2 text-xs text-slate-500">These rows are hidden by default because they are not export candidates and will not be included in the ZIP.</p>
            <div className="mt-3 rounded-lg bg-white p-2">
              <ManifestRowsTable rows={excludedRows} hasExplicitPlan={hasExplicitPlan} faded />
            </div>
          </details>
        )}

        {!hasExplicitPlan && (
          <p className="mt-3 text-xs text-slate-500">
No final-package submission plan files are currently detected by the shared readiness model — the &quot;In plan&quot; column is not applicable. Run Engine to create and source-verify the Build Plan automatically; use recovery only if Engine reports a genuine source failure.
          </p>
        )}
      </section>
    );
  } catch (err) {
    clientLogger.error("[FinalPackageManifestPanel] render error:", err instanceof Error ? { message: err.message } : { error: String(err) });
    return <PanelErrorFallback panelName="FinalPackageManifestPanel" />
  }
}

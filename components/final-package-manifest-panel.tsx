// Final Package Manifest panel — server component.
//
// Shows a per-file table of exactly what will be (and won't be) included
// in the final ZIP export, with the reason for each exclusion.
//
// Columns: file name · envelope · plan row · required · generated/attached ·
//          status · validation passed · included in ZIP · reason if excluded
//
// This is the "review before you click Export" view. It only reads data;
// it never mutates anything.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import {
  isFinalExportCandidateDocument,
  deriveDocumentOutputState,
  exportBlockReason,
  isExportReady,
  type DocumentLike,
} from "../lib/engine/document-output-state";
import {
  buildSubmissionPlan,
  hasExplicitSubmissionScope,
  plannedSubmissionTargetFiles,
} from "../lib/engine/submission-plan";

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
  if (state === "VALIDATED" || state === "DOCX_GENERATED" || state === "PDF_GENERATED") return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Not approved</span>;
  if (state === "SUPERSEDED") return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Superseded</span>;
  if (state === "ORIGINAL_REQUIRED") return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Original required</span>;
  if (state === "NEEDS_REVALIDATION") return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Needs revalidation</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Pending</span>;
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

  const submissionPlan = buildSubmissionPlan({
    id: tender.id,
    title: tender.title,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    pageLimit: tender.pageLimit,
    requirements: tender.requirements,
  });
  const hasExplicitPlan = hasExplicitSubmissionScope(tender);
  const planTargets = hasExplicitPlan ? plannedSubmissionTargetFiles(submissionPlan) : [];
  const planTargetNames = new Set(planTargets.map((p) => p.exactFileName?.toLowerCase() ?? ""));

  const docs: DocRow[] = tender.generatedDocuments.map((d) => ({
    ...d,
    name: d.name ?? "Untitled",
    envelope: envelopeLabel(d as DocRow),
  }));

  // Separate included vs excluded
  const rows = docs.map((doc) => {
    const docLike: DocumentLike = {
      id: doc.id,
      name: doc.name,
      exactFileName: doc.exactFileName,
      documentType: doc.documentType,
      format: doc.format,
      storagePath: doc.storagePath,
      generationStatus: doc.generationStatus,
      validationStatus: doc.validationStatus,
      reviewStatus: doc.reviewStatus,
    };
    const isCandidate = isFinalExportCandidateDocument(docLike);
    const outputState = deriveDocumentOutputState(docLike);
    const blockReason = exportBlockReason(outputState);
    const ready = isExportReady(docLike);
    const inPlan = !hasExplicitPlan || planTargetNames.has((doc.exactFileName ?? "").toLowerCase());

    return {
      doc,
      isCandidate,
      outputState,
      blockReason,
      ready,
      inPlan,
      includedInZip: isCandidate && ready,
      excludedReason: !isCandidate
        ? "Excluded from export (internal/control/superseded)"
        : !ready
          ? (blockReason ?? "Not export-ready")
          : null,
    };
  });

  const includedCount = rows.filter((r) => r.includedInZip).length;
  const excludedCount = rows.filter((r) => !r.includedInZip).length;
  const blockedCount = rows.filter((r) => r.isCandidate && !r.ready).length;

  return (
    <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final Package Manifest</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Submission file list — before ZIP export</h2>
          <p className="mt-1 text-sm text-slate-600">Every document row and its inclusion status. Review this before clicking Export.</p>
        </div>
        <div className="flex gap-3 text-center">
          <div className="rounded-xl border bg-emerald-50 px-4 py-2">
            <p className="text-xs text-emerald-600">In ZIP</p>
            <p className="text-xl font-bold text-emerald-700">{includedCount}</p>
          </div>
          <div className="rounded-xl border bg-amber-50 px-4 py-2">
            <p className="text-xs text-amber-600">Blocked</p>
            <p className="text-xl font-bold text-amber-700">{blockedCount}</p>
          </div>
          <div className="rounded-xl border bg-slate-50 px-4 py-2">
            <p className="text-xs text-slate-500">Excluded</p>
            <p className="text-xl font-bold text-slate-700">{excludedCount}</p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500 uppercase tracking-wide">
              <th className="py-2 pr-4 font-semibold">File name</th>
              <th className="py-2 pr-4 font-semibold">Envelope</th>
              <th className="py-2 pr-4 font-semibold text-center">In plan</th>
              <th className="py-2 pr-4 font-semibold">Status</th>
              <th className="py-2 pr-4 font-semibold text-center">In ZIP</th>
              <th className="py-2 font-semibold">Reason if excluded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ doc, outputState, includedInZip, excludedReason, inPlan }) => (
              <tr key={doc.id} className={`border-b border-slate-100 ${!includedInZip ? "opacity-60" : ""}`}>
                <td className="py-2 pr-4 font-medium text-slate-900 max-w-[220px] truncate" title={doc.exactFileName ?? doc.name}>
                  {doc.exactFileName ?? doc.name}
                </td>
                <td className="py-2 pr-4 text-slate-600">{doc.envelope}</td>
                <td className="py-2 pr-4 text-center">
                  {!hasExplicitPlan
                    ? <span className="text-slate-400">—</span>
                    : inPlan
                      ? <span className="text-emerald-600 font-medium">✓</span>
                      : <span className="text-amber-600 font-medium">Outside plan</span>
                  }
                </td>
                <td className="py-2 pr-4">{statusBadge(outputState)}</td>
                <td className="py-2 pr-4 text-center">
                  {includedInZip
                    ? <span className="text-emerald-600 font-bold">✓</span>
                    : <span className="text-red-600 font-bold">✗</span>
                  }
                </td>
                <td className="py-2 text-slate-500 max-w-[260px]">
                  {excludedReason ?? <span className="text-emerald-600">Included</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {blockedCount > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>{blockedCount} document(s) are not export-ready.</strong> Validate, review, and approve each before exporting. Use the Validate / Auto-finalize buttons on each document row.
        </div>
      )}

      {!hasExplicitPlan && (
        <p className="mt-3 text-xs text-slate-500">
          No explicit submission plan has been confirmed — the &quot;In plan&quot; column is not applicable. Build and confirm a submission plan to enable envelope separation and outside-plan exclusion.
        </p>
      )}
    </section>
  );
  } catch (err) {
    console.error("[FinalPackageManifestPanel] render error:", err);
    return (
      <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <p className="text-xs font-semibold text-amber-700">Panel failed to load — data may be incomplete. Refresh to retry.</p>
      </section>
    );
  }
}

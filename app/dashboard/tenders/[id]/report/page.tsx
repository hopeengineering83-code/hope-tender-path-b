import { notFound, redirect } from "next/navigation";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { PrintButton } from "./print-button";
import { getTenderReleaseState } from "../../../../../lib/engine/tender-release-state";
import { formatTenderStatus } from "../../../../../lib/tender-workflow";
import { formatOperationalCode, formatOperationalReason } from "../../../../../lib/operational-labels";
import { ArrowRightIcon, WarningIcon } from "../../../../../components/icons";

// This watermark is print-visible to prevent browser print dialog bypass.

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Tender Report — ${id}` };
}

function fmt(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function priorityOrder(priority: string) {
  if (priority === "MANDATORY") return 0;
  if (priority === "HIGH") return 1;
  if (priority === "MEDIUM") return 2;
  return 3;
}

function severityBadge(severity: string) {
  const base = "inline-block rounded px-2 py-0.5 text-xs font-semibold";
  if (severity === "CRITICAL") return `${base} bg-red-100 text-red-700`;
  if (severity === "HIGH") return `${base} bg-orange-100 text-orange-700`;
  if (severity === "MEDIUM") return `${base} bg-amber-100 text-amber-700`;
  return `${base} bg-slate-100 text-slate-600`;
}

function statusBadge(status: string) {
  const base = "inline-block rounded px-2 py-0.5 text-xs font-semibold";
  if (status === "GENERATED") return `${base} bg-green-100 text-green-700`;
  if (status === "PLANNED") return `${base} bg-slate-100 text-slate-600`;
  if (status === "FAILED") return `${base} bg-red-100 text-red-700`;
  return `${base} bg-blue-100 text-blue-700`;
}

export default async function TenderReportPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    select: {
      id: true,
      title: true,
      reference: true,
      clientName: true,
      procuringEntityName: true,
      country: true,
      deadline: true,
      currency: true,
      status: true,
      stage: true,
      analysisExtractionStatus: true,
      clientContactName: true,
      clientContactEmail: true,
      clientContactPhone: true,
      submissionMethod: true,
      submissionAddress: true,
      submissionEmails: true,
      submissionEmailSubject: true,
      preBidChannel: true,
      preBidMeetingDate: true,
      preBidMeetingLocation: true,
      analysisSummary: true,
      metadataContaminated: true,
      requirements: {
        select: { id: true, title: true, priority: true, requirementType: true },
        orderBy: { createdAt: "asc" },
        take: 50,
      },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: { id: true, documentType: true, generationStatus: true, validationStatus: true },
      },
      complianceGaps: {
        where: { isResolved: false },
        select: { id: true, title: true, severity: true },
        orderBy: { createdAt: "desc" },
      },
      files: {
        select: { id: true, originalFileName: true, totalPages: true, extractedPages: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!tender) notFound();

  // Canonical Tender Release State remains the only authority for
  // Print/Save-as-PDF — the same blockers/eligibility every other surface
  // (tender workspace, command center) reads. This page must never
  // recompute its own readiness, blocker list, or authoritative verdict.
  const releaseState = await getTenderReleaseState(prisma, id, userId).catch(() => null);

  const isAuthoritative = releaseState !== null && releaseState.exportEligible === true && releaseState.blockerTotal === 0;
  const canonicalBlockers = [...(releaseState?.blockers ?? [])];

  // Currency provenance is a per-field grounding state, not a
  // blocker/score/verdict/action — sourced from releaseState.canonicalFields,
  // the canonical field resolver's output computed once inside
  // getTenderReleaseState, never a separate divergent call.
  const currencyFieldState = releaseState?.canonicalFields?.find(
    (field) => field.fieldKey === "currency",
  ) ?? null;
  const currencyStatus = currencyFieldState?.status ?? "INVALID";
  const isCurrencyVerified = ["EXTRACTED_AND_GROUNDED", "MANUAL_CONFIRMED"].includes(currencyStatus);
  const isCurrencyAbsent = !tender.currency || ["INVALID", "NOT_STATED", "NOT_APPLICABLE"].includes(currencyStatus);
  const hasUnverifiedCurrency = Boolean(tender.currency) && !isCurrencyVerified && !isCurrencyAbsent;
  const currencyDisplay = isCurrencyAbsent
    ? "Not extracted"
    : isCurrencyVerified
      ? (tender.currency ?? "—")
      : "Unverified legacy value";

  const sortedRequirements = [...tender.requirements].sort(
    (a, b) => priorityOrder(a.priority) - priorityOrder(b.priority),
  );
  const topRequirements = sortedRequirements.slice(0, 20);
  const analysisSummary = tender.analysisSummary
    ? tender.analysisSummary.slice(0, 1000)
    : null;
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 font-sans text-slate-900 print:max-w-none print:px-0 print:py-0">
      {!isAuthoritative && (
        <div className="mb-6 rounded-lg border-2 border-dashed border-amber-500 bg-amber-50 px-4 py-3 print:border-amber-700 print:bg-amber-100">
          <p className="text-sm font-bold text-amber-900 print:text-amber-950">
            <WarningIcon /> NON-AUTHORITATIVE PREVIEW — NOT FOR SUBMISSION
          </p>
          <p className="mt-1 text-xs text-amber-800 print:text-amber-900">
            This report has not passed canonical final-submission readiness. It must not be submitted to any procuring entity. Resolve the blockers below and re-run the engine to produce an authoritative document. This watermark is print-visible to prevent browser print dialog bypass.
          </p>
          {canonicalBlockers.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-amber-800 print:text-amber-900">
              {canonicalBlockers.slice(0, 5).map((blocker, index) => (
                <li key={index}>
                  <span className="font-semibold">{formatOperationalCode(blocker.category)}:</span>{" "}
                  {formatOperationalReason(blocker.title)}
                  {blocker.nextAction ? (
                    <span className="block pl-4 italic"><ArrowRightIcon /> {formatOperationalReason(blocker.nextAction)}</span>
                  ) : null}
                </li>
              ))}
              {canonicalBlockers.length > 5 && (
                <li className="italic">…and {canonicalBlockers.length - 5} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="print:hidden mb-6 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-700">Tender Report Preview</h1>
        {isAuthoritative ? (
          <PrintButton />
        ) : (
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              Non-authoritative preview
            </span>
            <span className="text-xs text-slate-400">
              Print/Save-as-PDF disabled — {canonicalBlockers.length > 0
                ? `${canonicalBlockers.length} canonical blocker(s)`
                : "final-submission readiness not met"}
            </span>
          </div>
        )}
      </div>

      {!isAuthoritative && (
        <div className="print:hidden mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">Non-authoritative review preview</p>
          <p className="mt-1 text-xs text-amber-700">
            This report is for internal review only. It does not create a generated document, PDF, or ZIP record. Authoritative printing and export require all canonical final-submission gates to pass.
          </p>
        </div>
      )}

      <header className="mb-8 border-b-2 border-slate-800 pb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Tender Summary Report</p>
        <h1 className="mt-1 break-words text-2xl font-bold leading-snug text-slate-900">
          {tender.title ?? "—"}
        </h1>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600">
          <span><span className="font-medium">Client:</span> {(tender.clientName || tender.procuringEntityName) ?? "—"}</span>
          <span><span className="font-medium">Country:</span> {tender.country ?? "—"}</span>
          <span><span className="font-medium">Deadline:</span> {fmt(tender.deadline)}</span>
          <span>
            <span className="font-medium">Currency:</span>{" "}
            {currencyDisplay}
            {hasUnverifiedCurrency && (
              <span className="ml-1 text-xs text-amber-600">(unverified — not in authoritative output)</span>
            )}
          </span>
          <span>
            <span className="font-medium">Status:</span>{" "}
            <span className="inline-block rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
              {formatTenderStatus(tender.status)}
            </span>
          </span>
          <span>
            <span className="font-medium">Stage:</span>{" "}
            <span className="inline-block rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
              {formatOperationalCode(tender.stage)}
            </span>
          </span>
        </div>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 border-b border-slate-200 pb-1 text-base font-bold uppercase tracking-wide text-slate-700">
          Submission Details
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <tbody>
              {[
                ["Submission Method", tender.submissionMethod ?? "—"],
                ["Submission Address", tender.submissionAddress ?? "—"],
                ["Submission Email(s)", tender.submissionEmails ? tender.submissionEmails.split("|").join(", ") : "—"],
                ["Contact Person", tender.clientContactName ?? "—"],
                ["Contact Email", tender.clientContactEmail ?? "—"],
                ...(tender.clientContactPhone ? [["Contact Phone", tender.clientContactPhone]] : []),
                ...(tender.preBidChannel ? [["Pre-bid Channel", tender.preBidChannel]] : []),
                ...(tender.preBidMeetingDate ? [["Pre-bid Meeting", new Date(tender.preBidMeetingDate).toLocaleDateString() + (tender.preBidMeetingLocation ? ` — ${tender.preBidMeetingLocation}` : "")]] : []),
              ].map(([label, value]) => (
                <tr key={label} className="border-b border-slate-100">
                  <td className="w-44 py-1.5 pr-4 align-top font-medium text-slate-500">{label}</td>
                  <td className="py-1.5 text-slate-800">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {analysisSummary && (
        <section className="mb-8">
          <h2 className="mb-3 border-b border-slate-200 pb-1 text-base font-bold uppercase tracking-wide text-slate-700">
            AI Analysis Summary
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
            {analysisSummary}
            {(tender.analysisSummary?.length ?? 0) > 1000 && (
              <span className="italic text-slate-400"> … (truncated)</span>
            )}
          </p>
        </section>
      )}

      {topRequirements.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 border-b border-slate-200 pb-1 text-base font-bold uppercase tracking-wide text-slate-700">
            Requirements (top {topRequirements.length} of {tender.requirements.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-800 text-left text-white">
                  <th className="w-28 px-2 py-2 font-semibold">Priority</th>
                  <th className="px-2 py-2 font-semibold">Title</th>
                  <th className="w-36 px-2 py-2 font-semibold">Type</th>
                </tr>
              </thead>
              <tbody>
                {topRequirements.map((requirement, index) => (
                  <tr key={requirement.id} className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="border border-slate-100 px-2 py-1.5">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                        requirement.priority === "MANDATORY"
                          ? "bg-red-100 text-red-700"
                          : requirement.priority === "HIGH"
                            ? "bg-orange-100 text-orange-700"
                            : "bg-slate-100 text-slate-600"
                      }`}>
                        {formatOperationalCode(requirement.priority)}
                      </span>
                    </td>
                    <td className="border border-slate-100 px-2 py-1.5 text-slate-800">{requirement.title ?? "—"}</td>
                    <td className="border border-slate-100 px-2 py-1.5 text-slate-600">{formatOperationalCode(requirement.requirementType)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tender.generatedDocuments.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 border-b border-slate-200 pb-1 text-base font-bold uppercase tracking-wide text-slate-700">
            Generated Documents
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-800 text-left text-white">
                  <th className="px-2 py-2 font-semibold">Document Type</th>
                  <th className="w-36 px-2 py-2 font-semibold">Generation Status</th>
                  <th className="w-36 px-2 py-2 font-semibold">Validation</th>
                </tr>
              </thead>
              <tbody>
                {tender.generatedDocuments.map((document, index) => (
                  <tr key={document.id} className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="border border-slate-100 px-2 py-1.5 text-slate-800">{formatOperationalCode(document.documentType)}</td>
                    <td className="border border-slate-100 px-2 py-1.5">
                      <span className={statusBadge(document.generationStatus ?? "")}>
                        {formatOperationalCode(document.generationStatus)}
                      </span>
                    </td>
                    <td className="border border-slate-100 px-2 py-1.5">
                      <span className={statusBadge(document.validationStatus ?? "")}>
                        {formatOperationalCode(document.validationStatus)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tender.complianceGaps.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 border-b border-slate-200 pb-1 text-base font-bold uppercase tracking-wide text-slate-700">
            Open Compliance Gaps ({tender.complianceGaps.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-800 text-left text-white">
                  <th className="px-2 py-2 font-semibold">Gap Title</th>
                  <th className="w-28 px-2 py-2 font-semibold">Severity</th>
                </tr>
              </thead>
              <tbody>
                {tender.complianceGaps.map((gap, index) => (
                  <tr key={gap.id} className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="border border-slate-100 px-2 py-1.5 text-slate-800">{formatOperationalReason(gap.title)}</td>
                    <td className="border border-slate-100 px-2 py-1.5">
                      <span className={severityBadge(gap.severity ?? "")}>
                        {formatOperationalCode(gap.severity)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tender.files.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 border-b border-slate-200 pb-1 text-base font-bold uppercase tracking-wide text-slate-700">
            File Extraction Summary
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-800 text-left text-white">
                  <th className="px-2 py-2 font-semibold">File</th>
                  <th className="w-44 px-2 py-2 text-right font-semibold">Pages Extracted / Total</th>
                </tr>
              </thead>
              <tbody>
                {tender.files.map((file, index) => {
                  const extracted = file.extractedPages ?? "?";
                  const total = file.totalPages ?? "?";
                  const isComplete =
                    file.extractedPages != null &&
                    file.totalPages != null &&
                    file.extractedPages >= file.totalPages;
                  return (
                    <tr key={file.id} className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="break-all border border-slate-100 px-2 py-1.5 text-slate-800">
                        {file.originalFileName ?? "—"}
                      </td>
                      <td className={`border border-slate-100 px-2 py-1.5 text-right font-mono text-xs ${
                        isComplete ? "text-green-700" : "text-amber-700"
                      }`}>
                        {extracted} / {total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="mt-10 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
        Generated by Hope Tender · {today}
      </footer>
    </div>
  );
}

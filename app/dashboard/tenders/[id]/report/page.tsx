import { notFound, redirect } from "next/navigation";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { PrintButton } from "./print-button";
import { getFinalSubmissionReadiness } from "../../../../../lib/engine/final-submission-readiness";
import { ArrowRightIcon, WarningIcon } from "../../../../../components/icons";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Tender Report — ${id}` };
}

function fmt(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function priorityOrder(p: string) {
  if (p === "MANDATORY") return 0;
  if (p === "HIGH") return 1;
  if (p === "MEDIUM") return 2;
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

  // ── Canonical final-submission readiness ──────────────────────────────
  // The report page must NOT expose authoritative Print/Save-as-PDF for
  // corrupted, AI-skipped, stale, partial, fallback, or export-blocked
  // tenders. The canonical server authority (getFinalSubmissionReadiness)
  // is the single source of truth for whether this tender may produce an
  // authoritative document. A non-authoritative preview is still shown
  // (review-only), but it creates zero GeneratedDocument/PDF/ZIP rows.
  const canonicalReadiness = await getFinalSubmissionReadiness(prisma, {
    tenderId: id,
    userId,
  }).catch(() => null);

  // isAuthoritative is derived from canonical readiness — which includes
  // currency authority via the canonical field resolver called inside
  // getFinalSubmissionReadiness. No separate authority call needed.
  const isAuthoritative =
    canonicalReadiness?.ok === true &&
    (canonicalReadiness.tenderLevelBlockers.length === 0);
  const canonicalBlockers = [...(canonicalReadiness?.tenderLevelBlockers ?? [])];

  // ── Currency display (from canonical readiness result) ──────────────
  // Per REVISION_REQUIRED: the report page must NOT call the canonical
  // field resolver directly with weaker inputs. Instead, derive the
  // currency verdict from the getFinalSubmissionReadiness result, which
  // already calls the canonical resolver with FULL inputs (ledgerFacts,
  // active files, source-evidence columns, etc.). The readiness result
  // now exposes canonicalFields[] — we find the currency field and use
  // its specific status.
  const currencyFieldState = canonicalReadiness?.canonicalFields?.find(
    (f) => f.fieldKey === "currency",
  ) ?? null;

  // Field-specific currency verdict:
  // - EXTRACTED_AND_GROUNDED / MANUAL_CONFIRMED → verified, show value
  // - INVALID / NOT_STATED / null currency → "Not extracted"
  // - Any other state → "Unverified legacy value"
  const currencyStatus = currencyFieldState?.status ?? "INVALID";
  const isCurrencyVerified = [
    "EXTRACTED_AND_GROUNDED",
    "MANUAL_CONFIRMED",
  ].includes(currencyStatus);
  const isCurrencyAbsent = !tender.currency || ["INVALID", "NOT_STATED", "NOT_APPLICABLE"].includes(currencyStatus);
  const hasUnverifiedCurrency = Boolean(tender.currency) && !isCurrencyVerified && !isCurrencyAbsent;
  const currencyDisplay = isCurrencyAbsent
    ? "Not extracted"
    : isCurrencyVerified
      ? (tender.currency ?? "—")
      : "Unverified legacy value";

  // Sort requirements: MANDATORY first, then by priority order
  const sortedRequirements = [...tender.requirements].sort(
    (a, b) => priorityOrder(a.priority) - priorityOrder(b.priority),
  );
  const topRequirements = sortedRequirements.slice(0, 20);

  const analysisSummary = tender.analysisSummary
    ? tender.analysisSummary.slice(0, 1000)
    : null;

  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  // currencyDisplay and hasUnverifiedCurrency are derived from the canonical
  // resolver (via getFinalSubmissionReadiness). No separate helper needed.
  const isCurrencyUnverified = hasUnverifiedCurrency;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 font-sans text-slate-900 print:max-w-none print:px-0 print:py-0">
      {/* Print-VISIBLE watermark for non-authoritative previews.
          This MUST NOT use print:hidden — otherwise a user can invoke the
          browser print dialog directly and the warning disappears, producing
          an apparently authoritative PDF. The watermark is screen-hidden
          (hidden) when authoritative, and screen-shown + print-shown when
          non-authoritative. */}
      {!isAuthoritative && (
        <div className="mb-6 rounded-lg border-2 border-dashed border-amber-500 bg-amber-50 px-4 py-3 print:border-amber-700 print:bg-amber-100">
          <p className="text-sm font-bold text-amber-900 print:text-amber-950">
            <WarningIcon /> NON-AUTHORITATIVE PREVIEW — NOT FOR SUBMISSION
          </p>
          <p className="mt-1 text-xs text-amber-800 print:text-amber-900">
            This report has NOT passed canonical final-submission readiness.
            It must not be submitted to any procuring entity. Resolve the
            blockers below and re-run the engine to produce an authoritative
            document. This watermark is print-visible to prevent bypass via
            the browser print dialog.
          </p>
          {canonicalBlockers.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-amber-800 print:text-amber-900">
              {canonicalBlockers.slice(0, 5).map((b, i) => (
                <li key={i}>
                  <span className="font-mono font-semibold">{b.category}:</span> {b.title}
                  {b.recommendedAction ? <span className="block pl-4 italic"><ArrowRightIcon /> {b.recommendedAction}</span> : null}
                </li>
              ))}
              {canonicalBlockers.length > 5 && (
                <li className="italic">…and {canonicalBlockers.length - 5} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Print controls — hidden in print */}
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

      {/* Non-authoritative preview banner (screen-only summary) — visible only when not canonical-ready */}
      {!isAuthoritative && (
        <div className="print:hidden mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            Non-authoritative review preview
          </p>
          <p className="mt-1 text-xs text-amber-700">
            This report is for internal review only. It does not create a GeneratedDocument,
            PDF, or ZIP row. Authoritative printing/export requires all canonical final-submission
            gates to pass. Resolve the blockers below and re-run the engine.
          </p>
        </div>
      )}

      {/* ── Report header ───────────────────────────────────────────── */}
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
            {isCurrencyUnverified && (
              <span className="ml-1 text-xs text-amber-600">(unverified — not in authoritative output)</span>
            )}
          </span>
          <span>
            <span className="font-medium">Status:</span>{" "}
            <span className="inline-block rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
              {tender.status ?? "—"}
            </span>
          </span>
          <span>
            <span className="font-medium">Stage:</span>{" "}
            <span className="inline-block rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
              {tender.stage ?? "—"}
            </span>
          </span>
        </div>
      </header>

      {/* ── Submission details ──────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="mb-3 text-base font-bold uppercase tracking-wide text-slate-700 border-b border-slate-200 pb-1">
          Submission Details
        </h2>
        <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <tbody>
            {[
              ["Submission Method", tender.submissionMethod ?? "—"],
              ["Submission Address", tender.submissionAddress ?? "—"],
              ["Submission Email(s)", tender.submissionEmails
                ? tender.submissionEmails.split("|").join(", ")
                : "—"],
              ["Contact Person", tender.clientContactName ?? "—"],
              ["Contact Email", tender.clientContactEmail ?? "—"],
              ...(tender.clientContactPhone ? [["Contact Phone", tender.clientContactPhone]] : []),
              ...(tender.preBidChannel ? [["Pre-bid Channel", tender.preBidChannel]] : []),
              ...(tender.preBidMeetingDate ? [["Pre-bid Meeting", new Date(tender.preBidMeetingDate).toLocaleDateString() + (tender.preBidMeetingLocation ? ` — ${tender.preBidMeetingLocation}` : "")]] : []),
            ].map(([label, value]) => (
              <tr key={label} className="border-b border-slate-100">
                <td className="py-1.5 pr-4 font-medium text-slate-500 w-44 align-top">{label}</td>
                <td className="py-1.5 text-slate-800">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {/* ── AI Analysis summary ─────────────────────────────────────── */}
      {analysisSummary && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-bold uppercase tracking-wide text-slate-700 border-b border-slate-200 pb-1">
            AI Analysis Summary
          </h2>
          <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-line">
            {analysisSummary}
            {(tender.analysisSummary?.length ?? 0) > 1000 && (
              <span className="italic text-slate-400"> … (truncated)</span>
            )}
          </p>
        </section>
      )}

      {/* ── Requirements ────────────────────────────────────────────── */}
      {topRequirements.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-bold uppercase tracking-wide text-slate-700 border-b border-slate-200 pb-1">
            Requirements (top {topRequirements.length} of {tender.requirements.length})
          </h2>
          <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-800 text-white text-left">
                <th className="px-2 py-2 font-semibold w-28">Priority</th>
                <th className="px-2 py-2 font-semibold">Title</th>
                <th className="px-2 py-2 font-semibold w-36">Type</th>
              </tr>
            </thead>
            <tbody>
              {topRequirements.map((req, i) => (
                <tr key={req.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-2 py-1.5 border border-slate-100">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                      req.priority === "MANDATORY"
                        ? "bg-red-100 text-red-700"
                        : req.priority === "HIGH"
                          ? "bg-orange-100 text-orange-700"
                          : "bg-slate-100 text-slate-600"
                    }`}>
                      {req.priority ?? "—"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 border border-slate-100 text-slate-800">{req.title ?? "—"}</td>
                  <td className="px-2 py-1.5 border border-slate-100 text-slate-600">{req.requirementType ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}

      {/* ── Generated documents ─────────────────────────────────────── */}
      {tender.generatedDocuments.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-bold uppercase tracking-wide text-slate-700 border-b border-slate-200 pb-1">
            Generated Documents
          </h2>
          <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-800 text-white text-left">
                <th className="px-2 py-2 font-semibold">Document Type</th>
                <th className="px-2 py-2 font-semibold w-36">Generation Status</th>
                <th className="px-2 py-2 font-semibold w-36">Validation</th>
              </tr>
            </thead>
            <tbody>
              {tender.generatedDocuments.map((doc, i) => (
                <tr key={doc.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-2 py-1.5 border border-slate-100 text-slate-800">{doc.documentType ?? "—"}</td>
                  <td className="px-2 py-1.5 border border-slate-100">
                    <span className={statusBadge(doc.generationStatus ?? "")}>
                      {doc.generationStatus ?? "—"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 border border-slate-100">
                    <span className={statusBadge(doc.validationStatus ?? "")}>
                      {doc.validationStatus ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}

      {/* ── Open compliance gaps ─────────────────────────────────────── */}
      {tender.complianceGaps.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-bold uppercase tracking-wide text-slate-700 border-b border-slate-200 pb-1">
            Open Compliance Gaps ({tender.complianceGaps.length})
          </h2>
          <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-800 text-white text-left">
                <th className="px-2 py-2 font-semibold">Gap Title</th>
                <th className="px-2 py-2 font-semibold w-28">Severity</th>
              </tr>
            </thead>
            <tbody>
              {tender.complianceGaps.map((gap, i) => (
                <tr key={gap.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-2 py-1.5 border border-slate-100 text-slate-800">{gap.title ?? "—"}</td>
                  <td className="px-2 py-1.5 border border-slate-100">
                    <span className={severityBadge(gap.severity ?? "")}>
                      {gap.severity ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}

      {/* ── File extraction summary ──────────────────────────────────── */}
      {tender.files.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-bold uppercase tracking-wide text-slate-700 border-b border-slate-200 pb-1">
            File Extraction Summary
          </h2>
          <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-800 text-white text-left">
                <th className="px-2 py-2 font-semibold">File</th>
                <th className="px-2 py-2 font-semibold w-44 text-right">Pages Extracted / Total</th>
              </tr>
            </thead>
            <tbody>
              {tender.files.map((file, i) => {
                const extracted = file.extractedPages ?? "?";
                const total = file.totalPages ?? "?";
                const isComplete =
                  file.extractedPages != null &&
                  file.totalPages != null &&
                  file.extractedPages >= file.totalPages;
                return (
                  <tr key={file.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="px-2 py-1.5 border border-slate-100 text-slate-800 break-all">
                      {file.originalFileName ?? "—"}
                    </td>
                    <td className={`px-2 py-1.5 border border-slate-100 text-right font-mono text-xs ${
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

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="mt-10 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
        Generated by Hope Tender · {today}
      </footer>
    </div>
  );
}

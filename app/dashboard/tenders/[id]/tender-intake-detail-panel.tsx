// Auto-extracted tender detail panel.
//
// Shows every field inferTenderMetadata() captured from the uploaded
// tender body in a structured 2-column layout. Fields that came back
// empty are flagged as missing so the user knows what needs manual
// review before submission.
//
// Server component — pure presentation. The "Re-extract from PDF"
// button is a small client island.

import { ReExtractMetadataButton } from "./re-extract-button";

type TenderDetailLike = {
  id: string;
  reference?: string | null;
  clientName?: string | null;
  clientContactName?: string | null;
  clientContactTitle?: string | null;
  clientContactEmail?: string | null;
  clientContactPhone?: string | null;
  clientAddress?: string | null;
  country?: string | null;
  category?: string;
  budget?: number | null;
  currency?: string;
  deadline?: Date | string | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  pageLimit?: number | null;
  validityDays?: number | null;
  bidBondAmount?: number | null;
  bidBondCurrency?: string | null;
  preBidMeetingDate?: Date | string | null;
  preBidMeetingLocation?: string | null;
  mandatorySiteVisit?: boolean;
  numberOfCopiesRequired?: number | null;
  technicalWeight?: number | null;
  financialWeight?: number | null;
  description?: string | null;
  evaluationMethodology?: string | null;
  intakeSummary?: string | null;
  analysisSummary?: string | null;
};

function formatDeadline(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}

function fmtNumber(value: number | null | undefined, currency?: string | null): string | null {
  if (value === null || value === undefined) return null;
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return currency ? `${currency} ${formatted}` : formatted;
}

const MISSING_NOTE = "Not extracted — confirm manually";

export function TenderIntakeDetailPanel({ tender }: { tender: TenderDetailLike }) {
  const deadline = formatDeadline(tender.deadline);
  const preBid = formatDeadline(tender.preBidMeetingDate);
  const budget = fmtNumber(tender.budget, tender.currency);
  const bond = fmtNumber(tender.bidBondAmount, tender.bidBondCurrency);
  const emails = (tender.submissionEmails ?? "").split("|").filter(Boolean);
  const evaluation = tender.technicalWeight && tender.financialWeight
    ? `Technical ${tender.technicalWeight}% / Financial ${tender.financialWeight}%`
    : null;

  // Count how many fields were auto-filled vs need review
  const fields = [
    tender.reference, tender.clientName || (tender as Record<string, unknown>).procuringEntityName as string | null | undefined, tender.clientContactName, tender.clientContactEmail,
    tender.clientContactPhone, tender.clientAddress, tender.country, deadline, tender.submissionMethod,
    budget, tender.validityDays, bond, preBid, tender.numberOfCopiesRequired, tender.pageLimit,
    evaluation, tender.description, tender.evaluationMethodology, tender.intakeSummary, tender.analysisSummary,
  ];
  const filledCount = fields.filter((f) => f !== null && f !== undefined && f !== "").length;
  const totalCount = fields.length;

  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-slate-900">Tender Detail</h2>
          <p className="mt-1 text-xs text-slate-500">
            Auto-extracted from the uploaded tender body. Review each field before final submission.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-slate-500">Auto-fill coverage</div>
            <div className="text-lg font-bold text-slate-900">{filledCount} / {totalCount}</div>
          </div>
          <ReExtractMetadataButton tenderId={tender.id} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2 text-sm">
        <Detail label="Reference number" value={tender.reference} />
        <Detail label="Country" value={tender.country} />
        <Detail label="Client / Procuring entity" value={tender.clientName || (tender as Record<string, unknown>).procuringEntityName as string | null | undefined} />
        <Detail label="Client address" value={tender.clientAddress} />
        <Detail label="Client contact" value={tender.clientContactName ? `${tender.clientContactName}${tender.clientContactTitle ? ` — ${tender.clientContactTitle}` : ""}` : null} />
        <Detail label="Contact email" value={tender.clientContactEmail} />
        <Detail label="Contact phone" value={tender.clientContactPhone} />
        <Detail label="Submission method" value={tender.submissionMethod} />
        <Detail label="Submission address" value={tender.submissionAddress} />
        <Detail label="Submission emails" value={emails.length > 0 ? emails.join(", ") : null} />
        <Detail label="Deadline" value={deadline} />
        <Detail label="Pre-bid meeting" value={preBid || tender.preBidMeetingLocation} />
        <Detail label="Proposal validity" value={tender.validityDays ? `${tender.validityDays} days` : null} />
        <Detail label="Budget" value={budget} />
        <Detail label="Bid bond" value={bond} />
        <Detail label="Page limit" value={tender.pageLimit ? `${tender.pageLimit} pages` : null} />
        <Detail label="Copies required" value={tender.numberOfCopiesRequired ? `Original + ${tender.numberOfCopiesRequired}` : null} />
        <Detail label="Mandatory site visit" value={tender.mandatorySiteVisit ? "YES" : null} highlight={tender.mandatorySiteVisit} />
        <Detail label="Evaluation weights" value={evaluation} />
      </div>

      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        {tender.description && (
          <ProseBlock label="Description" value={tender.description} />
        )}
        {tender.evaluationMethodology
          ? <ProseBlock label="Evaluation methodology" value={tender.evaluationMethodology} />
          : (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Evaluation methodology</div>
              <p className="text-sm italic text-amber-700">Not extracted — re-extract from PDF or add manually. Required for scored proposals.</p>
            </div>
          )
        }
        {tender.intakeSummary && (
          <ProseBlock label="Intake summary" value={tender.intakeSummary} />
        )}
        {tender.analysisSummary && (
          <ProseBlock label="Analysis summary" value={tender.analysisSummary} />
        )}
      </div>
    </section>
  );
}

function Detail({ label, value, highlight }: { label: string; value: string | null | undefined; highlight?: boolean }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 pb-2">
      <div className="w-44 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`flex-1 text-sm ${empty ? "italic text-amber-700" : highlight ? "font-semibold text-amber-700" : "text-slate-800"}`}>
        {empty ? MISSING_NOTE : value}
      </div>
    </div>
  );
}

function ProseBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <p className="whitespace-pre-wrap text-sm text-slate-800 leading-relaxed">{value}</p>
    </div>
  );
}

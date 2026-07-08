// Compact auto-extracted tender detail panel.
// Shows submission-critical metadata first and hides secondary/long details behind
// dropdowns so the tender workspace stays short.

import { ReExtractMetadataButton } from "./re-extract-button";
import {
  isDisplayValidMetadataValue,
  normalizeMetadataDisplayValue,
  NOT_EXTRACTED,
  type MetadataFieldKey,
} from "../../../../lib/engine/metadata-display-sanitizer";
import {
  deriveSourceDrivenTenderDetail,
  type SourceDrivenTenderFact,
} from "../../../../lib/engine/source-driven-tender-detail";

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

const MISSING_NOTE = NOT_EXTRACTED;

// Sanitize a value for display: returns "Not extracted" for invalid values
function sanitize(fieldKey: MetadataFieldKey, value: unknown): string {
  if (isDisplayValidMetadataValue(fieldKey, value)) {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value).trim();
  }
  return NOT_EXTRACTED;
}

export function TenderIntakeDetailPanel({ tender }: { tender: TenderDetailLike }) {
  const deadline = formatDeadline(tender.deadline);
  const preBid = formatDeadline(tender.preBidMeetingDate);
  const budget = fmtNumber(tender.budget, tender.currency);
  const bond = fmtNumber(tender.bidBondAmount, tender.bidBondCurrency);
  const emails = (tender.submissionEmails ?? "").split("|").filter(Boolean);
  const evaluation = tender.technicalWeight && tender.financialWeight
    ? `Technical ${tender.technicalWeight}% / Financial ${tender.financialWeight}%`
    : null;
  const client = tender.clientName || (tender as Record<string, unknown>).procuringEntityName as string | null | undefined;

  // Sanitize all metadata values — only display-valid values count
  // toward auto-fill coverage
  const sReference = sanitize("reference", tender.reference);
  const sClient = sanitize("clientName", client);
  const sContactName = sanitize("clientContactName", tender.clientContactName);
  const sContactEmail = sanitize("clientContactEmail", tender.clientContactEmail);
  const sContactPhone = sanitize("clientContactPhone", tender.clientContactPhone);
  const sAddress = sanitize("clientAddress", tender.clientAddress);
  const sCountry = sanitize("country", tender.country);
  const sDeadline = sanitize("deadline", deadline);
  const sMethod = sanitize("submissionMethod", tender.submissionMethod);
  const sEmails = sanitize("submissionEmails", tender.submissionEmails);
  const sSubAddress = sanitize("submissionAddress", tender.submissionAddress);
  const sPreBid = sanitize("preBidMeetingDate", preBid);
  const sPreBidLoc = sanitize("preBidMeetingLocation", tender.preBidMeetingLocation);
  const sBudget = sanitize("budget", budget);
  const sBond = sanitize("bidBondAmount", bond);
  const sPageLimit = sanitize("pageLimit", tender.pageLimit);
  const sValidity = sanitize("validityDays", tender.validityDays);
  const sCopies = sanitize("numberOfCopiesRequired", tender.numberOfCopiesRequired);
  const sEvaluation = sanitize("technicalWeight", evaluation);
  const sDesc = sanitize("description", tender.description);
  const sEvalMethod = sanitize("evaluationMethodology", tender.evaluationMethodology);

  // Derive source-driven tender detail from raw tender columns
  const sourceDetail = deriveSourceDrivenTenderDetail(tender as Record<string, unknown>);

  // Coverage = valid extracted facts / facts detected or relevant for this tender
  // Does not penalize the tender for not containing facts it never needed
  const filledCount = sourceDetail.extractedCount;
  const totalCount = sourceDetail.extractedCount + sourceDetail.missingRelevantCount;

  return (
    <section id="tender-edit-form" className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-slate-900">Tender Detail</h2>
          <p className="mt-1 text-xs text-slate-500">Facts extracted from this tender source. Missing optional details do not block draft generation.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-slate-500">Auto-fill coverage</div>
            <div className="text-lg font-bold text-slate-900">{filledCount} / {totalCount}</div>
          </div>
          <ReExtractMetadataButton tenderId={tender.id} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
        <Detail label="Reference number" value={sReference} />
        <Detail label="Country" value={sCountry} />
        <Detail label="Client / Procuring entity" value={sClient} />
        <Detail label="Deadline" value={sDeadline} />
        <Detail label="Submission method" value={sMethod} />
        <Detail label="Submission emails" value={sEmails} />
      </div>

      <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Show all extracted metadata</summary>
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 bg-white p-3 text-sm md:grid-cols-2">
          <Detail label="Client address" value={sAddress} />
          <Detail label="Client contact" value={sContactName} />
          <Detail label="Contact email" value={sContactEmail} />
          <Detail label="Contact phone" value={sContactPhone} />
          <Detail label="Submission address" value={sSubAddress} />
          <Detail label="Pre-bid meeting" value={sPreBid !== NOT_EXTRACTED ? sPreBid : (sPreBidLoc !== NOT_EXTRACTED ? sPreBidLoc : NOT_EXTRACTED)} />
          <Detail label="Proposal validity" value={sValidity !== NOT_EXTRACTED ? `${sValidity} days` : NOT_EXTRACTED} />
          <Detail label="Budget" value={sBudget} />
          <Detail label="Bid bond" value={sBond} />
          <Detail label="Page limit" value={sPageLimit !== NOT_EXTRACTED ? `${sPageLimit} pages` : NOT_EXTRACTED} />
          <Detail label="Copies required" value={sCopies !== NOT_EXTRACTED ? `Original + ${sCopies}` : NOT_EXTRACTED} />
          <Detail label="Mandatory site visit" value={tender.mandatorySiteVisit ? "YES" : NOT_EXTRACTED} highlight={tender.mandatorySiteVisit} />
          <Detail label="Evaluation weights" value={sEvaluation} />
        </div>
      </details>

      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
        {tender.description && <ProseBlock label="Description" value={tender.description} />}
        {tender.evaluationMethodology ? (
          <ProseBlock label="Evaluation methodology" value={tender.evaluationMethodology} />
        ) : (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Evaluation methodology</div>
            <p className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-xs italic text-amber-700">Not extracted — re-extract from PDF or add manually.</p>
          </div>
        )}
        {tender.intakeSummary && <ProseBlock label="Intake summary" value={tender.intakeSummary} />}
        {tender.analysisSummary && <ProseBlock label="Analysis summary" value={tender.analysisSummary} />}
      </div>
    </section>
  );
}

function Detail({ label, value, highlight }: { label: string; value: string | null | undefined; highlight?: boolean }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 pb-2">
      <div className="w-44 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`flex-1 text-sm ${empty ? "text-amber-700" : highlight ? "font-semibold text-amber-700" : "text-slate-800"}`}>
        {empty ? <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs italic">{MISSING_NOTE}</span> : value}
      </div>
    </div>
  );
}

function ProseBlock({ label, value }: { label: string; value: string }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</summary>
      <p className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-sm leading-relaxed text-slate-800">{value}</p>
    </details>
  );
}

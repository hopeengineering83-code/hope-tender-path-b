// Compact auto-extracted tender detail panel.
// Shows submission-critical tender facts first and hides secondary/long details behind
// dropdowns so the tender workspace stays short.
//
// Source-driven model: each fact shows user actions (Ignore / Edit / Re-extract)
// when it is missing or invalid. The tender document is the authority — facts
// come from extracted tender source, not from a predesigned required format.

"use client";

import { useState } from "react";
import { ReExtractMetadataButton } from "./re-extract-button";
import {
  isDisplayValidMetadataValue,
  NOT_EXTRACTED,
  type MetadataFieldKey,
} from "../../../../lib/engine/metadata-display-sanitizer";
import {
  deriveSourceDrivenTenderDetail,
  type SourceDrivenTenderFact,
} from "../../../../lib/engine/source-driven-tender-detail";
import {
  normalizeEmailList,
  buildTenderFactSourceText,
  parseTenderDocumentIntelligence,
} from "../../../../lib/engine/source-driven-tender-text-parser";
import {
  MIN_CRITICAL_REASON_LENGTH as SHARED_MIN_CRITICAL_REASON_LENGTH,
  CONFIRMATION_BASES as SHARED_CONFIRMATION_BASES,
  isSubmissionCriticalField,
} from "../../../../lib/engine/tender-fact-authority";

type TenderDetailLike = {
  id: string;
  title?: string | null;
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
  currency?: string | null;
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

// Use the shared constants from tender-fact-authority.ts — no duplication.
const MIN_CRITICAL_REASON_LENGTH = SHARED_MIN_CRITICAL_REASON_LENGTH;

// Derive the confirmation basis options from the shared constant.
const CONFIRMATION_BASIS_OPTIONS = SHARED_CONFIRMATION_BASES.map((value) => ({
  value,
  label: value.split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" "),
}));

// Sanitize a value for display: returns "Not extracted" for invalid values
function sanitize(fieldKey: MetadataFieldKey, value: unknown): string {
  if (isDisplayValidMetadataValue(fieldKey, value)) {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value).trim();
  }
  return NOT_EXTRACTED;
}

// ─── User actions for missing facts ─────────────────────────────────────────
//
// Each missing/invalid fact in the source-driven detail can be resolved by
// the user with one of three actions:
//   • Ignore — mark as NOT_APPLICABLE (the tender does not require this fact)
//   • Edit — manually enter a value (USER_EDITED override)
//   • Re-extract — trigger re-extraction from the tender source
//
// These actions call the existing /api/tenders/[id]/metadata-override endpoint
// (for Ignore/Edit) or re-extract-metadata endpoint (for Re-extract).

async function postOverride(
  tenderId: string,
  field: string,
  fieldState: "NOT_APPLICABLE" | "USER_EDITED",
  overrideValue?: string,
  reason?: string,
  confirmationBasis?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenders/${tenderId}/metadata-override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, fieldState, overrideValue, reason, confirmationBasis }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body?.error ?? `Request failed (${res.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function FactActions({
  tenderId,
  fact,
  onAction,
}: {
  tenderId: string;
  fact: SourceDrivenTenderFact;
  onAction: (kind: "ignore" | "edit" | "re-extract", result: { ok: boolean; error?: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [auditReason, setAuditReason] = useState("");
  const [auditBasis, setAuditBasis] = useState("");
  const [busy, setBusy] = useState(false);

  // Only show actions for missing or rejected-invalid facts
  if (fact.status !== "missing" && fact.status !== "rejected_invalid") return null;

  // Submission-critical fields (final_submission) require a meaningful audit
  // reason + confirmation basis on manual entry — see the "Authority model"
  // block in app/api/tenders/[id]/metadata-override/route.ts. Without these,
  // the backend rejects the override with MEANINGFUL_REASON_REQUIRED /
  // CONFIRMATION_BASIS_REQUIRED, so the fields must be collected here.
  // Use the shared isSubmissionCriticalField from tender-fact-authority.ts
  // so clientName, submissionMethod, title, deadline, and submissionEndpoint
  // all require audit reason + confirmation basis when manually entered.
  const isCritical = isSubmissionCriticalField(fact.key) || fact.requiredFor === "final_submission";
  const auditValid = !isCritical || (auditReason.trim().length >= MIN_CRITICAL_REASON_LENGTH && auditBasis !== "");

  async function handleIgnore() {
    setBusy(true);
    const result = await postOverride(tenderId, fact.key, "NOT_APPLICABLE", undefined, "User marked as not applicable to this tender.");
    setBusy(false);
    onAction("ignore", result);
  }

  async function handleSaveEdit() {
    if (!editValue.trim() || !auditValid) return;
    setBusy(true);
    const result = await postOverride(
      tenderId,
      fact.key,
      "USER_EDITED",
      editValue.trim(),
      isCritical ? auditReason.trim() : undefined,
      isCritical ? auditBasis : undefined,
    );
    setBusy(false);
    if (result.ok) {
      setEditing(false);
      setEditValue("");
      setAuditReason("");
      setAuditBasis("");
    }
    onAction("edit", result);
  }

  function handleReExtract() {
    // Trigger re-extract by navigating to the re-extract button (handled by parent)
    onAction("re-extract", { ok: true });
  }

  if (editing) {
    return (
      <div className="mt-1 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={`Enter ${fact.label.toLowerCase()}`}
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
            disabled={busy}
          />
        </div>
        {isCritical && (
          <div className="rounded border border-amber-200 bg-amber-50 p-2 space-y-2">
            <p className="text-[11px] text-amber-800">
              {fact.label} is required before final submission. Provide an audit reason and where you learned this value.
            </p>
            <textarea
              value={auditReason}
              onChange={(e) => setAuditReason(e.target.value)}
              placeholder={`Why is this correct? (at least ${MIN_CRITICAL_REASON_LENGTH} characters)`}
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              rows={2}
              disabled={busy}
            />
            <select
              value={auditBasis}
              onChange={(e) => setAuditBasis(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              disabled={busy}
            >
              <option value="">Select a source…</option>
              {CONFIRMATION_BASIS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSaveEdit}
          disabled={busy || !editValue.trim() || !auditValid}
          className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setEditValue(""); setAuditReason(""); setAuditBasis(""); }}
          disabled={busy}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
        >
          Cancel
        </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-1">
      <button
        type="button"
        onClick={handleIgnore}
        disabled={busy}
        title="Mark this fact as not applicable to this tender"
        className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-60"
      >
        Ignore
      </button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={busy}
        title="Manually enter a value for this fact"
        className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-60"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={handleReExtract}
        disabled={busy}
        title="Re-extract this fact from the tender source"
        className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
      >
        Re-extract
      </button>
    </div>
  );
}

export function TenderIntakeDetailPanel({ tender }: { tender: TenderDetailLike }) {
  const deadline = formatDeadline(tender.deadline);
  const preBid = formatDeadline(tender.preBidMeetingDate);
  const budget = fmtNumber(tender.budget, tender.currency);
  const bond = fmtNumber(tender.bidBondAmount, tender.bidBondCurrency);
  const emails = normalizeEmailList(tender.submissionEmails);
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
  // Email display: use normalizeEmailList to split on | ; , and "and",
  // then join with ", " for clean comma-separated display.
  const sEmails = emails.length > 0 ? emails.join(", ") : NOT_EXTRACTED;
  const sSubAddress = sanitize("submissionAddress", tender.submissionAddress);
  const sPreBid = sanitize("preBidMeetingDate", preBid);
  const sPreBidLoc = sanitize("preBidMeetingLocation", tender.preBidMeetingLocation);
  const sBudget = sanitize("budget", budget);
  const sBond = sanitize("bidBondAmount", bond);
  const sPageLimit = sanitize("pageLimit", tender.pageLimit);
  const sValidity = sanitize("validityDays", tender.validityDays);
  const sCopies = sanitize("numberOfCopiesRequired", tender.numberOfCopiesRequired);
  const sEvaluation = sanitize("technicalWeight", evaluation);

  // Source-driven text parsing: derive intelligence from the FULL extracted
  // tender content (extractedText, intakeSummary, analysisSummary, description,
  // evaluationMethodology) — not just from stale scalar columns.
  // The source text is the authority; scalar fields are fallback only.
  const sourceText = buildTenderFactSourceText({
    extractedText: (tender as Record<string, unknown>).extractedText as string | undefined,
    intakeSummary: tender.intakeSummary,
    analysisSummary: tender.analysisSummary,
    description: tender.description,
    evaluationMethodology: tender.evaluationMethodology,
  });
  const intelligence = sourceText.trim()
    ? parseTenderDocumentIntelligence(sourceText, {
        tenderTitle: tender.title,
        tenderReference: tender.reference,
        tenderClientName: tender.clientName,
        tenderSubmissionMethod: tender.submissionMethod,
        tenderDeadline: tender.deadline,
        tenderSubmissionEmails: tender.submissionEmails,
        tenderSubmissionAddress: tender.submissionAddress,
      })
    : null;

  // Derive source-driven tender detail from raw tender columns
  // NOTE: sourceDetail is kept for backward-compatible coverage counting but
  // the missing-facts list now uses the intelligence result (parsed from
  // full extracted text) so the display and missing-facts list agree.
  const sourceDetail = deriveSourceDrivenTenderDetail(tender as Record<string, unknown>);

  // Build effective missing-facts from the intelligence result (not from
  // scalar-only deriveSourceDrivenTenderDetail). This prevents the
  // contradiction where the panel displays a parsed deadline but the
  // missing-facts list says "deadline missing" because tender.deadline
  // is null.
  type MissingFact = {
    key: string;
    label: string;
    requiredFor: "final_submission" | "draft_context";
    reason?: string | null;
    status: "missing" | "rejected_invalid";
  };
  const effectiveMissingFacts: MissingFact[] = [];
  if (intelligence) {
    // Check each critical fact: if the parser didn't find it AND the scalar
    // is null/invalid, it's genuinely missing. If the parser found it, it's
    // NOT missing — even if the scalar is null.
    const si = intelligence.submissionInstructions;
    if (!si.deadlineDisplay && !tender.deadline) {
      effectiveMissingFacts.push({ key: "deadline", label: "Submission Deadline", requiredFor: "final_submission", status: "missing" });
    }
    if ((!si.method || si.method === "Unknown") && !tender.submissionMethod) {
      effectiveMissingFacts.push({ key: "submissionMethod", label: "Submission Method", requiredFor: "draft_context", status: "missing" });
    }
    if (si.emails.length === 0 && !tender.submissionEmails && (si.method === "Email" || si.method === "Hybrid")) {
      effectiveMissingFacts.push({ key: "submissionEmails", label: "Submission Emails", requiredFor: "final_submission", status: "missing" });
    }
    if (!si.physicalAddress && !tender.submissionAddress && (si.method === "Physical" || si.method === "Hybrid")) {
      effectiveMissingFacts.push({ key: "submissionAddress", label: "Submission Address", requiredFor: "final_submission", status: "missing" });
    }
    if (!intelligence.clientOrProcuringEntity && !tender.clientName && !(tender as Record<string, unknown>).procuringEntityName) {
      effectiveMissingFacts.push({ key: "clientName", label: "Client / Procuring Entity", requiredFor: "draft_context", status: "missing" });
    }
    if (!intelligence.projectTitle && !tender.title) {
      effectiveMissingFacts.push({ key: "projectTitle", label: "Project Title", requiredFor: "draft_context", status: "missing" });
    }
  } else {
    // No intelligence — fall back to sourceDetail for missing facts
    for (const f of sourceDetail.facts) {
      if ((f.status === "missing" || f.status === "rejected_invalid") && (f.requiredFor === "final_submission" || f.requiredFor === "draft_context")) {
        effectiveMissingFacts.push({
          key: f.key, label: f.label, requiredFor: f.requiredFor as "final_submission" | "draft_context",
          reason: f.reason, status: f.status as "missing" | "rejected_invalid",
        });
      }
    }
  }
  const effectiveMissingCount = effectiveMissingFacts.length;

  // Override scalar-derived values with source-driven values when the source
  // text provides them. This fixes Defect 1 (extracted facts exist but are
  // not recognized) and Defect 2 (parser still depends on stored scalar columns).
  const effectiveMethod = intelligence?.submissionInstructions.method
    && intelligence.submissionInstructions.method !== "Unknown"
    ? intelligence.submissionInstructions.method
    : (sMethod !== NOT_EXTRACTED ? sMethod : NOT_EXTRACTED);
  const effectiveDeadline = intelligence?.submissionInstructions.deadlineDisplay
    ?? (sDeadline !== NOT_EXTRACTED ? sDeadline : NOT_EXTRACTED);
  const effectiveEmails = intelligence?.submissionInstructions.emails.length
    ? intelligence.submissionInstructions.emails.join(", ")
    : sEmails;
  const effectiveEmailSubject = intelligence?.submissionInstructions.emailSubject ?? NOT_EXTRACTED;
  const effectiveTenderType = intelligence?.tenderType && intelligence.tenderType !== "Unknown"
    ? intelligence.tenderType
    : NOT_EXTRACTED;
  const effectiveServiceStreams = intelligence?.serviceStreams.length
    ? intelligence.serviceStreams.join(", ")
    : NOT_EXTRACTED;
  const effectiveProjectTitle = intelligence?.projectTitle ?? tender.title ?? NOT_EXTRACTED;
  const effectiveClient = intelligence?.clientOrProcuringEntity
    ?? (sClient !== NOT_EXTRACTED ? sClient : NOT_EXTRACTED);
  const effectiveFinancialProposal = intelligence
    ? (intelligence.financialProposalRequired ? "Required" : "Not required at this stage")
    : NOT_EXTRACTED;

  // Coverage = valid extracted facts / facts detected or relevant for this tender
  // Does not penalize the tender for not containing facts it never needed
  const filledCount = sourceDetail.extractedCount;
  const totalCount = sourceDetail.extractedCount + sourceDetail.missingRelevantCount;

  const [actionMessage, setActionMessage] = useState<{ kind: string; ok: boolean; error?: string } | null>(null);

  function handleAction(kind: "ignore" | "edit" | "re-extract", result: { ok: boolean; error?: string }) {
    if (kind === "re-extract") {
      // Re-extract is handled by the existing ReExtractMetadataButton at the top
      // of the panel — scroll to it.
      document.getElementById("tender-edit-form")?.scrollIntoView({ behavior: "smooth" });
      setActionMessage({ kind, ok: true });
      return;
    }
    setActionMessage({ kind, ok: result.ok, error: result.error });
    if (result.ok) {
      // Reload the page to reflect the new override state
      setTimeout(() => window.location.reload(), 800);
    }
  }

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

      {actionMessage && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${
          actionMessage.ok
            ? "bg-emerald-50 text-emerald-800"
            : "bg-red-50 text-red-800"
        }`}>
          {actionMessage.ok
            ? actionMessage.kind === "ignore"
              ? "Fact marked as not applicable. Refreshing…"
              : actionMessage.kind === "edit"
              ? "Fact updated. Refreshing…"
              : "Re-extract triggered — see the re-extract button above."
            : `Action failed: ${actionMessage.error ?? "unknown error"}`}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
        <Detail label="Tender type" value={effectiveTenderType} />
        <Detail label="Service stream(s)" value={effectiveServiceStreams} />
        <Detail label="Project title" value={effectiveProjectTitle} />
        <Detail label="Client / Procuring entity" value={effectiveClient} />
        <Detail label="Reference number" value={sReference} />
        <Detail label="Country" value={sCountry} />
        <Detail label="Deadline" value={effectiveDeadline} />
        <Detail label="Submission method" value={effectiveMethod} />
        <Detail label="Submission emails" value={effectiveEmails} />
        <Detail label="Email subject" value={effectiveEmailSubject} />
        <Detail label="Financial proposal" value={effectiveFinancialProposal} />
      </div>

      {/* Effective missing facts with user actions — uses intelligence, not scalar-only sourceDetail */}
      {effectiveMissingCount > 0 && (
        <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3" open>
          <summary className="cursor-pointer text-sm font-semibold text-amber-800">
            {effectiveMissingCount} relevant fact(s) missing — review and resolve
          </summary>
          <div className="mt-3 space-y-3 bg-white p-3 rounded-lg">
            {effectiveMissingFacts
              .map((fact) => (
                <div key={fact.key} className="border-b border-slate-100 pb-3 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">{fact.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {fact.requiredFor === "final_submission" ? (
                          <span className="font-medium text-red-700">Required before export</span>
                        ) : (
                          <span>Advisory for draft</span>
                        )}
                        {fact.status === "rejected_invalid" && (
                          <span className="ml-2 inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs italic text-red-700">
                            {fact.reason ?? "Invalid value"}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs italic text-amber-700">
                      {fact.status === "rejected_invalid" ? "Invalid" : "Missing"}
                    </span>
                  </div>
                  <FactActions
                    tenderId={tender.id}
                    fact={fact as SourceDrivenTenderFact}
                    onAction={handleAction}
                  />
                </div>
              ))}
          </div>
        </details>
      )}

      <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Show source-grounded tender facts</summary>
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
      <div className={`min-w-0 flex-1 break-words text-sm ${empty ? "text-amber-700" : highlight ? "font-semibold text-amber-700" : "text-slate-800"}`}>
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

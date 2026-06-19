"use client";

import { useEffect, useState } from "react";

type Override = { field: string; fieldState: string; overrideValue: string | null };
type SourceInfo = { page: number | null; quote: string | null; fileName: string | null; label?: string | null };
type Row = { key: string; field: string; label: string; group: string; critical: boolean; value: string | null; status: string; source: SourceInfo | null };

type TenderPayload = Record<string, unknown> & {
  files?: Array<{ id: string; originalFileName?: string | null; fileName?: string | null }>;
  requirements?: Array<{ sourceTenderFileId?: string | null; sourcePageNumber?: number | null; sourceExactQuote?: string | null; sourceSectionHeading?: string | null; title?: string | null }>;
  metadataContaminated?: boolean | null;
};

const SPECS = [
  ["title", "title", "Tender title", "Tender", "1", "title"],
  ["evaluationCriteria", "evaluationCriteria", "Evaluation criteria / scoring", "Tender", "", "evaluationMethodology"],
  ["requiredDocuments", "requiredDocuments", "Required documents / forms", "Tender", "1", "exactFileNaming,exactFileOrder"],
  ["procuringEntityName", "clientName", "Procuring entity / client name", "Client", "1", "procuringEntityName,clientName"],
  ["legalClientName", "legalClientName", "Legal client name", "Client", "", "legalClientName"],
  ["donorAgency", "donorAgency", "Donor / funding agency", "Client", "", "donorAgency"],
  ["implementingAgency", "implementingAgency", "Implementing agency", "Client", "", "implementingAgency"],
  ["reference", "reference", "Procurement / reference number", "Client", "", "reference"],
  ["country", "country", "Country", "Client", "", "country"],
  ["clientCity", "clientCity", "City / location", "Client", "", "clientCity"],
  ["clientAddress", "clientAddress", "Client address", "Client", "", "clientAddress"],
  ["clientWebsite", "clientWebsite", "Client website / portal", "Client", "", "clientWebsite"],
  ["clientContactName", "clientContactName", "Contact person", "Client", "", "clientContactName"],
  ["clientContactTitle", "clientContactTitle", "Contact title", "Client", "", "clientContactTitle"],
  ["clientContactEmail", "clientContactEmail", "Contact email", "Client", "", "clientContactEmail"],
  ["clientContactPhone", "clientContactPhone", "Contact phone", "Client", "", "clientContactPhone"],
  ["clientRepresentative", "clientRepresentative", "Client representative", "Client", "", "clientRepresentative"],
  ["submissionMethod", "submissionMethod", "Submission method", "Submission", "1", "submissionMethod"],
  ["deadline", "deadline", "Submission deadline", "Submission", "1", "deadline"],
  ["submissionAddress", "submissionAddress", "Submission address / portal", "Submission", "1", "submissionAddress"],
  ["submissionEmails", "submissionEmails", "Submission email(s)", "Submission", "1", "submissionEmails"],
  ["submissionEmailSubject", "submissionEmailSubject", "Submission email subject", "Submission", "", "submissionEmailSubject"],
  ["preBidChannel", "preBidChannel", "Pre-bid channel", "Pre-bid", "", "preBidChannel"],
  ["preBidMeetingDate", "preBidMeetingDate", "Pre-bid meeting date", "Pre-bid", "", "preBidMeetingDate"],
  ["preBidMeetingLocation", "preBidMeetingLocation", "Pre-bid meeting location", "Pre-bid", "", "preBidMeetingLocation"],
] as const;

const badge: Record<string, string> = {
  EXTRACTED: "bg-green-50 text-green-700 border-green-200",
  MISSING_SOURCE: "bg-amber-50 text-amber-700 border-amber-200",
  MANUAL_REQUIRED: "bg-red-50 text-red-700 border-red-200",
  MANUALLY_SET: "bg-blue-50 text-blue-700 border-blue-200",
  IGNORED_FOR_THIS_TENDER: "bg-slate-50 text-slate-600 border-slate-200",
  NOT_APPLICABLE: "bg-slate-50 text-slate-600 border-slate-200",
  RETRY_ON_NEXT_ANALYZE: "bg-purple-50 text-purple-700 border-purple-200",
};

function pick(tender: Record<string, unknown>, keys: string) {
  for (const key of keys.split(",")) {
    const value = tender[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value != null && typeof value !== "object") return String(value);
  }
  return null;
}

function status(o: Override | undefined, value: string | null, critical: boolean) {
  if (o?.fieldState === "USER_EDITED") return "MANUALLY_SET";
  if (o?.fieldState === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (o?.fieldState === "IGNORED_WITH_REASON") return "IGNORED_FOR_THIS_TENDER";
  if (o?.fieldState === "MISSING") return "RETRY_ON_NEXT_ANALYZE";
  if (o?.fieldState === "USER_CONFIRMED") return value ? "EXTRACTED" : "MISSING_SOURCE";
  if (value) return "EXTRACTED";
  return critical ? "MANUAL_REQUIRED" : "MISSING_SOURCE";
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : [];
  } catch {
    return [];
  }
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeQuote(value: unknown): string | null {
  const quote = str(value);
  if (!quote) return null;
  return quote.replace(/\s+/g, " ").trim();
}

function fileNameFor(tender: TenderPayload, fileId: unknown): string | null {
  const id = str(fileId);
  if (!id) return null;
  const file = tender.files?.find((f) => f.id === id);
  return file?.originalFileName || file?.fileName || null;
}

function sourceFromObject(tender: TenderPayload, raw: unknown): SourceInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const page = num(item.page) ?? num(item.sourcePage) ?? num(item.sourcePageNumber);
  const quote = normalizeQuote(item.quote ?? item.sourceQuote ?? item.sourceExactQuote ?? item.snippet);
  const fileName = fileNameFor(tender, item.sourceTenderFileId ?? item.tenderFileId ?? item.fileId) ?? str(item.fileName);
  if (page == null && !quote && !fileName) return null;
  return { page, quote, fileName, label: str(item.sectionHeading ?? item.sourceSectionHeading ?? item.section) };
}

function sourceForField(tender: TenderPayload, field: string): SourceInfo | null {
  const contactSources = parseJsonObject(tender.contactDetailsSourceJson);
  const contactSource = sourceFromObject(tender, contactSources[field]);
  if (contactSource) return contactSource;

  if (field === "clientName") {
    const page = num(tender.clientNameSourcePage);
    const quote = normalizeQuote(tender.clientNameSourceQuote);
    return page != null || quote ? { page, quote, fileName: null } : null;
  }
  if (field === "submissionEmails") {
    const page = num(tender.submissionEmailSourcePage);
    const contactEmailSource = sourceFromObject(tender, contactSources.clientContactEmail);
    return page != null ? { page, quote: contactEmailSource?.quote ?? null, fileName: contactEmailSource?.fileName ?? null } : contactEmailSource;
  }
  if (field === "submissionMethod") {
    const page = num(tender.submissionMethodSourcePage);
    const quote = normalizeQuote(tender.submissionMethodSourceQuote);
    return page != null || quote ? { page, quote, fileName: null } : null;
  }
  if (field === "submissionAddress") {
    const page = num(tender.submissionAddressSourcePage);
    const quote = normalizeQuote(tender.submissionAddressSourceQuote);
    return page != null || quote ? { page, quote, fileName: null } : null;
  }
  if (field === "evaluationCriteria") {
    const first = parseJsonArray(tender.evaluationCriteriaSourceJson).find((item) => item.sourcePage || item.sourcePageNumber || item.sourceQuote || item.quote);
    const source = sourceFromObject(tender, first);
    return source ? { ...source, label: source.label ?? "Evaluation criteria" } : null;
  }
  if (field === "requiredDocuments") {
    const req = tender.requirements?.find((r) => r.sourcePageNumber || r.sourceExactQuote || r.sourceTenderFileId);
    if (!req) return null;
    return {
      page: req.sourcePageNumber ?? null,
      quote: normalizeQuote(req.sourceExactQuote),
      fileName: fileNameFor(tender, req.sourceTenderFileId),
      label: req.sourceSectionHeading ?? req.title ?? "Requirement source",
    };
  }
  if (field === "country") return sourceFromObject(tender, contactSources.country);
  if (field === "clientAddress") return sourceFromObject(tender, contactSources.clientAddress);
  if (field === "clientContactName") return sourceFromObject(tender, contactSources.clientContactName);
  if (field === "clientContactTitle") return sourceFromObject(tender, contactSources.clientContactTitle);
  if (field === "clientContactEmail") return sourceFromObject(tender, contactSources.clientContactEmail);
  if (field === "clientContactPhone") return sourceFromObject(tender, contactSources.clientContactPhone);
  return null;
}

function buildRows(tender: TenderPayload, overrides: Override[]) {
  const byField = new Map(overrides.map((o) => [o.field, o]));
  return SPECS.map(([key, field, label, group, criticalFlag, keys]) => {
    const o = byField.get(field);
    const stored = pick(tender, keys);
    const value = o?.fieldState === "USER_EDITED" && o.overrideValue ? o.overrideValue : stored;
    const rowStatus = status(o, value, criticalFlag === "1");
    const source = rowStatus === "EXTRACTED" ? sourceForField(tender, field) : null;
    return { key, field, label, group, critical: criticalFlag === "1", value, status: rowStatus, source };
  });
}

function SourceTrace({ source }: { source: SourceInfo | null }) {
  if (!source) {
    return (
      <p className="mt-1 text-[11px] text-amber-700">
        Source not recorded. Re-run AI Analyze if page/quote proof is required for this field.
      </p>
    );
  }
  const shortQuote = source.quote ? source.quote.slice(0, 180) : null;
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
      <div className="flex flex-wrap gap-2 font-medium text-slate-700">
        <span>Source:</span>
        <span>{source.page != null ? `Page ${source.page}` : "Page not recorded"}</span>
        {source.fileName && <span>• {source.fileName}</span>}
        {source.label && <span>• {source.label}</span>}
      </div>
      {shortQuote ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-blue-700 hover:text-blue-900">View source quote</summary>
          <blockquote className="mt-1 border-l-2 border-slate-200 pl-2 italic text-slate-600">
            “{source.quote}”
          </blockquote>
        </details>
      ) : (
        <p className="mt-1 text-slate-400">Source quote not recorded.</p>
      )}
    </div>
  );
}

export function ClientSubmissionDetailsPanel({ tenderId }: { tenderId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [tender, setTender] = useState<TenderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [tenderRes, overrideRes] = await Promise.all([fetch(`/api/tenders/${tenderId}`, { cache: "no-store" }), fetch(`/api/tenders/${tenderId}/metadata-override`, { cache: "no-store" })]);
      const tenderData = await tenderRes.json();
      if (!tenderRes.ok) throw new Error(tenderData.error || "Failed to load tender");
      const overrideJson = await overrideRes.json().catch(() => ({}));
      setTender(tenderData);
      setRows(buildRows(tenderData, overrideRes.ok && Array.isArray(overrideJson.overrides) ? overrideJson.overrides : []));
      setMessage(overrideRes.ok ? "" : "Manual resolution storage is not ready; extracted values are still visible.");
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load client details"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tenderId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(row: Row, action: string) {
    let fieldState = "USER_CONFIRMED";
    let overrideValue: string | null = null;
    let reason = "Confirmed from Client & Submission Details panel.";
    if (action === "EDIT_MANUALLY") { const value = window.prompt(`Enter ${row.label}`, row.value || "")?.trim(); if (!value) return; fieldState = "USER_EDITED"; overrideValue = value; reason = "Manual value entered by user."; }
    if (action === "IGNORE_FOR_THIS_TENDER") { fieldState = "IGNORED_WITH_REASON"; reason = "Ignored for this tender by user."; }
    if (action === "MARK_NOT_APPLICABLE") { fieldState = "NOT_APPLICABLE"; reason = "Marked not applicable by user."; }
    if (action === "RETRY_ON_NEXT_ANALYZE") { fieldState = "MISSING"; reason = "Retry requested for next AI Analyze."; }
    if (action === "MARK_NOT_FOUND") { fieldState = "IGNORED_WITH_REASON"; reason = "User confirmed this detail was not found in the tender and should not block this tender."; }
    setSaving(row.key); setError("");
    try {
      const res = await fetch(`/api/tenders/${tenderId}/metadata-override`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: row.field, fieldState, overrideValue, previousValue: row.value, reason }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || "Failed to save client detail");
      setMessage(`${row.label} saved.`); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to save client detail"); }
    finally { setSaving(null); }
  }

  const criticalOpen = rows.filter((r) => r.critical && ["MISSING_SOURCE", "MANUAL_REQUIRED"].includes(r.status)).length;
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-base font-semibold text-slate-900">Client &amp; Submission Details</h2><p className="mt-1 text-xs leading-5 text-slate-600">Some tender details may not be in every EOI, RFP, RFI, RFQ, or short invitation. Edit manually, mark not found, ignore, or mark not applicable. Missing optional details will not stop document generation.</p></div><button type="button" onClick={load} disabled={loading} className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{loading ? "Refreshing…" : "Refresh"}</button></div>
    {tender?.metadataContaminated === true && <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"><span className="font-semibold block mb-1">⚠ Client Metadata Contaminated:</span> The extracted client/procuring entity details appear to contain portal navigation text, headers, or unrelated tender information. <strong>This blocks final document generation and export</strong> until corrected. Edit manually or mark not found to resolve.</div>}
    {criticalOpen > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><span className="font-semibold">Final submission warning:</span> {criticalOpen} critical detail{criticalOpen === 1 ? "" : "s"} need a manual value, not-found confirmation, or not-applicable decision before final packaging.</div>}
    {message && !error && <p className="mt-3 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700">{message}</p>}{error && <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    {loading ? <p className="mt-4 text-sm text-slate-500">Loading client details…</p> : <div className="mt-4 space-y-2">{rows.map((row) => <div key={row.key} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-900">{row.label}</p><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{row.group}</span>{row.critical && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Critical</span>}<span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge[row.status]}`}>{row.status.replace(/_/g, " ").toLowerCase()}</span></div><p className={`mt-1 break-words text-sm ${row.value ? "text-slate-800" : "italic text-amber-700"}`}>{row.value || "MISSING_SOURCE - not found in tender document"}</p>{row.status === "EXTRACTED" && <SourceTrace source={row.source} />}</div><select value="" disabled={saving === row.key} onChange={(event) => { const action = event.target.value; event.target.value = ""; if (action) void save(row, action); }} className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50" aria-label={`Action for ${row.label}`}><option value="">Action…</option><option value="EDIT_MANUALLY">Edit manually</option><option value="MARK_NOT_FOUND">Mark as not found in tender</option><option value="IGNORE_FOR_THIS_TENDER">Ignore for this tender</option><option value="MARK_NOT_APPLICABLE">Mark not applicable</option><option value="RETRY_ON_NEXT_ANALYZE">Retry on next AI Analyze</option></select></div></div>)}</div>}
  </section>;
}

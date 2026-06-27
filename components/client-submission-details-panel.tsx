"use client";

import { useEffect, useRef, useState } from "react";

type Override = { field: string; fieldState: string; overrideValue: string | null };
type SourceInfo = {
  page: number | null;
  quote: string | null;
  fileName: string | null;
  label?: string | null;
};
type Row = {
  key: string;
  field: string;
  label: string;
  group: string;
  critical: boolean;
  value: string | null;
  status: string;
  source: SourceInfo | null;
};

type TenderPayload = Record<string, unknown> & {
  files?: Array<{ id: string; originalFileName?: string | null; fileName?: string | null }>;
  requirements?: Array<{
    sourceTenderFileId?: string | null;
    sourcePageNumber?: number | null;
    sourceExactQuote?: string | null;
    sourceSectionHeading?: string | null;
    title?: string | null;
  }>;
  metadataContaminated?: boolean | null;
};

// ─── Field spec: [uniqueKey, fieldKey, userLabel, group, isCritical, dataPaths] ─

const SPECS = [
  ["title",              "title",               "Tender title",                    "Tender",     "1", "title"],
  ["evaluationCriteria", "evaluationCriteria",  "Evaluation criteria / scoring",   "Tender",     "",  "evaluationMethodology"],
  ["requiredDocuments",  "requiredDocuments",   "Required documents / forms",      "Tender",     "1", "exactFileNaming,exactFileOrder"],
  ["procuringEntityName","clientName",          "Procuring entity / client name",  "Client",     "1", "procuringEntityName,clientName"],
  ["legalClientName",    "legalClientName",     "Legal client name",               "Client",     "",  "legalClientName"],
  ["donorAgency",        "donorAgency",         "Donor / funding agency",          "Client",     "",  "donorAgency"],
  ["implementingAgency", "implementingAgency",  "Implementing agency",             "Client",     "",  "implementingAgency"],
  ["reference",          "reference",           "Reference number",                "Client",     "",  "reference"],
  ["country",            "country",             "Country",                         "Client",     "",  "country"],
  ["clientCity",         "clientCity",          "City / location",                 "Client",     "",  "clientCity"],
  ["clientAddress",      "clientAddress",       "Client address",                  "Client",     "",  "clientAddress"],
  ["clientWebsite",      "clientWebsite",       "Client website / portal",         "Client",     "",  "clientWebsite"],
  ["clientContactName",  "clientContactName",   "Contact person",                  "Client",     "",  "clientContactName"],
  ["clientContactTitle", "clientContactTitle",  "Contact title",                   "Client",     "",  "clientContactTitle"],
  ["clientContactEmail", "clientContactEmail",  "Contact email",                   "Client",     "",  "clientContactEmail"],
  ["clientContactPhone", "clientContactPhone",  "Contact phone",                   "Client",     "",  "clientContactPhone"],
  ["clientRepresentative","clientRepresentative","Client representative",           "Client",     "",  "clientRepresentative"],
  ["submissionMethod",   "submissionMethod",    "Submission method",               "Submission", "1", "submissionMethod"],
  ["deadline",           "deadline",            "Submission deadline",             "Submission", "1", "deadline"],
  ["submissionAddress",  "submissionAddress",   "Submission address / portal",     "Submission", "1", "submissionAddress"],
  ["submissionEmails",   "submissionEmails",    "Submission email(s)",             "Submission", "1", "submissionEmails"],
  ["submissionEmailSubject","submissionEmailSubject","Submission email subject",   "Submission", "",  "submissionEmailSubject"],
  ["preBidChannel",      "preBidChannel",       "Pre-bid channel",                 "Pre-bid",    "",  "preBidChannel"],
  ["preBidMeetingDate",  "preBidMeetingDate",   "Pre-bid meeting date",            "Pre-bid",    "",  "preBidMeetingDate"],
  ["preBidMeetingLocation","preBidMeetingLocation","Pre-bid meeting location",     "Pre-bid",    "",  "preBidMeetingLocation"],
] as const;

// Fields that may NEVER be marked Not Applicable
const NEVER_NOT_APPLICABLE = new Set(["deadline"]);

// ─── Status chip config ───────────────────────────────────────────────────────

type ChipStatus =
  | "EXTRACTED_GROUNDED"
  | "EXTRACTED_NO_EVIDENCE"
  | "MANUAL_OVERRIDE"
  | "MANUALLY_CONFIRMED"
  | "NOT_STATED"
  | "NOT_APPLICABLE"
  | "RETRY_ON_ANALYZE"
  | "NOT_DETECTED";

const CHIP: Record<ChipStatus, { label: string; classes: string }> = {
  EXTRACTED_GROUNDED:    { label: "Extracted and grounded",     classes: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  EXTRACTED_NO_EVIDENCE: { label: "Extracted — review evidence", classes: "bg-blue-50 text-blue-700 border-blue-200" },
  MANUAL_OVERRIDE:       { label: "Manual override",             classes: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  MANUALLY_CONFIRMED:    { label: "Manually confirmed",          classes: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  NOT_STATED:            { label: "Not stated in tender",        classes: "bg-amber-50 text-amber-700 border-amber-200" },
  NOT_APPLICABLE:        { label: "Not applicable",              classes: "bg-slate-50 text-slate-600 border-slate-200" },
  RETRY_ON_ANALYZE:      { label: "Retry on next AI Analyze",    classes: "bg-purple-50 text-purple-700 border-purple-200" },
  NOT_DETECTED:          { label: "Not detected",                classes: "bg-slate-50 text-slate-500 border-slate-200" },
};

// ─── Utility functions ────────────────────────────────────────────────────────

function pick(tender: Record<string, unknown>, keys: string): string | null {
  for (const key of keys.split(",")) {
    const value = tender[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value != null && typeof value !== "object") return String(value);
  }
  return null;
}

/** Format a date value as "12 Dec 2026". Returns null when not parseable. */
function formatDateUnambiguous(value: unknown): string | null {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : new Date(String(value));
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return null;
  }
}

/** Returns true when a date string is ambiguous (day and month both ≤ 12). */
function isAmbiguousDate(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return false; // ISO is unambiguous
  const m = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.]\d{2,4}$/);
  if (m) return parseInt(m[1], 10) <= 12 && parseInt(m[2], 10) <= 12;
  return false;
}

function resolveChipStatus(
  override: Override | undefined,
  value: string | null,
  critical: boolean,
  hasSource: boolean,
): ChipStatus {
  if (override?.fieldState === "USER_EDITED") return "MANUAL_OVERRIDE";
  if (override?.fieldState === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (override?.fieldState === "IGNORED_WITH_REASON") return "NOT_STATED";
  if (override?.fieldState === "MISSING") return "RETRY_ON_ANALYZE";
  if (override?.fieldState === "USER_CONFIRMED") {
    return value ? (hasSource ? "EXTRACTED_GROUNDED" : "MANUALLY_CONFIRMED") : "NOT_DETECTED";
  }
  if (value) return hasSource ? "EXTRACTED_GROUNDED" : "EXTRACTED_NO_EVIDENCE";
  return critical ? "NOT_DETECTED" : "NOT_DETECTED";
}

/** Context-specific primary action label for each state. */
function primaryActionLabel(field: string, status: ChipStatus): string {
  if (field === "deadline") {
    if (status === "NOT_DETECTED" || status === "EXTRACTED_NO_EVIDENCE") return "Set or correct deadline";
    return "Correct deadline";
  }
  if (status === "EXTRACTED_NO_EVIDENCE" || status === "EXTRACTED_GROUNDED") return "Review source";
  if (status === "NOT_DETECTED") return "Enter value";
  if (status === "MANUAL_OVERRIDE") return "Edit value";
  return "Resolve field";
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const p = JSON.parse(value);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch { return {}; }
}

function parseJsonArray(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const p = JSON.parse(value);
    return Array.isArray(p)
      ? (p.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>)
      : [];
  } catch { return []; }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function normalizeQuote(v: unknown): string | null {
  const q = str(v);
  return q ? q.replace(/\s+/g, " ").trim() : null;
}

function fileNameFor(tender: TenderPayload, fileId: unknown): string | null {
  const id = str(fileId);
  if (!id) return null;
  const file = tender.files?.find((f) => f.id === id);
  return file?.originalFileName ?? file?.fileName ?? null;
}

function sourceFromObject(tender: TenderPayload, raw: unknown): SourceInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const page = num(item.page) ?? num(item.sourcePage) ?? num(item.sourcePageNumber);
  const quote = normalizeQuote(item.quote ?? item.sourceQuote ?? item.sourceExactQuote ?? item.snippet);
  const fileName =
    fileNameFor(tender, item.sourceTenderFileId ?? item.tenderFileId ?? item.fileId)
    ?? str(item.fileName);
  if (page == null && !quote && !fileName) return null;
  return {
    page,
    quote,
    fileName,
    label: str(item.sectionHeading ?? item.sourceSectionHeading ?? item.section),
  };
}

function sourceForField(tender: TenderPayload, field: string): SourceInfo | null {
  const contactSources = parseJsonObject(tender.contactDetailsSourceJson);

  if (field === "clientName") {
    const structured = sourceFromObject(tender, contactSources.clientName ?? contactSources.procuringEntityName);
    if (structured) return structured;
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
    if (page != null || quote) return { page, quote, fileName: null };
    return sourceFromObject(tender, contactSources.submissionMethod);
  }
  if (field === "submissionAddress") {
    const page = num(tender.submissionAddressSourcePage);
    const quote = normalizeQuote(tender.submissionAddressSourceQuote);
    if (page != null || quote) return { page, quote, fileName: null };
    return sourceFromObject(tender, contactSources.submissionAddress);
  }
  if (field === "evaluationCriteria") {
    const first = parseJsonArray(tender.evaluationCriteriaSourceJson).find(
      (item) => item.sourcePage || item.sourcePageNumber || item.sourceQuote || item.quote,
    );
    const source = sourceFromObject(tender, first);
    return source ? { ...source, label: source.label ?? "Evaluation criteria" } : null;
  }
  if (field === "requiredDocuments") {
    const req = tender.requirements?.find(
      (r) => r.sourcePageNumber || r.sourceExactQuote || r.sourceTenderFileId,
    );
    if (!req) return null;
    return {
      page: req.sourcePageNumber ?? null,
      quote: normalizeQuote(req.sourceExactQuote),
      fileName: fileNameFor(tender, req.sourceTenderFileId),
      label: req.sourceSectionHeading ?? req.title ?? "Requirement source",
    };
  }

  // All other fields: check contactDetailsSourceJson blob
  const contactFieldMap: Record<string, string> = {
    procuringEntityName:   "procuringEntityName",
    legalClientName:       "legalClientName",
    donorAgency:           "donorAgency",
    implementingAgency:    "implementingAgency",
    reference:             "procurementReferenceNumber",
    country:               "country",
    clientCity:            "clientCity",
    clientAddress:         "clientAddress",
    clientWebsite:         "clientWebsite",
    clientContactName:     "clientContactName",
    clientContactTitle:    "clientContactTitle",
    clientContactEmail:    "clientContactEmail",
    clientContactPhone:    "clientContactPhone",
    clientRepresentative:  "clientRepresentative",
    submissionEmailSubject:"submissionEmailSubject",
    preBidChannel:         "preBidChannel",
    preBidMeetingDate:     "preBidMeetingDate",
    preBidMeetingLocation: "preBidMeetingLocation",
  };
  const contactKey = contactFieldMap[field];
  if (contactKey) return sourceFromObject(tender, contactSources[contactKey]);

  return null;
}

function buildRows(tender: TenderPayload, overrides: Override[]): Row[] {
  const byField = new Map(overrides.map((o) => [o.field, o]));
  return SPECS.map(([key, field, label, group, criticalFlag, keys]) => {
    const o = byField.get(field);

    // Prefer override value when user has edited
    const rawStored = pick(tender, keys);
    let stored: string | null = rawStored;

    // Format ISO dates as "12 Dec 2026"
    if (field === "deadline" && stored) {
      const formatted = formatDateUnambiguous(stored);
      if (formatted) stored = formatted;
    }

    const effectiveValue =
      o?.fieldState === "USER_EDITED" && o.overrideValue ? o.overrideValue : stored;

    const source = sourceForField(tender, field);
    // Grounded requires BOTH page AND quote (not just one).
    // Policy: valid value + resolved source file + page + quote = grounded.
    // Page OR quote alone = unverified.
    const hasSource = !!(source?.page != null && source?.page > 0 && source?.quote && source.quote.trim().length > 5);
    const chipStatus = resolveChipStatus(o, effectiveValue, criticalFlag === "1", hasSource);

    return {
      key,
      field,
      label,
      group,
      critical: criticalFlag === "1",
      value: effectiveValue,
      status: chipStatus,
      source,
    };
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Structured evidence display for an extracted field. */
function SourceEvidence({ source }: { source: SourceInfo | null }) {
  if (!source) {
    return (
      <p className="mt-1 text-[11px] text-slate-500">
        No structured page/quote evidence is stored for this value. Re-run AI Analyze if
        source evidence is required.
      </p>
    );
  }
  const shortQuote = source.quote ? source.quote.slice(0, 200) : null;
  const hasEvidence = source.page != null || shortQuote || source.fileName;

  if (!hasEvidence) {
    return (
      <p className="mt-1 text-[11px] text-slate-500">
        No structured page/quote evidence is stored for this value.
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
      <p className="font-semibold text-slate-700 mb-1">Source evidence</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {source.page != null && (
          <span>Page <strong>{source.page}</strong></span>
        )}
        {source.fileName && (
          <span>• {source.fileName}</span>
        )}
        {source.label && (
          <span>• {source.label}</span>
        )}
      </div>
      {shortQuote ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-blue-700 hover:text-blue-900 text-[11px]">
            View source quote
          </summary>
          <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 italic text-slate-600">
            &ldquo;{source.quote}&rdquo;
          </blockquote>
        </details>
      ) : (
        <p className="mt-1 text-slate-400 text-[11px]">Source quote not recorded.</p>
      )}
    </div>
  );
}

/** Overflow action menu for secondary actions. */
function OverflowMenu({
  row,
  canMarkNA,
  onAction,
  saving,
}: {
  row: Row;
  canMarkNA: boolean;
  onAction: (action: string) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const isDeadline = row.field === "deadline";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`More actions for ${row.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={saving}
        className="min-h-[44px] min-w-[44px] rounded border border-slate-300 bg-white px-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white shadow-lg text-xs">
          <button
            type="button"
            className="w-full text-left px-3 py-2 hover:bg-slate-50 min-h-[44px] flex items-center"
            onClick={() => { onAction("EDIT_MANUALLY"); setOpen(false); }}
          >
            Edit value manually
          </button>
          {!isDeadline && canMarkNA && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-slate-50 min-h-[44px] flex items-center"
              onClick={() => { onAction("MARK_NOT_APPLICABLE"); setOpen(false); }}
            >
              Mark not applicable
            </button>
          )}
          {!isDeadline && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-slate-50 min-h-[44px] flex items-center"
              onClick={() => { onAction("MARK_NOT_FOUND"); setOpen(false); }}
            >
              Record not found in tender
            </button>
          )}
          {isDeadline && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-slate-50 min-h-[44px] flex items-center"
              onClick={() => { onAction("MARK_DEADLINE_NOT_STATED"); setOpen(false); }}
            >
              Record deadline not stated in tender
            </button>
          )}
          <button
            type="button"
            className="w-full text-left px-3 py-2 hover:bg-slate-50 min-h-[44px] flex items-center"
            onClick={() => { onAction("RETRY_ON_NEXT_ANALYZE"); setOpen(false); }}
          >
            Retry on next AI Analyze
          </button>
          {row.source && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-blue-700 hover:bg-blue-50"
              onClick={() => { onAction("VIEW_SOURCE"); setOpen(false); }}
            >
              View source evidence
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ClientSubmissionDetailsPanel({ tenderId }: { tenderId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [tender, setTender] = useState<TenderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // Which row has its source evidence expanded
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  // Inline editor state (replaces window.prompt). editingKey identifies the row
  // currently being edited; editValue holds the in-progress input value.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  function startEditing(row: Row) {
    setError("");
    setEditValue(row.value ?? "");
    setEditingKey(row.key);
  }
  function cancelEditing() {
    setEditingKey(null);
    setEditValue("");
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [tenderRes, overrideRes] = await Promise.all([
        fetch(`/api/tenders/${tenderId}`, { cache: "no-store" }),
        fetch(`/api/tenders/${tenderId}/metadata-override`, { cache: "no-store" }),
      ]);
      const tenderData = (await tenderRes.json()) as TenderPayload;
      if (!tenderRes.ok) throw new Error((tenderData as { error?: string }).error ?? "Failed to load tender");
      const overrideJson = (await overrideRes.json().catch(() => ({}))) as {
        overrides?: Override[];
      };
      setTender(tenderData);
      setRows(
        buildRows(
          tenderData,
          overrideRes.ok && Array.isArray(overrideJson.overrides) ? overrideJson.overrides : [],
        ),
      );
      setMessage(
        overrideRes.ok
          ? ""
          : "Manual resolution storage is not available; extracted values are still visible.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client details");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [tenderId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(row: Row, action: string, editedValue?: string) {
    // VIEW_SOURCE is client-only; no save needed
    if (action === "VIEW_SOURCE") {
      setExpandedSource(expandedSource === row.key ? null : row.key);
      return;
    }

    let fieldState = "USER_CONFIRMED";
    let overrideValue: string | null = null;
    let reason = "Confirmed from Client & Submission Details panel.";

    if (action === "EDIT_MANUALLY") {
      // The value comes from the inline editor (a real <input>, with a native
      // date picker for the deadline) — never from window.prompt.
      const v = (editedValue ?? "").trim();
      if (!v) return;
      // Validate that a manually entered deadline is in unambiguous format.
      if (row.field === "deadline" && isAmbiguousDate(v)) {
        setError(
          `Deadline format is ambiguous — day and month order cannot be determined from "${v}". ` +
          `Enter an unambiguous date, e.g. "15 Dec 2026" or "2026-12-15".`,
        );
        return;
      }
      fieldState = "USER_EDITED";
      overrideValue = v;
      reason = "Manual value entered by user.";
    }
    if (action === "IGNORE_FOR_THIS_TENDER") {
      fieldState = "IGNORED_WITH_REASON";
      reason = "Ignored for this tender by user.";
    }
    if (action === "MARK_NOT_APPLICABLE") {
      fieldState = "NOT_APPLICABLE";
      reason = "Marked not applicable by user.";
    }
    if (action === "MARK_DEADLINE_NOT_STATED") {
      fieldState = "IGNORED_WITH_REASON";
      reason = "Deadline not stated in the tender document. This remains a final-package blocker.";
    }
    if (action === "MARK_NOT_FOUND") {
      fieldState = "IGNORED_WITH_REASON";
      reason = "User confirmed this detail was not found in the tender.";
    }
    if (action === "RETRY_ON_NEXT_ANALYZE") {
      fieldState = "MISSING";
      reason = "Retry requested for next AI Analyze.";
    }

    setSaving(row.key);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tenderId}/metadata-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: row.field,
          fieldState,
          overrideValue,
          previousValue: row.value,
          reason,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "Failed to save");
      setMessage(`${row.label} updated.`);
      // Refresh without browser reload
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  }

  const blockerCount = rows.filter(
    (r) => r.critical && (r.status === "NOT_DETECTED" || r.status === "RETRY_ON_ANALYZE"),
  ).length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Client &amp; Submission Details</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Key fields extracted from the tender document. Missing optional details do not stop
            document generation. Critical fields are marked and must be resolved before final
            packaging.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Contamination warning */}
      {tender?.metadataContaminated === true && (
        <div
          className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
          role="alert"
        >
          <span className="font-semibold block mb-1">⚠ Client metadata contaminated</span>
          The extracted client / procuring entity details appear to contain portal navigation text,
          headers, or unrelated tender information.{" "}
          <strong>Final document generation and export are blocked</strong> until the correct value
          is entered manually.
        </div>
      )}

      {/* Critical blockers summary */}
      {blockerCount > 0 && (
        <div
          className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          role="alert"
        >
          <span className="font-semibold">
            {blockerCount === 1
              ? "One critical detail needs action before final packaging."
              : `${blockerCount} critical details need action before final packaging.`}
          </span>{" "}
          Resolve each critical field below to unblock generation and export.
        </div>
      )}

      {/* Status / error messages */}
      {message && !error && (
        <p className="mt-3 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}

      {/* Field rows */}
      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading client details…</p>
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map((row) => {
            const chip = CHIP[row.status as ChipStatus] ?? CHIP.NOT_DETECTED;
            const isSaving = saving === row.key;
            const canMarkNA = !NEVER_NOT_APPLICABLE.has(row.field);
            const showSource = expandedSource === row.key;

            // Context-specific primary action
            const primaryLabel = primaryActionLabel(row.field, row.status as ChipStatus);

            return (
              <div
                key={row.key}
                className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"
              >
                {/* Field header row */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    {/* Labels */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium text-slate-900">{row.label}</p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {row.group}
                      </span>
                      {row.critical && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                          Critical
                        </span>
                      )}
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${chip.classes}`}
                        aria-label={`Status: ${chip.label}`}
                      >
                        {chip.label}
                      </span>
                    </div>

                    {/* Value display */}
                    {row.value ? (
                      <p className="mt-1 break-words text-sm text-slate-800">{row.value}</p>
                    ) : row.status === "NOT_STATED" ? (
                      <p className="mt-1 text-xs italic text-amber-700">
                        Not stated in this tender document.
                      </p>
                    ) : row.status === "NOT_APPLICABLE" ? (
                      <p className="mt-1 text-xs italic text-slate-500">Not applicable.</p>
                    ) : (
                      <p className="mt-1 text-xs italic text-slate-500">
                        {row.field === "requiredDocuments"
                          ? "No structured list of required documents was extracted. Review detected pages or enter manually."
                          : "No value detected in the tender document."}
                      </p>
                    )}

                    {/* Inline editor — replaces window.prompt. Uses a native
                        date picker for the deadline so the value cannot be an
                        ambiguous free-text date. */}
                    {editingKey === row.key && (
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type={row.field === "deadline" ? "date" : "text"}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          autoFocus
                          aria-label={`Enter value for ${row.label}`}
                          placeholder={row.field === "deadline" ? "YYYY-MM-DD" : `Enter ${row.label}`}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") cancelEditing();
                            if (e.key === "Enter" && row.field !== "deadline") {
                              const v = editValue.trim();
                              setEditingKey(null);
                              void save(row, "EDIT_MANUALLY", v);
                            }
                          }}
                          className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const v = editValue.trim();
                              setEditingKey(null);
                              void save(row, "EDIT_MANUALLY", v);
                            }}
                            className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditing}
                            className="min-h-[44px] rounded-lg border border-slate-300 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Source evidence (expanded) */}
                    {showSource && (
                      <SourceEvidence source={row.source} />
                    )}
                    {/* Source evidence for extracted-grounded rows (collapsed by default) */}
                    {!showSource &&
                      (row.status === "EXTRACTED_GROUNDED" ||
                        row.status === "EXTRACTED_NO_EVIDENCE") &&
                      row.source && (
                        <button
                          type="button"
                          onClick={() => setExpandedSource(row.key)}
                          className="mt-1 text-[11px] text-blue-700 hover:underline"
                        >
                          View source evidence
                        </button>
                      )}
                  </div>

                  {/* Actions: primary button + overflow menu */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEditing(row)}
                      disabled={isSaving}
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {isSaving ? "Saving…" : primaryLabel}
                    </button>
                    <OverflowMenu
                      row={row}
                      canMarkNA={canMarkNA}
                      onAction={(action) => {
                        if (action === "EDIT_MANUALLY") startEditing(row);
                        else void save(row, action);
                      }}
                      saving={isSaving}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

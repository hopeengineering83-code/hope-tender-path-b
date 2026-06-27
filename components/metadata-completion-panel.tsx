"use client";

// Metadata Completion Panel.
//
// Shows missing critical and non-critical tender metadata fields with actions:
//   - "Set value" → opens an inline input (date picker for deadline)
//   - "Mark not applicable" → requires a short reason (blocked for deadline)
//   - "Record not found" → for non-critical fields only

import { useCallback, useEffect, useRef, useState } from "react";

// User-facing field labels (never expose raw DB column names to users)
const FIELD_LABELS: Record<string, string> = {
  clientName:            "Client / procuring entity",
  procuringEntityName:   "Procuring entity name",
  title:                 "Tender title",
  reference:             "Reference number",
  deadline:              "Submission deadline",
  country:               "Country",
  submissionMethod:      "Submission method",
  submissionAddress:     "Submission address / portal",
  submissionEmails:      "Submission email(s)",
  currency:              "Currency",
  clientContactName:     "Contact person",
  clientContactEmail:    "Contact email",
  clientContactPhone:    "Contact phone",
  submissionEmailSubject:"Submission email subject",
  evaluationCriteria:    "Evaluation criteria",
  requiredDocuments:     "Required documents / forms",
  clientCity:            "City / location",
  clientAddress:         "Client address",
  clientWebsite:         "Client website / portal",
};

function fieldLabel(raw: string): string {
  return FIELD_LABELS[raw] ?? raw.replace(/([A-Z])/g, " $1").trim();
}

// Fields that may NEVER be marked Not Applicable
const NEVER_NOT_APPLICABLE = new Set(["deadline"]);

type FieldState =
  | "AI_EXTRACTED"
  | "USER_CONFIRMED"
  | "USER_EDITED"
  | "MISSING"
  | "NOT_APPLICABLE"
  | "IGNORED_WITH_REASON";

type Override = {
  id: string;
  tenderId: string;
  field: string;
  fieldState: FieldState;
  overrideValue: string | null;
  reason: string | null;
  previousValue: string | null;
  overriddenBy: string;
  createdAt: string;
  updatedAt: string;
};

type FieldFinding = {
  field: string;
  reason: string;
};

type MetadataReport = {
  missingCritical: FieldFinding[];
  missingNonCritical: FieldFinding[];
  notApplicableFields: FieldFinding[];
  invalidFields: FieldFinding[];
  blockingForGeneration: boolean;
  overallRatio: number;
};

const FIELD_STATE_BADGE: Record<FieldState, { label: string; classes: string }> = {
  AI_EXTRACTED:        { label: "Extracted — review evidence", classes: "bg-blue-100 text-blue-700" },
  USER_CONFIRMED:      { label: "Manually confirmed",          classes: "bg-emerald-100 text-emerald-700" },
  USER_EDITED:         { label: "Manual override",             classes: "bg-indigo-100 text-indigo-700" },
  MISSING:             { label: "Not detected",                classes: "bg-red-100 text-red-700" },
  NOT_APPLICABLE:      { label: "Not applicable",              classes: "bg-slate-100 text-slate-600" },
  IGNORED_WITH_REASON: { label: "Not stated in tender",        classes: "bg-amber-100 text-amber-700" },
};

type InlineAction = "FILL" | "NOT_APPLICABLE" | "IGNORE" | null;

export function MetadataCompletionPanel({ tenderId }: { tenderId: string }) {
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [report, setReport] = useState<MetadataReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<{ field: string; type: InlineAction } | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overrideRes, reportRes] = await Promise.all([
        fetch(`/api/tenders/${tenderId}/metadata-override`),
        fetch(`/api/tenders/${tenderId}/generation-readiness`),
      ]);
      const overrideJson = await overrideRes.json().catch(() => ({})) as { ok?: boolean; overrides?: Override[] };
      if (overrideRes.ok && overrideJson.overrides) {
        setOverrides(overrideJson.overrides);
      }
      // generation-readiness includes metadata completeness details
      if (reportRes.ok) {
        const reportJson = await reportRes.json().catch(() => null) as {
          metadata?: MetadataReport;
          metadataReport?: MetadataReport;
        } | null;
        if (reportJson?.metadata) setReport(reportJson.metadata);
        else if (reportJson?.metadataReport) setReport(reportJson.metadataReport);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load metadata");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => { void load(); }, [load]);

  const overrideByField = new Map(overrides.map((o) => [o.field, o]));

  async function saveOverride(
    field: string,
    fieldState: FieldState,
    overrideValue: string | null,
    reason: string | null,
  ) {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/metadata-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, fieldState, overrideValue, reason }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; override?: Override };
      if (!res.ok || !json.ok) {
        setSaveMsg(json.error ?? "Failed to save override");
        return;
      }
      setSaveMsg(`Saved: "${field}" marked as ${fieldState}.`);
      setActiveAction(null);
      setInputValue("");
      // Reload
      await load();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function startAction(field: string, type: InlineAction) {
    setActiveAction({ field, type });
    setInputValue("");
    setSaveMsg(null);
  }

  function cancelAction() {
    setActiveAction(null);
    setInputValue("");
  }

  async function commitAction(field: string) {
    if (!activeAction) return;
    const { type } = activeAction;
    if (type === "FILL") {
      if (!inputValue.trim()) { setSaveMsg("Enter a value first."); return; }
      await saveOverride(field, "USER_EDITED", inputValue.trim(), null);
    } else if (type === "NOT_APPLICABLE") {
      if (!inputValue.trim()) { setSaveMsg("Enter a short reason first."); return; }
      await saveOverride(field, "NOT_APPLICABLE", null, inputValue.trim());
    } else if (type === "IGNORE") {
      if (!inputValue.trim()) { setSaveMsg("Enter a short reason first."); return; }
      await saveOverride(field, "IGNORED_WITH_REASON", null, inputValue.trim());
    }
  }

  if (loading) {
    return (
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Loading metadata completion…
      </section>
    );
  }

  if (error) {
    return (
      <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        Could not load metadata: {error}
      </section>
    );
  }

  const criticalFindings = report?.missingCritical ?? [];
  const nonCriticalFindings = report?.missingNonCritical ?? [];
  const notApplicableFindings = report?.notApplicableFields ?? [];
  const invalidFindings = report?.invalidFields ?? [];
  const hasCritical = criticalFindings.length > 0 || invalidFindings.length > 0;

  // Contamination detection: flag invalid client/entity fields as a prominent warning
  const CLIENT_FIELDS = ["clientName", "procuringEntityName", "clientContactName", "submissionEmail", "submissionAddress"];
  const contaminatedFields = invalidFindings.filter(
    (f) => CLIENT_FIELDS.some((cf) => f.field.toLowerCase().includes(cf.toLowerCase()) || f.reason.toLowerCase().includes("contaminat") || f.reason.toLowerCase().includes("conflict") || f.reason.toLowerCase().includes("placeholder"))
  );
  const hasContaminatedClientFields = contaminatedFields.length > 0;

  // Client name conflict: multiple override values for client-name fields
  const clientNameOverrides = overrides.filter((o) =>
    CLIENT_FIELDS.some((cf) => o.field.toLowerCase().includes(cf.toLowerCase()))
  );
  const hasClientNameConflict = clientNameOverrides.length > 1 &&
    new Set(clientNameOverrides.map((o) => (o.overrideValue ?? "").toLowerCase().trim()).filter(Boolean)).size > 1;

  if (!hasCritical && nonCriticalFindings.length === 0 && notApplicableFindings.length === 0 && overrides.length === 0) {
    return (
      <section className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-700">
        All critical metadata is present or confirmed. No missing fields require manual completion.
      </section>
    );
  }

  function renderFieldRow(finding: FieldFinding, isCritical: boolean, allowIgnore: boolean) {
    const override = overrideByField.get(finding.field);
    const isActive = activeAction?.field === finding.field;
    const state: FieldState = override?.fieldState ?? "MISSING";
    const badge = FIELD_STATE_BADGE[state];
    const label = fieldLabel(finding.field);
    const isDeadline = finding.field === "deadline";
    const canMarkNA = !NEVER_NOT_APPLICABLE.has(finding.field) && !isCritical;

    return (
      <div key={finding.field} className="border-t border-slate-100 py-3 first:border-t-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-800">{label}</span>
              {isCritical && (
                <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] font-semibold text-red-700">
                  Critical
                </span>
              )}
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.classes}`}>
                {badge.label}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">{finding.reason}</p>
            {override?.overrideValue && (
              <p className="mt-0.5 text-[11px] text-indigo-700">
                Current value: {override.overrideValue}
              </p>
            )}
            {override?.reason && (
              <p className="mt-0.5 text-[11px] text-slate-500">Reason: {override.reason}</p>
            )}
          </div>

          {/* Primary action + overflow */}
          {!isActive && (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => startAction(finding.field, "FILL")}
                className="min-h-[36px] rounded border border-blue-300 bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
              >
                {isDeadline ? "Set or correct deadline" : "Set value"}
              </button>
              {canMarkNA && (
                <button
                  type="button"
                  onClick={() => startAction(finding.field, "NOT_APPLICABLE")}
                  className="min-h-[36px] rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Not applicable
                </button>
              )}
              {allowIgnore && !isCritical && !isDeadline && (
                <button
                  type="button"
                  onClick={() => startAction(finding.field, "IGNORE")}
                  className="min-h-[36px] rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50"
                >
                  Record not found
                </button>
              )}
              {isDeadline && (
                <button
                  type="button"
                  onClick={() => startAction(finding.field, "IGNORE")}
                  className="min-h-[36px] rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50"
                >
                  Record deadline not stated
                </button>
              )}
            </div>
          )}
        </div>

        {isActive && activeAction && (
          <div className="mt-2 ml-0">
            {activeAction.type === "FILL" && (
              <p className="mb-1 text-[11px] text-slate-600">
                {isDeadline
                  ? <>Enter the confirmed submission deadline for <strong>{label}</strong> using the date picker:</>
                  : <>Enter the value for <strong>{label}</strong>:</>}
              </p>
            )}
            {activeAction.type === "NOT_APPLICABLE" && (
              <p className="mb-1 text-[11px] text-slate-600">
                Why is <strong>{label}</strong> not applicable to this tender? (required):
              </p>
            )}
            {activeAction.type === "IGNORE" && (
              <p className="mb-1 text-[11px] text-slate-600">
                {isDeadline
                  ? <>Confirm that the submission deadline was <strong>not stated</strong> in the tender document. This will remain a final-package blocker.</>
                  : <>Reason for recording <strong>{label}</strong> as not found in tender:</>}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {activeAction.type === "FILL" && isDeadline ? (
                <input
                  type="date"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none min-h-[36px]"
                  autoFocus
                />
              ) : activeAction.type === "IGNORE" && isDeadline ? (
                // No text input for deadline not-stated — just a confirm button
                <span className="text-[11px] text-slate-500 italic">
                  This will mark the deadline as not stated and keep generation blocked.
                </span>
              ) : (
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={activeAction.type === "FILL" ? "Enter value…" : "Short reason…"}
                  className="flex-1 min-w-[160px] rounded border border-slate-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none min-h-[36px]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitAction(finding.field);
                    if (e.key === "Escape") cancelAction();
                  }}
                  autoFocus
                />
              )}
              <button
                type="button"
                onClick={() => void commitAction(finding.field)}
                disabled={saving}
                className="min-h-[36px] rounded bg-blue-600 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelAction}
                className="min-h-[36px] rounded border border-slate-300 px-2 py-1.5 text-[10px] text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" id="metadata-completion-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Metadata Completion</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Missing tender metadata fields. Fill manually, mark Not Applicable, or ignore with reason to unblock generation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {saveMsg && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{saveMsg}</p>
      )}

      {hasContaminatedClientFields && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs">
          <p className="font-semibold text-red-800">⚠ Contaminated client/entity field(s) detected</p>
          <p className="mt-1 text-red-700">
            The following fields may contain portal navigation text, unrelated tender alerts, or placeholder values —
            generation is blocked until each is corrected or confirmed:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-red-700">
            {contaminatedFields.map((f) => (
              <li key={f.field}><strong>{f.field}</strong> — {f.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {hasClientNameConflict && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
          <p className="font-semibold text-amber-800">⚠ Multiple conflicting client name values</p>
          <p className="mt-1 text-amber-700">
            More than one client-related field has been overridden with different values. Verify which is the procuring entity,
            project owner, funder/donor, and implementing agency — do not merge distinct organisations into a single field.
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-700">
            {clientNameOverrides.map((o) => (
              <li key={o.id}><strong>{o.field}</strong>: &ldquo;{o.overrideValue ?? "(blank)"}&rdquo;</li>
            ))}
          </ul>
        </div>
      )}

      {hasCritical && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-red-700">
            Critical fields ({criticalFindings.length + invalidFindings.length}) — block generation and export
          </p>
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2">
            {criticalFindings.map((f) => renderFieldRow(f, true, false))}
            {invalidFindings.map((f) => (
              <div key={`invalid-${f.field}`} className="border-t border-red-100 py-2 first:border-t-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-red-800">{fieldLabel(f.field)}</span>
                  <span className="rounded bg-red-200 px-1 py-0.5 text-[10px] font-semibold text-red-800">PLACEHOLDER</span>
                </div>
                <p className="mt-0.5 text-[11px] text-red-700">{f.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {nonCriticalFindings.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            Non-critical fields ({nonCriticalFindings.length}) — warnings only
          </p>
          <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-2">
            {nonCriticalFindings.map((f) => renderFieldRow(f, false, true))}
          </div>
        </div>
      )}

      {notApplicableFindings.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Not applicable ({notApplicableFindings.length}) — user-confirmed
          </p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
            {notApplicableFindings.map((f) => {
              const override = overrideByField.get(f.field);
              return (
                <div key={f.field} className="border-t border-slate-100 py-2 first:border-t-0 flex items-center gap-2">
                  <span className="text-xs text-slate-700">{fieldLabel(f.field)}</span>
                  <span className="rounded bg-slate-200 px-1 py-0.5 text-[10px] text-slate-600">N/A</span>
                  {override?.reason && <span className="text-[11px] text-slate-500">— {override.reason}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {overrides.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            All overrides ({overrides.length})
          </p>
          <div className="rounded-lg border border-slate-100 divide-y divide-slate-100">
            {overrides.map((o) => {
              const badge = FIELD_STATE_BADGE[o.fieldState] ?? FIELD_STATE_BADGE.MISSING;
              return (
                <div key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                  <span className="font-medium text-slate-800">{fieldLabel(o.field)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.classes}`}>{badge.label}</span>
                  {o.overrideValue && <span className="text-slate-600">&ldquo;{o.overrideValue}&rdquo;</span>}
                  {o.reason && <span className="text-slate-500">— {o.reason}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

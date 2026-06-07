"use client";

// Metadata Completion Panel.
//
// Shows missing critical and non-critical tender metadata fields with actions:
//   - "Fill manually" → opens an inline input
//   - "Mark Not Applicable" → requires a short reason
//   - "Ignore with reason" → for non-critical fields only
//
// Fetches overrides from /api/tenders/[id]/metadata-override (GET)
// and saves via POST.

import { useCallback, useEffect, useState } from "react";

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
  AI_EXTRACTED: { label: "AI Extracted", classes: "bg-blue-100 text-blue-700" },
  USER_CONFIRMED: { label: "Confirmed", classes: "bg-green-100 text-green-700" },
  USER_EDITED: { label: "Edited", classes: "bg-green-100 text-green-700" },
  MISSING: { label: "Missing", classes: "bg-red-100 text-red-700" },
  NOT_APPLICABLE: { label: "Not Applicable", classes: "bg-slate-100 text-slate-600" },
  IGNORED_WITH_REASON: { label: "Ignored", classes: "bg-amber-100 text-amber-700" },
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

    return (
      <div key={finding.field} className="border-t border-slate-100 py-3 first:border-t-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-800">{finding.field}</span>
              {isCritical && <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] font-semibold text-red-700">CRITICAL</span>}
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.classes}`}>{badge.label}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">{finding.reason}</p>
            {override?.overrideValue && (
              <p className="mt-0.5 text-[11px] text-green-700">Value: {override.overrideValue}</p>
            )}
            {override?.reason && (
              <p className="mt-0.5 text-[11px] text-slate-500">Reason: {override.reason}</p>
            )}
          </div>
          {!isActive && (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => startAction(finding.field, "FILL")}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Fill manually
              </button>
              <button
                type="button"
                onClick={() => startAction(finding.field, "NOT_APPLICABLE")}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Mark N/A
              </button>
              {allowIgnore && !isCritical && (
                <button
                  type="button"
                  onClick={() => startAction(finding.field, "IGNORE")}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50"
                >
                  Ignore
                </button>
              )}
            </div>
          )}
        </div>

        {isActive && activeAction && (
          <div className="mt-2 ml-0">
            {activeAction.type === "FILL" && (
              <p className="mb-1 text-[11px] text-slate-600">Enter the value for <strong>{finding.field}</strong>:</p>
            )}
            {activeAction.type === "NOT_APPLICABLE" && (
              <p className="mb-1 text-[11px] text-slate-600">Why is <strong>{finding.field}</strong> not applicable? (required):</p>
            )}
            {activeAction.type === "IGNORE" && (
              <p className="mb-1 text-[11px] text-slate-600">Reason for ignoring <strong>{finding.field}</strong> (required):</p>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={activeAction.type === "FILL" ? "Enter value…" : "Short reason…"}
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                onKeyDown={(e) => { if (e.key === "Enter") { void commitAction(finding.field); } if (e.key === "Escape") cancelAction(); }}
                autoFocus
              />
              <button
                type="button"
                onClick={() => void commitAction(finding.field)}
                disabled={saving}
                className="rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelAction}
                className="rounded border border-slate-300 px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50"
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

      {hasCritical && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-red-700">
            Critical fields ({criticalFindings.length + invalidFindings.length}) — block generation
          </p>
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2">
            {criticalFindings.map((f) => renderFieldRow(f, true, false))}
            {invalidFindings.map((f) => (
              <div key={`invalid-${f.field}`} className="border-t border-red-100 py-2 first:border-t-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-red-800">{f.field}</span>
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
                  <span className="text-xs text-slate-700">{f.field}</span>
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
                  <span className="font-medium text-slate-800">{o.field}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.classes}`}>{badge.label}</span>
                  {o.overrideValue && <span className="text-slate-600">"{o.overrideValue}"</span>}
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

"use client";

import { useEffect, useState } from "react";

type Status = "EXTRACTED" | "MISSING_SOURCE" | "MANUAL_REQUIRED" | "MANUALLY_SET" | "IGNORED_FOR_THIS_TENDER" | "NOT_APPLICABLE" | "RETRY_ON_NEXT_ANALYZE";
type FieldRow = { key: string; label: string; group: string; value: string | null; status: Status; critical: boolean; sourcePage: number | null; sourceQuote: string | null };

const statusClass: Record<Status, string> = {
  EXTRACTED: "bg-green-50 text-green-700 border-green-200",
  MISSING_SOURCE: "bg-amber-50 text-amber-700 border-amber-200",
  MANUAL_REQUIRED: "bg-red-50 text-red-700 border-red-200",
  MANUALLY_SET: "bg-blue-50 text-blue-700 border-blue-200",
  IGNORED_FOR_THIS_TENDER: "bg-slate-50 text-slate-600 border-slate-200",
  NOT_APPLICABLE: "bg-slate-50 text-slate-600 border-slate-200",
  RETRY_ON_NEXT_ANALYZE: "bg-purple-50 text-purple-700 border-purple-200",
};

const statusLabel: Record<Status, string> = {
  EXTRACTED: "Extracted",
  MISSING_SOURCE: "Not found",
  MANUAL_REQUIRED: "Manual required",
  MANUALLY_SET: "Manual",
  IGNORED_FOR_THIS_TENDER: "Ignored",
  NOT_APPLICABLE: "Not applicable",
  RETRY_ON_NEXT_ANALYZE: "Retry queued",
};

export function ClientSubmissionDetailsPanel({ tenderId }: { tenderId: string }) {
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tenderId}/client-details`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load client details");
      setFields(data.fields || []);
      setMessage(data.message || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client details");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [tenderId]);

  async function updateField(field: FieldRow, action: string) {
    let value: string | undefined;
    if (action === "EDIT_MANUALLY") {
      value = window.prompt(`Enter ${field.label}`, field.value || "")?.trim();
      if (!value) return;
    }
    setSaving(field.key);
    setError("");
    try {
      const res = await fetch(`/api/tenders/${tenderId}/client-details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey: field.key, action, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save client detail");
      setFields(data.fields || []);
      setMessage(data.message || "Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save client detail");
    } finally {
      setSaving(null);
    }
  }

  const criticalOpen = fields.filter((field) => field.critical && ["MISSING_SOURCE", "MANUAL_REQUIRED"].includes(field.status)).length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Client &amp; Submission Details</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Some client details may not be in the tender. Edit manually, mark not found, ignore, or mark not applicable. Missing optional details will not stop document generation.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {criticalOpen > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Final submission warning:</span> {criticalOpen} critical detail{criticalOpen === 1 ? "" : "s"} need a manual value, not-found confirmation, or not-applicable decision before final packaging.
        </div>
      )}
      {message && !error && <p className="mt-3 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700">{message}</p>}
      {error && <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {loading ? <p className="mt-4 text-sm text-slate-500">Loading client details…</p> : (
        <div className="mt-4 space-y-2">
          {fields.map((field) => (
            <div key={field.key} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{field.label}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{field.group}</span>
                    {field.critical && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Critical</span>}
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass[field.status]}`}>{statusLabel[field.status]}</span>
                  </div>
                  <p className={`mt-1 break-words text-sm ${field.value ? "text-slate-800" : "italic text-amber-700"}`}>{field.value || "MISSING_SOURCE — not found in tender document"}</p>
                  {(field.sourcePage || field.sourceQuote) && <p className="mt-1 line-clamp-2 text-xs italic text-slate-500">{field.sourcePage ? `p.${field.sourcePage} ` : ""}{field.sourceQuote ? `“${field.sourceQuote}”` : ""}</p>}
                </div>
                <select value="" disabled={saving === field.key} onChange={(event) => { const action = event.target.value; event.target.value = ""; if (action) void updateField(field, action); }} className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50" aria-label={`Action for ${field.label}`}>
                  <option value="">Action…</option>
                  <option value="EDIT_MANUALLY">Edit manually</option>
                  <option value="MARK_NOT_FOUND">Mark as not found in tender</option>
                  <option value="IGNORE_FOR_THIS_TENDER">Ignore for this tender</option>
                  <option value="MARK_NOT_APPLICABLE">Mark not applicable</option>
                  <option value="RETRY_ON_NEXT_ANALYZE">Retry on next AI Analyze</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

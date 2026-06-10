"use client";

import { useEffect, useState } from "react";

type Override = { field: string; fieldState: string; overrideValue: string | null };
type Row = { key: string; field: string; label: string; group: string; critical: boolean; value: string | null; status: string };

const SPECS = [
  ["title", "title", "Tender title", "Tender", "1", "title"],
  ["evaluationCriteria", "evaluationCriteria", "Evaluation criteria / scoring", "Tender", "", "evaluationMethodology"],
  ["requiredDocuments", "requiredDocuments", "Required documents / forms", "Tender", "1", "exactFileNaming,exactFileOrder"],
  ["procuringEntityName", "clientName", "Procuring entity / client name", "Client", "1", "procuringEntityName,clientName"],
  ["legalClientName", "legalClientName", "Legal client name", "Client", "", "legalClientName"],
  ["donorAgency", "donorAgency", "Donor / funding agency", "Client", "", "donorAgency"],
  ["implementingAgency", "implementingAgency", "Implementing agency", "Client", "", "implementingAgency"],
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
function buildRows(tender: Record<string, unknown>, overrides: Override[]) {
  const byField = new Map(overrides.map((o) => [o.field, o]));
  return SPECS.map(([key, field, label, group, criticalFlag, keys]) => {
    const o = byField.get(field);
    const stored = pick(tender, keys);
    const value = o?.fieldState === "USER_EDITED" && o.overrideValue ? o.overrideValue : stored;
    return { key, field, label, group, critical: criticalFlag === "1", value, status: status(o, value, criticalFlag === "1") };
  });
}

export function ClientSubmissionDetailsPanel({ tenderId }: { tenderId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [tenderRes, overrideRes] = await Promise.all([fetch(`/api/tenders/${tenderId}`, { cache: "no-store" }), fetch(`/api/tenders/${tenderId}/metadata-override`, { cache: "no-store" })]);
      const tender = await tenderRes.json();
      if (!tenderRes.ok) throw new Error(tender.error || "Failed to load tender");
      const overrideJson = await overrideRes.json().catch(() => ({}));
      setRows(buildRows(tender, overrideRes.ok && Array.isArray(overrideJson.overrides) ? overrideJson.overrides : []));
      setMessage(overrideRes.ok ? "" : "Manual resolution storage is not ready; extracted values are still visible.");
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load client details"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tenderId]);

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
    {criticalOpen > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><span className="font-semibold">Final submission warning:</span> {criticalOpen} critical detail{criticalOpen === 1 ? "" : "s"} need a manual value, not-found confirmation, or not-applicable decision before final packaging.</div>}
    {message && !error && <p className="mt-3 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700">{message}</p>}{error && <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    {loading ? <p className="mt-4 text-sm text-slate-500">Loading client details…</p> : <div className="mt-4 space-y-2">{rows.map((row) => <div key={row.key} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-900">{row.label}</p><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{row.group}</span>{row.critical && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Critical</span>}<span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge[row.status]}`}>{row.status.replace(/_/g, " ").toLowerCase()}</span></div><p className={`mt-1 break-words text-sm ${row.value ? "text-slate-800" : "italic text-amber-700"}`}>{row.value || "MISSING_SOURCE - not found in tender document"}</p></div><select value="" disabled={saving === row.key} onChange={(event) => { const action = event.target.value; event.target.value = ""; if (action) void save(row, action); }} className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50" aria-label={`Action for ${row.label}`}><option value="">Action…</option><option value="EDIT_MANUALLY">Edit manually</option><option value="MARK_NOT_FOUND">Mark as not found in tender</option><option value="IGNORE_FOR_THIS_TENDER">Ignore for this tender</option><option value="MARK_NOT_APPLICABLE">Mark not applicable</option><option value="RETRY_ON_NEXT_ANALYZE">Retry on next AI Analyze</option></select></div></div>)}</div>}
  </section>;
}

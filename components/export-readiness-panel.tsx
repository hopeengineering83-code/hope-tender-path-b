"use client";

import { useRef, useState } from "react";

type Severity = "HIGH" | "MEDIUM" | "LOW";

type DocumentBlocker = {
  documentId: string;
  name: string;
  fileName: string;
  reasons: string[];
  severity: Severity;
  nextActions: string[];
};

type TenderLevelBlocker = {
  category: string;
  severity: string;
  title: string;
  recommendedAction?: string | null;
};

type ExportReadiness = {
  ok: boolean;
  tender: { id: string; title: string; status: string; stage: string; readinessScore: number };
  summary: { activeDocuments: number; documentBlockers: number; tenderLevelBlockers: number; totalBlockers: number };
  documentBlockers: DocumentBlocker[];
  tenderLevelBlockers: TenderLevelBlocker[];
  message: string;
};

type VaultOption = { id: string; fileName: string; category: string; score?: number };
type VaultCandidate = { rowId: string; rowName: string; suggestedCategories: string[]; options: VaultOption[] };

type RepairResult = {
  success?: boolean;
  error?: string;
  repaired?: number;
  skipped?: number;
  manualRequired?: number;
  plannedCreated?: number;
  letterheadAppliedCount?: number;
  finalExportReady?: boolean;
  remaining?: { documentBlockers?: number; tenderLevelBlockers?: number };
};

const SEVERITY_BADGE: Record<Severity, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};

function severityClass(severity: string): string {
  if (severity === "HIGH" || severity === "CRITICAL") return SEVERITY_BADGE.HIGH;
  if (severity === "MEDIUM") return SEVERITY_BADGE.MEDIUM;
  return SEVERITY_BADGE.LOW;
}

function isOriginalRequired(blocker: DocumentBlocker): boolean {
  const text = `${blocker.reasons.join(" ")} ${blocker.nextActions.join(" ")}`;
  return /ORIGINAL_REQUIRED|REPLACE_WITH_ORIGINAL|tender-issued original|official-original/i.test(text);
}

export function ExportReadinessPanel({ tenderId }: { tenderId: string }) {
  const [readiness, setReadiness] = useState<ExportReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [linkingVault, setLinkingVault] = useState(false);
  const [supersedingOutsidePlan, setSupersedingOutsidePlan] = useState(false);
  const [autoFinalizing, setAutoFinalizing] = useState(false);
  const [generatingMissing, setGeneratingMissing] = useState(false);
  const [vaultCandidates, setVaultCandidates] = useState<VaultCandidate[]>([]);
  const [selectedVaultOption, setSelectedVaultOption] = useState<Record<string, string>>({});
  const [attachingDocId, setAttachingDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);
  const [autoFinalizeRemaining, setAutoFinalizeRemaining] = useState<number | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const busy = loading || repairing || linkingVault || supersedingOutsidePlan || autoFinalizing || generatingMissing || Boolean(attachingDocId);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/export-readiness`, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Export readiness failed (${res.status})`);
      const r = data.exportReadiness;
      setReadiness(r);
      // Clear the "click again" nudge once the gate passes or blockers are resolved
      if (r?.ok || (r?.summary?.documentBlockers ?? 0) === 0) setAutoFinalizeRemaining(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export readiness failed");
    } finally {
      setLoading(false);
    }
  }

  async function generateMissingPlanned() {
    setGeneratingMissing(true);
    setError(null);
    setRepairMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/generate-missing-plan-files`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? `Generate missing files failed (${res.status})`);
      const total = (data.created ?? 0) + (data.updated ?? 0) + (data.convertedFromPlanned ?? 0);
      setRepairMessage(`Generated ${total} planned document placeholder(s). Re-checking readiness.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate missing planned files failed");
    } finally {
      setGeneratingMissing(false);
    }
  }

  async function repair() {
    setRepairing(true);
    setError(null);
    setRepairMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/repair-export-gaps`, { method: "POST" });
      const data = await res.json().catch(() => ({} as RepairResult));
      if (!res.ok || data.error) throw new Error(data.error ?? `Export repair failed (${res.status})`);
      const remainingDocs = data.remaining?.documentBlockers ?? 0;
      const remainingTender = data.remaining?.tenderLevelBlockers ?? 0;
      const manual = data.manualRequired ?? 0;
      const manualText = manual > 0 ? ` ${manual} official/manual file(s) were skipped and must be attached or reviewed manually.` : "";
      setRepairMessage(`Repair completed: ${data.repaired ?? 0} generated document(s) repaired, ${data.skipped ?? 0} already safe/skipped.${manualText} Remaining blockers: ${remainingDocs + remainingTender}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export repair failed");
    } finally {
      setRepairing(false);
    }
  }

  async function autoFinalize() {
    setAutoFinalizing(true);
    setError(null);
    setRepairMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/auto-finalize`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? `Auto-finalize failed (${res.status})`);
      const remaining = data.remainingCount ?? 0;
      setAutoFinalizeRemaining(remaining > 0 ? remaining : null);
      setRepairMessage(`Auto-finalize: processed ${data.processedCount ?? 0}, remaining ${remaining}. ${data.readinessOk ? "Export gate passed ✓" : remaining > 0 ? `${remaining} doc(s) still need finalization — click Auto-finalize again.` : "Re-check to refresh the gate."}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-finalize failed");
    } finally {
      setAutoFinalizing(false);
    }
  }

  async function attachOriginal(blocker: DocumentBlocker, file: File | null) {
    if (!file) return;
    setAttachingDocId(blocker.documentId);
    setError(null);
    setRepairMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/tenders/${tenderId}/documents/${blocker.documentId}/attach-original`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? `Attach original failed (${res.status})`);
      setRepairMessage(`Official original attached for ${blocker.fileName}. Re-checking export readiness.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attach original failed");
    } finally {
      setAttachingDocId(null);
      const input = fileInputs.current[blocker.documentId];
      if (input) input.value = "";
    }
  }

  async function linkVaultEvidence() {
    setLinkingVault(true);
    setError(null);
    setRepairMessage(null);
    try {
      const listRes = await fetch(`/api/tenders/${tenderId}/link-vault-evidence`, { method: "GET" });
      const listData = await listRes.json().catch(() => ({}));
      if (!listRes.ok) throw new Error(listData.error ?? `Vault evidence lookup failed (${listRes.status})`);
      const candidates = Array.isArray(listData.candidates) ? (listData.candidates as VaultCandidate[]) : [];
      setVaultCandidates(candidates);
      const defaults: Record<string, string> = {};
      for (const c of candidates) {
        if (c.options?.[0]?.id) defaults[c.rowId] = c.options[0].id;
      }
      setSelectedVaultOption(defaults);
      if (candidates.length === 0) {
        setRepairMessage("No vault-linkable blockers were found.");
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vault evidence linking failed");
    } finally {
      setLinkingVault(false);
    }
  }

  async function applySelectedVaultEvidence() {
    setLinkingVault(true);
    setError(null);
    try {
      let linked = 0;
      for (const candidate of vaultCandidates) {
        const selected = selectedVaultOption[candidate.rowId];
        if (!selected) continue;
        const res = await fetch(`/api/tenders/${tenderId}/link-vault-evidence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId: candidate.rowId, vaultDocumentId: selected }),
        });
        if (res.ok) linked += 1;
      }
      setRepairMessage(linked > 0 ? `Linked vault evidence for ${linked} document blocker(s).` : "No vault evidence links were applied.");
      setVaultCandidates([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Applying vault evidence failed");
    } finally {
      setLinkingVault(false);
    }
  }

  async function supersedeOutsidePlan() {
    setSupersedingOutsidePlan(true);
    setError(null);
    setRepairMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/supersede-outside-plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? `Supersede outside-plan failed (${res.status})`);
      setRepairMessage(`Superseded ${data.superseded ?? 0} outside-plan document(s).`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Supersede outside-plan failed");
    } finally {
      setSupersedingOutsidePlan(false);
    }
  }

  const ok = readiness?.ok;
  const hasDocumentBlockers = (readiness?.summary.documentBlockers ?? 0) > 0;

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm" id="export-readiness">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Export Readiness Gate</h3>
          <p className="mt-0.5 text-xs text-slate-500">Shows exactly why final ZIP/export is blocked and what to fix next.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {readiness && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
              {ok ? "READY" : `${readiness.summary.totalBlockers} blocker(s)`}
            </span>
          )}
          {readiness && !ok && hasDocumentBlockers && (
            <button type="button" onClick={() => void generateMissingPlanned()} disabled={busy} className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-medium text-white hover:bg-sky-800 disabled:opacity-50" title="Convert PLANNED document rows into draft control records so the export gate can proceed.">
              {generatingMissing ? "Generating…" : "Generate missing planned docs"}
            </button>
          )}
          {readiness && !ok && hasDocumentBlockers && (
            <div className="flex flex-col items-start gap-1">
              <button type="button" onClick={() => void autoFinalize()} disabled={busy} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50">
                {autoFinalizing ? "Auto-finalizing…" : "Auto-finalize for print/submission"}
              </button>
              <p className="text-[10px] text-slate-500 max-w-xs">Auto-finalize cleans 1–3 documents per click. Click multiple times until remaining = 0. Official original files still require manual attachment.</p>
            </div>
          )}
          {readiness && !ok && hasDocumentBlockers && (
            <button type="button" onClick={() => void repair()} disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50" title="Safely repair generated DOCX status/content mismatches only. Official tender forms/templates, original-required rows, PDFs, planned rows, and non-exportable records are skipped and must be handled manually.">
              {repairing ? "Repairing…" : "Repair safe document gaps"}
            </button>
          )}
          {readiness && !ok && hasDocumentBlockers && (
            <button type="button" onClick={() => void linkVaultEvidence()} disabled={busy} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-800 disabled:opacity-50">
              {linkingVault ? "Linking vault…" : "Use vault evidence"}
            </button>
          )}
          {readiness && !ok && hasDocumentBlockers && (
            <button type="button" onClick={() => void supersedeOutsidePlan()} disabled={busy} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50">
              {supersedingOutsidePlan ? "Superseding…" : "Exclude outside-plan files"}
            </button>
          )}
          <button type="button" onClick={() => void refresh()} disabled={busy} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {loading ? "Checking…" : readiness ? "Re-check" : "Check export gate"}
          </button>
          {readiness && ok && (
            <a
              href={`/api/tenders/${tenderId}/download`}
              download
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              title="All blockers cleared — download the final submission ZIP."
            >
              ⬇ Download Final ZIP
            </a>
          )}
          {readiness && !ok && (
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-lg bg-slate-200 px-3 py-2 text-xs font-medium text-slate-400"
              title={`Download blocked — resolve all ${readiness.summary.totalBlockers} blocker(s) above, then re-check.`}
            >
              ⬇ Download Final ZIP
            </button>
          )}
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {repairMessage && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">{repairMessage}</div>}
      {autoFinalizeRemaining !== null && autoFinalizeRemaining > 0 && !ok && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">
            <strong>{autoFinalizeRemaining} document{autoFinalizeRemaining === 1 ? "" : "s"}</strong> still need finalization.
            Click <strong>Auto-finalize for print/submission</strong> again to continue — each run processes up to 3 documents.
          </p>
          <button type="button" onClick={() => setAutoFinalizeRemaining(null)} className="shrink-0 text-amber-600 hover:text-amber-800 text-xs font-medium">✕</button>
        </div>
      )}

      {vaultCandidates.length > 0 && (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
          <p className="font-semibold text-indigo-800">Select vault evidence per blocker</p>
          <div className="mt-2 space-y-2">
            {vaultCandidates.map((candidate) => (
              <div key={candidate.rowId} className="rounded border border-indigo-100 bg-white p-2">
                <p className="font-medium text-slate-900">{candidate.rowName}</p>
                <select className="mt-1 w-full rounded border border-slate-300 p-1" value={selectedVaultOption[candidate.rowId] ?? ""} onChange={(e) => setSelectedVaultOption((prev) => ({ ...prev, [candidate.rowId]: e.target.value }))}>
                  <option value="">Select evidence…</option>
                  {candidate.options.map((opt) => <option key={opt.id} value={opt.id}>{opt.fileName} ({opt.category})</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void applySelectedVaultEvidence()} disabled={linkingVault} className="rounded bg-indigo-700 px-3 py-1 text-white">{linkingVault ? "Linking…" : "Apply selected vault evidence"}</button>
            <button type="button" onClick={() => setVaultCandidates([])} className="rounded border border-slate-300 bg-white px-3 py-1">Cancel</button>
          </div>
        </div>
      )}

      {!readiness && !loading && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          Run the export gate before final submission to verify generated files, validation, review status, file content, evaluator objections, and pricing leakage controls.
        </div>
      )}

      {readiness && (
        <div className="mt-4 space-y-4">
          <div className={`rounded-xl p-4 ${ok ? "border border-emerald-200 bg-emerald-50" : "border border-red-200 bg-red-50"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`text-sm font-semibold ${ok ? "text-emerald-900" : "text-red-900"}`}>{ok ? "Export gate passed" : "Export gate blocked"}</p>
                <p className={`mt-1 text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>{readiness.message}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-white/70 px-2 py-1"><p className="font-bold text-slate-900">{readiness.summary.activeDocuments}</p><p className="text-slate-500">Docs</p></div>
                <div className="rounded-lg bg-white/70 px-2 py-1"><p className="font-bold text-slate-900">{readiness.summary.documentBlockers}</p><p className="text-slate-500">Doc blockers</p></div>
                <div className="rounded-lg bg-white/70 px-2 py-1"><p className="font-bold text-slate-900">{readiness.summary.tenderLevelBlockers}</p><p className="text-slate-500">Tender blockers</p></div>
              </div>
            </div>
          </div>

          {!ok && (readiness.documentBlockers.length > 0 || readiness.tenderLevelBlockers.length > 0) && (
            <div className="rounded-xl border border-sky-100 bg-sky-50 p-3">
              <p className="text-xs font-semibold text-sky-900">How to clear blockers</p>
              <ol className="mt-2 space-y-1 pl-4 text-xs text-sky-800 list-decimal">
                <li>Click <strong>Generate missing planned docs</strong> to convert any PLANNED rows into draft placeholders.</li>
                <li>For official-original rows (bid forms, tender templates): click <strong>Attach official original</strong> on each blocker below.</li>
                <li>Click <strong>Repair safe document gaps</strong> — automatically cleans AI traces, pricing leakage, and placeholders from generated DOCX files.</li>
                <li>If blockers remain: click <strong>Auto-finalize for print/submission</strong> to AI-polish and mark safe documents ready for export. Run again if <em>remainingCount &gt; 0</em>.</li>
                <li>If outside-plan files are present: click <strong>Exclude outside-plan files</strong>.</li>
                <li>Click <strong>Re-check</strong> to refresh the gate.</li>
              </ol>
              <p className="mt-2 text-[10px] text-sky-600">Manual action required only for: tender-issued official forms/templates, missing company evidence not in Knowledge Vault, or missing official tender source file.</p>
            </div>
          )}

          {readiness.tenderLevelBlockers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Tender-level blockers</p>
              <ul className="mt-2 space-y-2">
                {readiness.tenderLevelBlockers.map((blocker, i) => (
                  <li key={`${blocker.category}-${i}`} className="rounded-lg border border-red-100 bg-white p-3 text-xs">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${severityClass(blocker.severity)}`}>{blocker.severity}</span>
                      <div>
                        <p className="font-medium text-slate-900">{blocker.title}</p>
                        <p className="mt-0.5 text-slate-500">{blocker.category}</p>
                        {blocker.recommendedAction && <p className="mt-1 text-slate-700">Action: {blocker.recommendedAction}</p>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {readiness.documentBlockers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Document blockers</p>
              <ul className="mt-2 space-y-2">
                {readiness.documentBlockers.map((blocker) => (
                  <li key={blocker.documentId} className="rounded-lg border border-slate-100 bg-white p-3 text-xs">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE[blocker.severity]}`}>{blocker.severity}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">{blocker.fileName}</p>
                            <p className="mt-0.5 text-slate-500">{blocker.name}</p>
                          </div>
                          {isOriginalRequired(blocker) && (
                            <div className="shrink-0">
                              <input ref={(el) => { fileInputs.current[blocker.documentId] = el; }} type="file" accept=".doc,.docx,.pdf,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(event) => void attachOriginal(blocker, event.target.files?.[0] ?? null)} />
                              <button type="button" onClick={() => fileInputs.current[blocker.documentId]?.click()} disabled={busy} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50" title="Attach the exact tender-issued original form/template. This does not regenerate the form.">
                                {attachingDocId === blocker.documentId ? "Attaching…" : "Attach official original"}
                              </button>
                            </div>
                          )}
                        </div>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-600">{blocker.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-emerald-700">{blocker.nextActions.map((action, i) => <li key={i}>{action}</li>)}</ul>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

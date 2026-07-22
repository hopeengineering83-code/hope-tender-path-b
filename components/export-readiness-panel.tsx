"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, WarningIcon, BoltIcon, CheckCircleIcon, RefreshIcon, DownloadIcon, LockIcon, PaperclipIcon, BanIcon, CrossIcon } from "./icons";
import { subscribeTenderWorkflowSync } from "../lib/ui/tender-workflow-sync";
import { DisclosureAnchorLink } from "./disclosure-anchor-link";

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

type AdvisoryWarning = TenderLevelBlocker & {
  code?: string;
  resolved?: boolean;
  resolutionNote?: string | null;
};

type EnvelopeBreakdown = { TECHNICAL?: number; FINANCIAL?: number; ADMIN?: number };

type ExportReadiness = {
  ok: boolean;
  tender: { id: string; title: string; status: string; stage: string; readinessScore: number };
  summary: {
    activeDocuments: number;
    documentBlockers: number;
    tenderLevelBlockers: number;
    advisoryWarnings?: number;
    totalBlockers: number;
    finalExportCandidates?: number;
    workspaceDocuments?: number;
    excludedInternalRows?: number;
    envelopeBreakdown?: EnvelopeBreakdown;
    strictTwoEnvelope?: boolean;
    packageMode?: string;
    planStatus?: string;
  };
  documentBlockers: DocumentBlocker[];
  tenderLevelBlockers: TenderLevelBlocker[];
  advisoryWarnings?: AdvisoryWarning[];
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

const ADVISORY_RESOLUTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "NOT_REQUIRED_BY_TOR", label: "Not required by ToR" },
  { value: "POST_AWARD_DELIVERABLE", label: "Post-award deliverable" },
  { value: "DONOR_TEMPLATE_PROVIDED", label: "Donor template provided" },
  { value: "ADDED_TO_TECHNICAL", label: "Already added to technical proposal" },
];

export function ExportReadinessPanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const router = useRouter();
  const [readiness, setReadiness] = useState<ExportReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [linkingVault, setLinkingVault] = useState(false);
  const [supersedingOutsidePlan, setSupersedingOutsidePlan] = useState(false);
  const [autoFinalizing, setAutoFinalizing] = useState(false);
  const [resolvingAdvisory, setResolvingAdvisory] = useState<string | null>(null);
  const [vaultCandidates, setVaultCandidates] = useState<VaultCandidate[]>([]);
  const [selectedVaultOption, setSelectedVaultOption] = useState<Record<string, string>>({});
  const [attachingDocId, setAttachingDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);
  const [autoFinalizeRemaining, setAutoFinalizeRemaining] = useState<number | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [repairingSource, setRepairingSource] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [deduplicating, setDeduplicating] = useState(false);
  const [repairingAssets, setRepairingAssets] = useState(false);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const busy = loading || repairing || linkingVault || supersedingOutsidePlan || autoFinalizing || Boolean(attachingDocId) || Boolean(resolvingAdvisory) || repairingSource || reclassifying || deduplicating || repairingAssets;

  const refresh = useCallback(async () => {
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
      router.refresh();
    } catch {
      // Never expose raw Prisma error text to UI.
      // Use safe generic message — raw error details are logged server-side only.
      setError("Export readiness check failed. Refresh to retry. If the problem persists, contact admin.");
    } finally {
      setLoading(false);
    }
  }, [router, tenderId]);

  // Subscribe to cross-panel workflow sync so this panel refreshes when
  // other panels (workflow center, recovery center) take actions.
  useEffect(() => subscribeTenderWorkflowSync(tenderId, () => { void refresh(); }), [refresh, tenderId]);

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
      setError("Export repair failed. Refresh to retry.");
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
      setRepairMessage(`Auto-finalize: processed ${data.processedCount ?? 0}, remaining ${remaining}. ${data.readinessOk ? "Export gate passed" : remaining > 0 ? `${remaining} doc(s) still need finalization — click Auto-finalize again.` : "Re-check to refresh the gate."}`);
      await refresh();
    } catch (err) {
      setError("Auto-finalize failed. Refresh to retry.");
    } finally {
      setAutoFinalizing(false);
    }
  }

  async function resolveAdvisory(code: string, resolution: string) {
    setResolvingAdvisory(code);
    setError(null);
    setRepairMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/advisory-resolutions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, resolution }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? `Advisory resolution failed (${res.status})`);
      setRepairMessage(`Marked advisory ${code} as ${resolution.toLowerCase().replace(/_/g, " ")}. Re-checking readiness.`);
      await refresh();
    } catch (err) {
      setError("Advisory resolution failed. Refresh to retry.");
    } finally {
      setResolvingAdvisory(null);
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
      setError("Attach original failed. Refresh to retry.");
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
      setError("Vault evidence linking failed. Refresh to retry.");
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
      setError("Applying vault evidence failed. Refresh to retry.");
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
      setError("Supersede outside-plan failed. Refresh to retry.");
    } finally {
      setSupersedingOutsidePlan(false);
    }
  }


  async function approveRegexFallback() {
    // An approval note is a real audit record of why a human accepted
    // regex-fallback output as authoritative — it must reflect this
    // reviewer's actual justification, not a canned string every approval
    // shares (that reduces the audit trail to a checkbox, matching the
    // required-note behavior tender-recovery-command-center.tsx already
    // enforces for the same APPROVE_FALLBACK_WITH_NOTE action).
    const note = approvalNote.trim();
    if (!note) { setError("An approval note is required."); return; }
    try {
      const res = await fetch(`/api/tenders/${tenderId}/approve-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = (await res.json().catch(() => ({} as Record<string, unknown>))) as { success?: boolean; error?: string };
      if (data.success) {
        setRepairMessage("Fallback note saved for audit. Re-checking readiness — generation and export remain blocked until full AI analysis succeeds.");
        setApprovalNote("");
      } else {
        setError((data.error as string | undefined) ?? "Failed to approve fallback analysis");
      }
    } catch {
      setError("Failed to approve fallback analysis");
    } finally {
      await refresh();
    }
  }

  async function repairSourceGrounding() {
    setRepairingSource(true);
    setError(null);
    setRepairMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/repair-source-grounding`, { method: "POST" });
      const data = (await res.json().catch(() => ({} as Record<string, unknown>))) as { success?: boolean; repairedCount?: number; remainingCount?: number; error?: string };
      if (data.success) {
        setRepairMessage(`Source grounding: ${data.repairedCount ?? 0} requirement(s) repaired. ${data.remainingCount ? `${data.remainingCount} still need manual review.` : "All repaired."}`);
      } else {
        setError((data.error as string | undefined) ?? "Source grounding repair failed");
      }
    } catch {
      setError("Source grounding repair failed");
    } finally {
      setRepairingSource(false);
      await refresh();
    }
  }

  async function reclassifyDocuments() {
    setReclassifying(true);
    setError(null);
    setRepairMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/reclassify-documents`, { method: "POST" });
      const data = (await res.json().catch(() => ({} as Record<string, unknown>))) as { success?: boolean; changed?: number; error?: string };
      if (data.success) {
        setRepairMessage(`Reclassified ${data.changed ?? 0} document type(s). Re-checking readiness…`);
      } else {
        setError((data.error as string | undefined) ?? "Reclassification failed");
      }
    } catch {
      setError("Reclassification failed");
    } finally {
      setReclassifying(false);
      await refresh();
    }
  }

  async function deduplicateDocuments() {
    setDeduplicating(true);
    setError(null);
    setRepairMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/deduplicate-documents`, { method: "POST" });
      const data = (await res.json().catch(() => ({} as Record<string, unknown>))) as { success?: boolean; duplicatesFound?: number; error?: string };
      if (data.success) {
        setRepairMessage(`Deduplicated ${data.duplicatesFound ?? 0} row(s). Re-checking readiness…`);
      } else {
        setError((data.error as string | undefined) ?? "Deduplication failed");
      }
    } catch {
      setError("Deduplication failed");
    } finally {
      setDeduplicating(false);
      await refresh();
    }
  }

  async function repairExportPolicyAssets() {
    setRepairingAssets(true);
    setError(null);
    setRepairMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/export-policy/repair-assets`, { method: "POST" });
      const data = (await res.json().catch(() => ({} as Record<string, unknown>))) as { ok?: boolean; changed?: number; message?: string; conflicts?: string[]; error?: string };
      if (data.ok) {
        const conflicts = (data.conflicts ?? []).join(", ");
        setRepairMessage(data.changed === 0
          ? "No prohibited asset conflicts found."
          : `Marked ${data.changed} document(s) for regeneration (conflicts: ${conflicts}).`);
      } else {
        setError(data.error ?? "Asset repair failed");
      }
    } catch {
      setError("Asset repair failed");
    } finally {
      setRepairingAssets(false);
      await refresh();
    }
  }

  const ok = readiness?.ok;
  const hasDocumentBlockers = (readiness?.summary.documentBlockers ?? 0) > 0;
  const advisoryWarnings = readiness?.advisoryWarnings ?? [];
  const advisoryCount = readiness?.summary.advisoryWarnings ?? advisoryWarnings.length;
  const strictTwoEnvelope = readiness?.summary.strictTwoEnvelope ?? false;
  const envelopeBreakdown = readiness?.summary.envelopeBreakdown;

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm" id="export-readiness">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Export Readiness Gate</h3>
          <p className="mt-0.5 text-xs text-slate-500">Shows exactly why final ZIP/export is blocked and what to fix next. Advisory warnings do not block the gate.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {readiness && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
              {ok ? "READY" : `${readiness.summary.totalBlockers} blocker(s)`}
            </span>
          )}
          {canMutate && readiness && !ok && hasDocumentBlockers && (
            // Links to the one canonical Generate Missing Plan Files control
            // (submission-plan-reconciliation-panel.tsx's
            // #submission-plan-reconciliation, which shows the exact missing
            // count) instead of a second, separate button here that POSTs
            // the same /generate-missing-plan-files route without that
            // context.
            <DisclosureAnchorLink href="#submission-plan-reconciliation" className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-xs font-medium text-white hover:bg-sky-800" title="Go to Submission plan reconciliation to generate missing planned docs">
              <BoltIcon /> Go to Generate missing planned docs
            </DisclosureAnchorLink>
          )}
          {canMutate && readiness && !ok && hasDocumentBlockers && (
            <div className="flex flex-col items-start gap-1">
              <button type="button" onClick={() => void autoFinalize()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-60" title="Auto-finalize documents for print/submission">
                <CheckCircleIcon /> {autoFinalizing ? "Auto-finalizing…" : "Auto-finalize for print/submission"}
              </button>
              <p className="text-[10px] text-slate-500 max-w-xs">Auto-finalize cleans 1–3 documents per click. Click multiple times until remaining = 0. Official original files still require manual attachment.</p>
            </div>
          )}
          {canMutate && readiness && !ok && hasDocumentBlockers && (
            <button type="button" onClick={() => void repair()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60" title="Safely repair generated DOCX status/content mismatches only. Official tender forms/templates, original-required rows, PDFs, planned rows, and non-exportable records are skipped and must be handled manually.">
              <RefreshIcon /> {repairing ? "Repairing…" : "Repair safe document gaps"}
            </button>
          )}
          {canMutate && readiness && !ok && hasDocumentBlockers && (
            <button type="button" onClick={() => void linkVaultEvidence()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-800 disabled:opacity-60" title="Link vault evidence to strengthen mandatory requirement coverage">
              <PaperclipIcon /> {linkingVault ? "Linking vault…" : "Use vault evidence"}
            </button>
          )}
          {canMutate && readiness && !ok && (
            <button
              type="button"
              onClick={() => void repairSourceGrounding()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60"
              title="Extract source page/section/quote for mandatory requirements that lack traceability."
            >
              <RefreshIcon /> {repairingSource ? "Repairing…" : "Repair source references"}
            </button>
          )}
          {canMutate && readiness && !ok && (
            <button
              type="button"
              onClick={() => void reclassifyDocuments()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-2 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-60"
              title="Reclassify mistyped documents (e.g. financial evidence marked as TECHNICAL_PROPOSAL)."
            >
              <RefreshIcon /> {reclassifying ? "Reclassifying…" : "Fix document types"}
            </button>
          )}
          {canMutate && readiness && !ok && (
            <button
              type="button"
              onClick={() => void deduplicateDocuments()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-700 px-3 py-2 text-xs font-medium text-white hover:bg-orange-800 disabled:opacity-60"
              title="Find and supersede duplicate document rows (same name+type, multiple versions)."
            >
              <RefreshIcon /> {deduplicating ? "Deduplicating…" : "Clean duplicate rows"}
            </button>
          )}
          {readiness && readiness.tenderLevelBlockers.some((b) => b.category === "PROHIBITED_ASSET") && (
            <button
              type="button"
              onClick={() => void repairExportPolicyAssets()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              title="Check for prohibited branding/signature/stamp in generated documents and mark affected docs for regeneration."
            >
              <WarningIcon /> {repairingAssets ? "Checking…" : "Repair prohibited assets"}
            </button>
          )}
          {readiness && !ok && hasDocumentBlockers && (
            <button type="button" onClick={() => void supersedeOutsidePlan()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-60" title="Exclude outside-plan files from the final submission">
              <BanIcon /> {supersedingOutsidePlan ? "Superseding…" : "Exclude outside-plan files"}
            </button>
          )}
          <button type="button" onClick={() => void refresh()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60" title="Re-check the export readiness gate">
            <RefreshIcon /> {loading ? "Checking…" : readiness ? "Re-check" : "Check export gate"}
          </button>
          {/* Download affordance — ONLY renders a real <a href> when the
              canonical gate is open. When blocked, render a disabled
              <button> with NO href so the user cannot accidentally hit
              the URL. The download route also enforces this server-side. */}
          {readiness && ok && !strictTwoEnvelope && (
            <a
              href={`/api/tenders/${tenderId}/download?type=zip`}
              download
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              title="All blockers cleared — download the final submission ZIP."
            >
              <DownloadIcon /> Download Final ZIP
            </a>
          )}
          {readiness && ok && strictTwoEnvelope && (
            <div className="flex flex-wrap gap-1">
              <a
                href={`/api/tenders/${tenderId}/download?type=zip&envelope=technical`}
                download
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
                title="Two-envelope tender — download the TECHNICAL ZIP only."
              >
                <DownloadIcon /> Technical ZIP
              </a>
              <a
                href={`/api/tenders/${tenderId}/download?type=zip&envelope=financial`}
                download
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-800"
                title="Two-envelope tender — download the FINANCIAL ZIP separately."
              >
                <DownloadIcon /> Financial ZIP
              </a>
              {(envelopeBreakdown?.ADMIN ?? 0) > 0 && (
                <a
                  href={`/api/tenders/${tenderId}/download?type=zip&envelope=admin`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-600 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700"
                  title="Two-envelope tender — admin/eligibility ZIP."
                >
                  <DownloadIcon /> Admin ZIP
                </a>
              )}
            </div>
          )}
          {readiness && !ok && (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex items-center gap-1.5 cursor-not-allowed rounded-lg bg-slate-200 px-3 py-2 text-xs font-medium text-slate-500"
              title={`Download blocked — resolve all ${readiness.summary.totalBlockers} blocker(s) above, then re-check.`}
            >
              <LockIcon /> Download blocked — resolve blockers first
            </button>
          )}
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {/* Structured blocker display — shows when export readiness returns ok:false
          with primaryBlockerReason. This replaces the generic failure message
          with actionable guidance. */}
      {readiness && !readiness.ok && (readiness as { primaryBlockerReason?: string | null }).primaryBlockerReason && !error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs">
          <p className="font-semibold text-red-700">Primary blocker: {(readiness as { primaryBlockerReason?: string | null }).primaryBlockerReason}</p>
          {(readiness as { primaryFixAction?: string | null }).primaryFixAction && (
            <p className="mt-0.5 text-red-600">Next action: {(readiness as { primaryFixAction?: string | null }).primaryFixAction}</p>
          )}
        </div>
      )}
      {repairMessage && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">{repairMessage}</div>}
      {autoFinalizeRemaining !== null && autoFinalizeRemaining > 0 && !ok && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">
            <strong>{autoFinalizeRemaining} document{autoFinalizeRemaining === 1 ? "" : "s"}</strong> still need finalization.
            Click <strong>Auto-finalize for print/submission</strong> again to continue — each run processes up to 3 documents.
          </p>
          <button type="button" onClick={() => setAutoFinalizeRemaining(null)} aria-label="Dismiss auto-finalize notice" className="inline-flex items-center shrink-0 text-amber-600 hover:text-amber-800 text-xs font-medium"><CrossIcon /></button>
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
                <p className={`mt-1 text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>
                  {readiness.summary.documentBlockers} document blocker(s) · {readiness.summary.tenderLevelBlockers} tender blocker(s) · {advisoryCount} advisory warning(s)
                </p>
                {strictTwoEnvelope && (
                  <p className="mt-1 text-[11px] font-medium text-amber-700">
                    Strict two-envelope tender — download separate technical and financial ZIPs.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-white/70 px-2 py-1"><p className="font-bold text-slate-900">{readiness.summary.finalExportCandidates ?? readiness.summary.activeDocuments}</p><p className="text-slate-500">Export docs</p></div>
                <div className="rounded-lg bg-white/70 px-2 py-1"><p className="font-bold text-slate-900">{readiness.summary.documentBlockers}</p><p className="text-slate-500">Doc blockers</p></div>
                <div className="rounded-lg bg-white/70 px-2 py-1"><p className="font-bold text-slate-900">{readiness.summary.tenderLevelBlockers}</p><p className="text-slate-500">Tender blockers</p></div>
              </div>
              {(readiness.summary.excludedInternalRows ?? 0) > 0 && (
                <p className="mt-1 text-[11px] text-slate-400">
                  {readiness.summary.excludedInternalRows} historical/superseded row(s) archived — not in export package.
                </p>
              )}
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
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-sky-200 pt-2">
                <p className="text-[10px] font-semibold text-sky-700 uppercase tracking-wide">Severity legend:</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE.HIGH}`}>HIGH — blocks export</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE.MEDIUM}`}>MEDIUM — blocks export</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE.LOW}`}>LOW — advisory only</span>
              </div>
            </div>
          )}

          {readiness.tenderLevelBlockers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Tender-level blockers</p>
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
              {readiness.tenderLevelBlockers.some((b) => b.category === "ANALYSIS_REGEX_FALLBACK_UNAPPROVED") && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-800"><WarningIcon /> Regex fallback analysis — recovery actions:</p>
                  <div className="flex flex-wrap gap-2">
                    {/* Links to the one canonical AI Analyze control
                        (ai-analyze-panel.tsx's #ai-analyze-section, which
                        uses ?mode=background) instead of re-running analysis
                        via a second, separate synchronous/SSE-bounded POST
                        here — that path is explicitly documented in the
                        route itself as bounded by the Vercel function limit,
                        the same class of gap fixed earlier in
                        tender-recovery-command-center.tsx for RUN_ENGINE. */}
                    <DisclosureAnchorLink href="#ai-analyze-section" className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100" title="Go to AI Analyze to re-run analysis with all available providers">
                      <RefreshIcon /> Go to Retry AI Analysis
                    </DisclosureAnchorLink>
                    <button
                      type="button"
                      onClick={() => void approveRegexFallback()}
                      disabled={busy || !approvalNote.trim()}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                      title="Manually review and approve the regex-extracted tender requirements. Only use this if the extracted requirements are accurate."
                    >
                      <CheckIcon /> Approve fallback analysis (manual review)
                    </button>
                  </div>
                  {/* A real, reviewer-written justification — not a canned
                      note — is required before approval, matching
                      tender-recovery-command-center.tsx's required-note
                      behavior for the same action. */}
                  <input
                    type="text"
                    value={approvalNote}
                    onChange={(e) => setApprovalNote(e.target.value)}
                    placeholder="Approval note (required)…"
                    className="mt-2 w-full max-w-md rounded border border-amber-200 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400"
                    maxLength={500}
                  />
                  <p className="mt-1 text-[10px] text-amber-700">
                    Retry AI Analysis re-runs the tender analysis with all available AI providers. Approve fallback only if you have manually verified the extracted requirements are correct.
                  </p>
                </div>
              )}
            </div>
          )}

          {readiness.documentBlockers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Document blockers</p>
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
                              <button type="button" onClick={() => fileInputs.current[blocker.documentId]?.click()} disabled={busy} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60" title="Attach the exact tender-issued original form/template. This does not regenerate the form.">
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

          {advisoryWarnings.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Advisory warnings (do not block export)</p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                Missing donor safeguard artefacts are advisory by default and become blockers only when the tender/ToR explicitly requires them as submission deliverables.
              </p>
              <ul className="mt-2 space-y-2">
                {advisoryWarnings.map((advisory, i) => (
                  <li key={`${advisory.category}-${i}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">ADVISORY</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">{advisory.title}</p>
                        <p className="mt-0.5 text-slate-600">{advisory.category}</p>
                        {advisory.recommendedAction && <p className="mt-1 text-slate-700">Suggested: {advisory.recommendedAction}</p>}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {ADVISORY_RESOLUTION_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              disabled={busy || resolvingAdvisory === advisory.category}
                              onClick={() => void resolveAdvisory(advisory.category, opt.value)}
                              className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[10px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                              title={`Mark this advisory as ${opt.label} (does not affect blockers).`}
                            >
                              {resolvingAdvisory === advisory.category ? "…" : opt.label}
                            </button>
                          ))}
                        </div>
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

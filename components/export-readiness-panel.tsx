"use client";

import { useCallback, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, WarningIcon, CheckCircleIcon, DownloadIcon, LockIcon } from "./icons";
import { subscribeTenderWorkflowSync } from "../lib/ui/tender-workflow-sync";

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

const SEVERITY_BADGE: Record<Severity, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-slate-100 text-slate-600",
};

function severityClass(severity: string): string {
  if (severity === "HIGH" || severity === "CRITICAL") return SEVERITY_BADGE.HIGH;
  if (severity === "MEDIUM") return SEVERITY_BADGE.MEDIUM;
  return SEVERITY_BADGE.LOW;
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
  const [resolvingAdvisory, setResolvingAdvisory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);
  const [approvalNote, setApprovalNote] = useState("");

  const busy = loading || repairing || Boolean(resolvingAdvisory);

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
      router.refresh();
    } catch {
      // Never expose raw Prisma error text to UI.
      // Use safe generic message — raw error details are logged server-side only.
      setError("Export readiness check failed.");
    } finally {
      setLoading(false);
    }
  }, [router, tenderId]);

  // Subscribe to cross-panel workflow sync so this panel refreshes when
  // other panels (workflow center, recovery center) take actions.
  useEffect(() => subscribeTenderWorkflowSync(tenderId, () => { void refresh(); }), [refresh, tenderId]);



  // Dead code removed: repair(), autoFinalize(), linkVaultEvidence(),
  // applySelectedVaultEvidence(), supersedeOutsidePlan(),
  // repairSourceGrounding(), reclassifyDocuments(), deduplicateDocuments().
  // These functions were called by bureaucracy buttons that have been removed.
  // Safe repairs now run automatically via AUTO_FINALIZE.

  async function approveRegexFallback() {
    // An approval note is a real audit record of why a human accepted
    // regex-fallback output as authoritative — it must reflect this
    // reviewer's actual justification, not a canned string every approval
    // shares (that reduces the audit trail to a checkbox).
    const note = approvalNote.trim();
    if (!note) { setError("An approval note is required."); return; }
    setRepairing(true);
    setError(null);
    setRepairMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/approve-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = (await res.json().catch(() => ({} as Record<string, unknown>))) as { success?: boolean; error?: string };
      if (data.success) {
        setRepairMessage("Fallback note saved for audit. Refreshing — generation and export remain blocked until full AI analysis succeeds.");
        setApprovalNote("");
      } else {
        setError((data.error as string | undefined) ?? "Failed to approve fallback analysis");
      }
    } catch {
      setError("Approve fallback failed.");
    } finally {
      setRepairing(false);
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
      setRepairMessage(`Marked advisory ${code} as ${resolution.toLowerCase().replace(/_/g, " ")}. Refreshing.`);
      await refresh();
    } catch (err) {
      setError("Advisory resolution failed.");
    } finally {
      setResolvingAdvisory(null);
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
          {canMutate && readiness && !ok && hasDocumentBlockers && null}
          {/* All safe repairs run automatically via AUTO_FINALIZE.
              Manual action: Download Final ZIP (canonical download). */}
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
              title={`Download blocked — resolve all ${readiness.summary.totalBlockers} blocker(s) above, then check.`}
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
      
      {/* Vault evidence modal removed — linkVaultEvidence() and
          applySelectedVaultEvidence() are dead code. Vault evidence
          linking runs automatically via reconcileAutomaticRequirementCoverage. */}

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
                  <p className="mt-1 text-[11px] font-medium text-amber-800">
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
                <li>Missing planned documents are generated <strong>automatically</strong> by the AUTO_FINALIZE job — no manual action needed.</li>
                <li>Safe repairs (AI traces, pricing leakage, placeholders, source grounding) run <strong>automatically</strong> after generation — no manual button needed.</li>
              </ol>
              <p className="mt-2 text-[10px] text-sky-600">AI Analyze and Run Engine are manual. Safe downstream processing then runs automatically; genuine source, legal, authority, or final-owner blockers remain fail-closed before package download.</p>
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
                        the same class of gap fixed by generation-readiness-
                        panel.tsx's anchors for the automatic stages. */}
                    {/* "Go to Retry AI Analysis" link removed — AI analysis retries
                        automatically via the durable retry policy. The approve
                        fallback button below is a genuine human legal decision. */}
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
                      note — is required before approval. */}
                  <input
                    type="text"
                    value={approvalNote}
                    onChange={(e) => setApprovalNote(e.target.value)}
                    placeholder="Approval note (required)…"
                    className="mt-2 w-full max-w-md rounded border border-amber-200 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400"
                    maxLength={500}
                  />
                  <p className="mt-1 text-[10px] text-amber-800">
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
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Advisory warnings (do not block export)</p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                Missing donor safeguard artefacts are advisory by default and become blockers only when the tender/ToR explicitly requires them as submission deliverables.
              </p>
              <ul className="mt-2 space-y-2">
                {advisoryWarnings.map((advisory, i) => (
                  <li key={`${advisory.category}-${i}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">ADVISORY</span>
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

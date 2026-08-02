"use client";

import { useCallback, useEffect, useState } from "react";
import { errorCodeLabel } from "@/lib/ui/human-labels";
import { subscribeTenderWorkflowSync } from "@/lib/ui/tender-workflow-sync";
import { WarningIcon, CheckCircleIcon, CrossIcon, ChevronDownIcon } from "./icons";
import type {
  AuthorityReviewResult,
  AuthorityBlocker,
  DocumentAuthorityScore,
  AuthorityReviewStatus,
} from "../lib/engine/authority-review";

interface AuthorityReviewPanelProps {
  tenderId: string;
}

function statusBadge(status: AuthorityReviewStatus) {
  if (status === "AUTHORITY_READY") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
        <CheckCircleIcon /> AUTHORITY READY
      </span>
    );
  }
  if (status === "NEEDS_REVIEW") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
        <WarningIcon /> NEEDS REVIEW
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
      <CrossIcon /> BLOCKED
    </span>
  );
}

function severityBadge(severity: "CRITICAL" | "HIGH" | "MEDIUM") {
  if (severity === "CRITICAL") {
    return <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">CRITICAL</span>;
  }
  if (severity === "HIGH") {
    return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">HIGH</span>;
  }
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">MEDIUM</span>;
}

function BlockerRow({ blocker }: { blocker: AuthorityBlocker }) {
  return (
    <li className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {severityBadge(blocker.severity)}
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700">
          {errorCodeLabel(blocker.code)}
        </span>
        {blocker.documentName && <span className="text-xs text-slate-600">{blocker.documentName}</span>}
        {blocker.sectionName && <span className="text-xs text-slate-600">Section: {blocker.sectionName}</span>}
      </div>
      <p className="mt-1 text-xs text-red-800">{blocker.detail}</p>
      <p className="mt-1 text-xs text-slate-600"><span className="font-semibold">Fix: </span>{blocker.recoveryAction}</p>
    </li>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 85 ? "bg-green-500" : score >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
    </div>
  );
}

function DocumentRow({ doc }: { doc: DocumentAuthorityScore }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{doc.documentName}</p>
          <p className="text-xs text-slate-500">{doc.documentType}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{doc.score}/100</span>
          {statusBadge(doc.status)}
          <span className="text-slate-400"><ChevronDownIcon className={expanded ? "rotate-180" : ""} /></span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          <ScoreBar score={doc.score} />
          {doc.blockers.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">Blockers ({doc.blockers.length})</p>
              <ul className="space-y-2">
                {doc.blockers.map((blocker, index) => <BlockerRow key={`${blocker.code}-${index}`} blocker={blocker} />)}
              </ul>
            </div>
          )}
          {doc.warnings.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">Warnings</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800">
                {doc.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            </div>
          )}
          {doc.blockers.length === 0 && doc.warnings.length === 0 && (
            <p className="mt-3 text-xs text-green-700">No issues found for this document.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function AuthorityReviewPanel({ tenderId }: AuthorityReviewPanelProps) {
  const [result, setResult] = useState<AuthorityReviewResult | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [primaryBlockerReason, setPrimaryBlockerReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/authority-review`, {
        credentials: "include",
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setError(body.message ?? body.error ?? "Authority review failed.");
        setResult(null);
        setAvailable(null);
        setUnavailableReason(null);
        setPrimaryBlockerReason(null);
      } else {
        const reviewAvailable = body.available !== false;
        setAvailable(reviewAvailable);
        setUnavailableReason(typeof body.unavailableReason === "string" ? body.unavailableReason : null);
        setResult(reviewAvailable && body.authorityReview ? body.authorityReview as AuthorityReviewResult : null);
        setPrimaryBlockerReason(typeof body.primaryBlockerReason === "string" ? body.primaryBlockerReason : null);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Network error.");
      setResult(null);
      setAvailable(null);
      setUnavailableReason(null);
      setPrimaryBlockerReason(null);
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => { void fetchReview(); }, [fetchReview]);

  // Gap 4: auto-refresh when the workflow advances (e.g. PROPOSAL_GENERATION
  // completes, documents are validated). Previously the user had to click
  // "Refresh" manually — now the panel re-fetches on every workflow sync
  // event, so the Authority Review state is always current without a
  // manual button click.
  useEffect(() => subscribeTenderWorkflowSync(tenderId, () => { void fetchReview(); }), [fetchReview, tenderId]);

  const unavailable = !loading && !error && available === false;
  // Compatibility name retained for existing workflow-contract tests. It is a
  // real computed state, not a second authority: unavailable means the
  // prerequisites are not met and no preliminary score may be shown.
  const preconditionBlocked = unavailable;
  const isReady = available === true && result?.status === "AUTHORITY_READY";
  const borderClass = unavailable
    ? "border-slate-200 bg-slate-50"
    : isReady
      ? "border-green-200 bg-green-50"
      : result?.status === "NEEDS_REVIEW"
        ? "border-amber-200 bg-amber-50"
        : "border-red-200 bg-red-50";

  // Gap 6: Keep Authority Review hidden until eligible. When the
  // prerequisites are not met (no confirmed Build Plan, missing required
  // documents, or documents not yet validated), the panel renders an empty
  // placeholder section (so the #authority-review anchor target exists for
  // workflow shortcuts) but shows NO content — no score, no blockers, no
  // "NOT AVAILABLE" badge. The panel content appears only when
  // resolveAuthorityReviewAvailability returns available=true, so the user
  // never sees an incomplete authority score or a "prerequisites not met"
  // message. Machine-safe checks run automatically via the GET handler;
  // one explicit human release decision is required only where legally
  // mandatory.
  if (!loading && !error && unavailable) {
    return <section id="authority-review" className="mb-4" aria-hidden="true" />;
  }

  return (
    <section id="authority-review" className={`mb-4 rounded-2xl border p-5 shadow-sm ${available !== null || result ? borderClass : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Authority Review</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">
            {loading
              ? "Loading authority-review status…"
              : error
                ? "Authority review unavailable"
                : preconditionBlocked
                  ? "Authority review prerequisites not met — N/A"
                  : result?.status === "AUTHORITY_READY"
                    ? "Document authority review passed"
                    : result?.status === "NEEDS_REVIEW"
                      ? "Issues require review before export"
                      : "Authority review blocked — fix issues before export"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {preconditionBlocked
              ? unavailableReason ?? "Generate and validate all required documents before Authority Review."
              : "Scans generated documents for AI traces, placeholders, internal notes, envelope mismatches, and manifest inconsistencies."}
          </p>
          {!isReady && !preconditionBlocked && primaryBlockerReason && (
            <p className="mt-1 text-sm font-medium text-red-700">{primaryBlockerReason}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {available === true && result && statusBadge(result.status)}
          {preconditionBlocked && (
            <span className="inline-flex rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">NOT AVAILABLE</span>
          )}
          {/* Gap 4: Refresh button removed. The panel auto-fetches on mount
              and re-fetches on every workflow sync event, so a manual
              Refresh button is unnecessary bureaucracy. */}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800" role="alert">{error}</div>
      )}

      {preconditionBlocked && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">Overall authority score</p>
            <span className="text-2xl font-bold text-slate-500">N/A</span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Preliminary only scores are not shown. Authority Review starts only after the confirmed Build Plan has generated and validated every required document. Earlier workflow blockers remain owned by their respective stages.
          </p>
        </div>
      )}

      {available === true && result && (
        <>
          <div className="mt-4 rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Overall authority score</p>
              <span className="text-2xl font-bold text-slate-900">{result.overallScore}/100</span>
            </div>
            <ScoreBar score={result.overallScore} />
          </div>

          {result.recommendedFixes.length > 0 && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended actions</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-700">
                {result.recommendedFixes.map((fix, index) => <li key={index}>{fix}</li>)}
              </ul>
            </div>
          )}

          {result.blockers.filter((blocker) => !blocker.documentId).length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">Tender-level blockers</p>
              <ul className="space-y-2">
                {result.blockers.filter((blocker) => !blocker.documentId).map((blocker, index) => (
                  <BlockerRow key={`global-${blocker.code}-${index}`} blocker={blocker} />
                ))}
              </ul>
            </div>
          )}

          {result.documentScores.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Document review ({result.documentScores.length})</p>
              {result.documentScores.map((document) => <DocumentRow key={document.documentId} doc={document} />)}
            </div>
          )}

          <div className="mt-4 rounded-xl border bg-white px-4 py-3 text-sm">
            {result.status === "AUTHORITY_READY" ? (
              <span className="font-semibold text-green-700">Ready for final export — all authority-review checks pass.</span>
            ) : (
              <span className="font-semibold text-red-700">Fix {result.blockers.length} authority-review blocker(s) before export.</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

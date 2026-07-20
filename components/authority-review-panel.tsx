"use client";

import { useCallback, useEffect, useState } from "react";
import { errorCodeLabel } from "@/lib/ui/human-labels";
import { RefreshIcon, WarningIcon, CheckCircleIcon, CrossIcon, ChevronDownIcon } from "./icons";
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
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
        CRITICAL
      </span>
    );
  }
  if (severity === "HIGH") {
    return (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
        HIGH
      </span>
    );
  }
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
      MEDIUM
    </span>
  );
}

function BlockerRow({ blocker }: { blocker: AuthorityBlocker }) {
  return (
    <li className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {severityBadge(blocker.severity)}
        <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs text-slate-700">
          {errorCodeLabel(blocker.code)}
        </span>
        {blocker.documentName && (
          <span className="text-xs text-slate-600">{blocker.documentName}</span>
        )}
        {blocker.sectionName && (
          <span className="text-xs text-slate-600">Section: {blocker.sectionName}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-red-800">{blocker.detail}</p>
      <p className="mt-1 text-xs text-slate-600">
        <span className="font-semibold">Fix: </span>
        {blocker.recoveryAction}
      </p>
    </li>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 85
      ? "bg-green-500"
      : score >= 60
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className={`h-2 rounded-full transition-all ${color}`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

function DocumentRow({ doc }: { doc: DocumentAuthorityScore }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
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
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">
                Blockers ({doc.blockers.length})
              </p>
              <ul className="space-y-2">
                {doc.blockers.map((b, i) => (
                  <BlockerRow key={`${b.code}-${i}`} blocker={b} />
                ))}
              </ul>
            </div>
          )}
          {doc.warnings.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
                Warnings
              </p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800">
                {doc.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/authority-review`, {
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.message ?? body.error ?? "Authority review failed.");
        setResult(null);
      } else {
        setResult(body.authorityReview as AuthorityReviewResult);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => {
    void fetchReview();
  }, [fetchReview]);

  const isReady = result?.status === "AUTHORITY_READY";
  // Precondition check: if there are no generated documents or no confirmed
  // build plan, authority review is in precondition-blocked mode — it should
  // not present final authority scoring as the main state.
  const hasGeneratedDocs = (result?.documentScores ?? []).some((d) => d.blockers.length > 0 || d.warnings.length > 0 || d.score > 0);
  const preconditionBlocked = !loading && !error && !hasGeneratedDocs && result && result.status !== "AUTHORITY_READY";
  const borderClass = isReady
    ? "border-green-200 bg-green-50"
    : preconditionBlocked
      ? "border-slate-200 bg-slate-50"
      : result?.status === "NEEDS_REVIEW"
        ? "border-amber-200 bg-amber-50"
        : "border-red-200 bg-red-50";

  return (
    <section id="authority-review" className={`mb-4 rounded-2xl border p-5 shadow-sm ${result ? borderClass : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Authority Review
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">
            {loading
              ? "Running authority review…"
              : error
                ? "Authority review unavailable"
                : preconditionBlocked
                  ? "Authority review unavailable — prerequisites not met"
                  : result?.status === "AUTHORITY_READY"
                    ? "Document authority review passed"
                    : result?.status === "NEEDS_REVIEW"
                      ? "Issues require review before export"
                      : "Authority review blocked — fix issues before export"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {preconditionBlocked
              ? "Final authority review is unavailable until required documents are generated and validated. Complete earlier workflow stages first."
              : "Scans all generated documents for AI traces, placeholders, internal notes, envelope mismatches, and manifest inconsistencies."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {result && statusBadge(result.status)}
          <button
            type="button"
            onClick={() => void fetchReview()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            title="Refresh the authority review"
          >
            <RefreshIcon /> {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Overall score — labeled as preliminary when preconditions not met */}
          <div className="mt-4 rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">
                Overall authority score
                {preconditionBlocked && (
                  <span className="ml-2 text-xs font-normal text-amber-800">Preliminary only — final authority review unavailable until required documents are generated and validated.</span>
                )}
              </p>
              <span className="text-2xl font-bold text-slate-900">{result.overallScore}/100</span>
            </div>
            <ScoreBar score={result.overallScore} />
          </div>

          {/* Recommended fixes */}
          {result.recommendedFixes.length > 0 && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Recommended actions
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-700">
                {result.recommendedFixes.map((fix, i) => (
                  <li key={i}>{fix}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Global blockers (e.g. missing required sections) */}
          {result.blockers.filter((b) => !b.documentId).length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">
                Tender-level blockers
              </p>
              <ul className="space-y-2">
                {result.blockers
                  .filter((b) => !b.documentId)
                  .map((b, i) => (
                    <BlockerRow key={`global-${b.code}-${i}`} blocker={b} />
                  ))}
              </ul>
            </div>
          )}

          {/* Per-document rows */}
          {result.documentScores.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Document review ({result.documentScores.length})
              </p>
              {result.documentScores.map((doc) => (
                <DocumentRow key={doc.documentId} doc={doc} />
              ))}
            </div>
          )}

          {result.documentScores.length === 0 && result.blockers.length === 0 && (
            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              No generated documents to review.
            </div>
          )}

          {/* CTA */}
          <div className="mt-4 rounded-xl border bg-white px-4 py-3 text-sm">
            {result.status === "AUTHORITY_READY" ? (
              <span className="font-semibold text-green-700">
                Ready for final export — all authority review checks pass.
              </span>
            ) : (
              <span className="font-semibold text-red-700">
                Fix {result.blockers.length} blocker(s) before export.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, CrossIcon, DownloadIcon } from "../../../components/icons";

type CheckItem = { label: string; done: boolean; blocking?: boolean; warn?: boolean };
type CriticalGap = { id: string; title: string };
type HighGap = { id: string; title: string };
type DocItem = { id: string; name: string; exactFileName: string | null; exactOrder: number | null; generationStatus: string };

type Props = {
  tenderId: string;
  tenderTitle: string;
  isReady: boolean;
  isExported: boolean;
  generatedCount: number;
  totalDocs: number;
  blockingGaps: number;
  warningGaps: number;
  checks: CheckItem[];
  criticalGaps: CriticalGap[];
  highGaps: HighGap[];
  documents: DocItem[];
  // Canonical server-authority blocker codes (from getFinalSubmissionReadiness).
  // The UI mirrors these so the disabled state and the server denial use the
  // same blocker model. When canonicalBlockerCodes is non-empty, the ZIP /
  // download links are hidden (server will deny anyway — this is defense in
  // depth, not the sole gate).
  canonicalBlockerCodes?: string[];
  canonicalNextAction?: string;
};

export function ExportTenderCard({
  tenderId, tenderTitle, isReady, isExported,
  generatedCount, totalDocs, blockingGaps, warningGaps,
  checks, criticalGaps, highGaps, documents,
  canonicalBlockerCodes = [], canonicalNextAction,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 p-6">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h2 className="min-w-0 break-words text-lg font-semibold text-slate-900">{tenderTitle}</h2>
            {isExported && <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs text-green-700">Exported</span>}
            {isReady && !isExported && <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs text-emerald-700">Ready</span>}
            {!isReady && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs text-amber-700">Not ready</span>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {generatedCount} / {totalDocs} docs generated
            {blockingGaps > 0 && <span className="ml-2 text-red-600">{blockingGaps} critical gap{blockingGaps !== 1 ? "s" : ""}</span>}
            {warningGaps > 0 && <span className="ml-2 text-amber-600">{warningGaps} warning{warningGaps !== 1 ? "s" : ""}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {isReady && canonicalBlockerCodes.length === 0 && (
            <a
              href={`/api/tenders/${tenderId}/download?type=zip`}
              target="_blank"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
            >
              <DownloadIcon /> Download ZIP
            </a>
          )}
          {!isReady && canonicalBlockerCodes.length > 0 && (
            <span
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-500 cursor-not-allowed"
              title={canonicalNextAction ?? "Resolve all critical gaps to unlock the ZIP download."}
            >
              ZIP locked
            </span>
          )}
          {!isReady && canonicalBlockerCodes.length > 0 && (
            <span className="text-xs text-slate-500">
              {canonicalBlockerCodes.length} blocker{canonicalBlockerCodes.length !== 1 ? "s" : ""} —{" "}
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="font-medium text-slate-700 underline hover:text-slate-900"
              >
                view checklist to resolve
              </button>
            </span>
          )}
          <Link href={`/dashboard/tenders/${tenderId}`}
            className="rounded border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Open workspace
          </Link>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 rounded border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            aria-label={expanded ? "Collapse checklist" : "Expand checklist"}
          >
            <span>{expanded ? "Hide" : "Checklist"}</span>
            <svg
              className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-6 pb-6 pt-4">
          {/* One canonical blocker model + one next action */}
          {!isReady && canonicalBlockerCodes.length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800">Canonical export blockers</p>
              <p className="mt-1 text-xs text-amber-700">
                Next action: {canonicalNextAction ?? "Resolve the blockers below."}
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {canonicalBlockerCodes.map((code) => (
                  <li key={code} className="rounded bg-amber-100 px-2 py-0.5 text-xs font-mono font-semibold text-amber-700">
                    {code}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mb-3 text-sm font-medium text-slate-700">Submission checklist</p>
          <ul className="space-y-2">
            {checks.map((check, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  check.blocking ? "bg-red-500 text-white" :
                  check.done ? "bg-green-500 text-white" :
                  check.warn ? "bg-amber-400 text-white" :
                  "border-2 border-slate-200 text-slate-300"
                }`}>
                  {check.blocking ? <CrossIcon /> : check.done ? <CheckIcon /> : check.warn ? "!" : ""}
                </span>
                <span className={check.blocking ? "text-red-600 font-medium" : check.done ? "text-slate-700" : "text-slate-400"}>
                  {check.label}
                </span>
              </li>
            ))}
          </ul>

          {criticalGaps.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-800 mb-2">Critical compliance gaps (must resolve to export)</p>
              <ul className="space-y-1">
                {criticalGaps.map((gap) => (
                  <li key={gap.id} className="flex items-center gap-2 text-sm text-red-700">
                    <span className="text-xs font-bold">[CRITICAL]</span>
                    {gap.title}
                  </li>
                ))}
              </ul>
              <Link href="/dashboard/compliance" className="mt-2 inline-block text-xs text-red-600 underline hover:no-underline">
                Resolve in Compliance Dashboard <ArrowRightIcon />
              </Link>
            </div>
          )}

          {highGaps.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-medium text-amber-800 mb-2">High-priority warnings (non-blocking)</p>
              <ul className="space-y-1">
                {highGaps.map((gap) => (
                  <li key={gap.id} className="text-sm text-amber-700">{gap.title}</li>
                ))}
              </ul>
            </div>
          )}

          {documents.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-slate-600">Document checklist ({generatedCount} generated — planned/pending excluded)</p>
              <div className="space-y-1">
                {documents.map((doc) => {
                  const isGen = doc.generationStatus === "GENERATED";
                  const isPending = doc.generationStatus === "PLANNED" || doc.generationStatus === "GENERATING" || doc.generationStatus === "QUEUED";
                  const isFailed = doc.generationStatus === "FAILED";
                  // Only GENERATED rows may show a download link. Planned /
                  // pending / failed rows are never downloadable.
                  const canDownload = isGen && isReady && canonicalBlockerCodes.length === 0;
                  return (
                    <div key={doc.id} className="flex items-center gap-3 text-sm">
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] ${
                        isGen ? "bg-green-500 text-white" :
                        isFailed ? "bg-red-400 text-white" :
                        isPending ? "bg-slate-200 text-slate-400" :
                        "border border-slate-200 text-slate-300"
                      }`}>
                        {isGen ? <CheckIcon /> : isFailed ? <CrossIcon /> : isPending ? "..." : ""}
                      </span>
                      <span className={isGen ? "text-slate-700" : "text-slate-400"}>
                        {doc.exactOrder ? `${doc.exactOrder}. ` : ""}{doc.exactFileName || doc.name}
                        {!isGen && (
                          <span className="ml-2 text-xs text-slate-400">({doc.generationStatus})</span>
                        )}
                      </span>
                      {canDownload && (
                        <a
                          href={`/api/tenders/${tenderId}/download?docId=${doc.id}`}
                          target="_blank"
                          className="ml-auto text-xs text-blue-500 hover:underline"
                        >
                          <DownloadIcon />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

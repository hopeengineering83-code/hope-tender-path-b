"use client";

import React, { useEffect, useState } from "react";
import { clientLogger } from "@/lib/ui/client-logger";

type PageLedger = {
  totalPages?: number | null;
  processedPages?: number | null;
  missingPages?: number[];
  coveragePercent?: number | null;
  hasFailedPages?: boolean;
  isSafeForAnalysis?: boolean;
  summary?: string;
};

type FileRow = {
  id: string;
  fileName: string;
  totalPages: number | null;
  extractedPages: number | null;
  ocrPages: number | null;
  failedPages: number | null;
  extractionScore: number | null;
  extractionMethod: string | null;
  pageLedger?: PageLedger | null;
};

type Snapshot = {
  fileId: string;
  fileName: string;
  sourcePageCount: number;
  processedPageCount: number;
  consistencyStatus: "CONSISTENT" | "PAGE_STATUS_INCOMPLETE" | "PAGE_COUNT_MISMATCH" | "EXTRACTION_STALE";
  basis: "PAGE_LEDGER" | "AGGREGATE_EXTRACTION" | "UNAVAILABLE";
};

function deriveSnapshot(file: FileRow): Snapshot {
  const sourcePageCount = file.pageLedger?.totalPages ?? file.totalPages ?? 0;
  const ledgerProcessed = Math.max(0, file.pageLedger?.processedPages ?? 0);
  const aggregateProcessed = Math.max(0, file.extractedPages ?? 0);

  // Older DOCX/XLSX extractions may have durable aggregate page counts but no
  // pageStatusJson rows. The extraction-quality API already exposes the shared
  // page ledger; when it has no granular rows, use the persisted aggregate
  // extracted-page count instead of falsely reporting "0 stored rows".
  const processedPageCount = ledgerProcessed > 0 ? ledgerProcessed : aggregateProcessed;
  const basis: Snapshot["basis"] = ledgerProcessed > 0
    ? "PAGE_LEDGER"
    : aggregateProcessed > 0
      ? "AGGREGATE_EXTRACTION"
      : "UNAVAILABLE";

  const failed = (file.failedPages ?? 0) > 0 || file.pageLedger?.hasFailedPages === true;
  let consistencyStatus: Snapshot["consistencyStatus"];

  if (failed) {
    consistencyStatus = "EXTRACTION_STALE";
  } else if (sourcePageCount <= 0) {
    // Document-level formats can legitimately have no reliable source-page
    // denominator. The canonical quality panel owns that verdict; this
    // diagnostic must not manufacture a mismatch.
    consistencyStatus = "CONSISTENT";
  } else if (processedPageCount <= 0) {
    consistencyStatus = "PAGE_STATUS_INCOMPLETE";
  } else if (processedPageCount !== sourcePageCount) {
    consistencyStatus = "PAGE_COUNT_MISMATCH";
  } else {
    consistencyStatus = "CONSISTENT";
  }

  return {
    fileId: file.id,
    fileName: file.fileName,
    sourcePageCount,
    processedPageCount,
    consistencyStatus,
    basis,
  };
}

export function ExtractionSnapshotPanel({ tenderId }: { tenderId: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/extraction-quality`)
      .then((res) => res.json())
      .then((json) => {
        const fileList: FileRow[] = Array.isArray(json?.files)
          ? json.files
          : Array.isArray(json?.reports)
            ? json.reports
            : [];
        setSnapshots(fileList.map(deriveSnapshot));
      })
      .catch((error: unknown) =>
        clientLogger.error("fetch failed", error instanceof Error ? { message: error.message } : { error: String(error) }),
      );
  }, [tenderId]);

  if (!snapshots) return null;

  // The canonical Extraction Quality dashboard already shows successful files.
  // This diagnostic renders only genuine inconsistencies, preventing a second
  // competing green verdict and avoiding the old false red mismatch banner.
  const issues = snapshots.filter((snapshot) => snapshot.consistencyStatus !== "CONSISTENT");
  if (issues.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      {issues.map((snapshot) => (
        <div key={snapshot.fileId} className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-red-900">
                {snapshot.fileName}: {snapshot.consistencyStatus.replace(/_/g, " ")}
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Source pages: {snapshot.sourcePageCount || "unknown"} | Processed pages: {snapshot.processedPageCount}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Coverage source: {snapshot.basis === "PAGE_LEDGER" ? "page ledger" : snapshot.basis === "AGGREGATE_EXTRACTION" ? "persisted extraction totals" : "unavailable"}
              </p>
            </div>
            <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              Mismatch
            </span>
          </div>
          <p className="mt-3 text-xs font-medium text-red-700">
            Extraction coverage is incomplete or inconsistent. Re-extract the file before relying on AI analysis.
          </p>
        </div>
      ))}
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";
import { clientLogger } from "@/lib/ui/client-logger";

// Adaptive type — the API at /api/tenders/[id]/extraction-quality returns
// `{ files: Array<...> }` (not `reports`). Each file row carries totalPages,
// pageStatusJson (stringified array), extractedPages, ocrPages, failedPages,
// extractionScore, extractionMethod. We derive the snapshot client-side so
// the panel renders consistently regardless of which fields the API chooses
// to return.
type FileRow = {
  id: string;
  fileName: string;
  totalPages: number | null;
  extractedPages: number | null;
  ocrPages: number | null;
  failedPages: number | null;
  extractionScore: number | null;
  extractionMethod: string | null;
  pageStatusJson?: string | null;
};

type Snapshot = {
  fileId: string;
  fileName: string;
  sourcePageCount: number;
  storedPageStatusCount: number;
  consistencyStatus: "CONSISTENT" | "PAGE_STATUS_INCOMPLETE" | "PAGE_COUNT_MISMATCH" | "EXTRACTION_STALE";
};

function deriveSnapshot(file: FileRow): Snapshot {
  let storedPageStatusCount = 0;
  try {
    if (file.pageStatusJson) {
      const parsed = JSON.parse(file.pageStatusJson);
      storedPageStatusCount = Array.isArray(parsed) ? parsed.length : 0;
    }
  } catch {
    storedPageStatusCount = 0;
  }
  const sourcePageCount = file.totalPages ?? 0;

  let consistencyStatus: Snapshot["consistencyStatus"];
  if (sourcePageCount === 0) {
    // No pages detected — usually means extraction hasn't run or produced
    // no [Page N] markers (e.g., DOCX/XLSX in DOCUMENT_LEVEL mode). Show as
    // CONSISTENT so the panel doesn't false-alarm on every non-PDF tender.
    consistencyStatus = "CONSISTENT";
  } else if (storedPageStatusCount === 0) {
    consistencyStatus = "PAGE_STATUS_INCOMPLETE";
  } else if (storedPageStatusCount !== sourcePageCount) {
    consistencyStatus = "PAGE_COUNT_MISMATCH";
  } else {
    consistencyStatus = "CONSISTENT";
  }

  return {
    fileId: file.id,
    fileName: file.fileName,
    sourcePageCount,
    storedPageStatusCount,
    consistencyStatus,
  };
}

export function ExtractionSnapshotPanel({ tenderId }: { tenderId: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/extraction-quality`)
      .then((res) => res.json())
      .then((json) => {
        // The API returns `{ files: [...] }`. Earlier code read `json.reports`
        // which never existed — the panel silently rendered nothing. Accept
        // both shapes for backward compatibility with any cached response.
        const fileList: FileRow[] = Array.isArray(json?.files)
          ? json.files
          : Array.isArray(json?.reports)
            ? json.reports
            : [];
        setSnapshots(fileList.map(deriveSnapshot));
      })
      .catch((e: unknown) =>
        clientLogger.error("fetch failed", e instanceof Error ? { message: e.message } : { error: String(e) }),
      );
  }, [tenderId]);

  if (!snapshots || snapshots.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      {snapshots.map((s) => (
        <div
          key={s.fileId}
          className={`p-4 rounded-xl border ${
            s.consistencyStatus === "CONSISTENT" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
          }`}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3
                className={`text-sm font-bold ${
                  s.consistencyStatus === "CONSISTENT" ? "text-emerald-900" : "text-red-900"
                }`}
              >
                {s.fileName}: {s.consistencyStatus.replace(/_/g, " ")}
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                Source pages: {s.sourcePageCount} | Stored status rows: {s.storedPageStatusCount}
              </p>
            </div>
            {s.consistencyStatus !== "CONSISTENT" && (
              <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
                Mismatch
              </span>
            )}
          </div>
          {s.consistencyStatus !== "CONSISTENT" && (
            <p className="mt-3 text-xs font-medium text-red-700">
              Extraction details are incomplete or inconsistent. Re-extract/rebuild page status before relying on AI analysis.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

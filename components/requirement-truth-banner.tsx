"use client";

import React, { useEffect, useState } from "react";
import { clientLogger } from "@/lib/ui/client-logger";

export function RequirementTruthBanner({ tenderId }: { tenderId: string }) {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    // The canonical analysis state lives at snapshot.analysis.state in the
    // workflow-center response — there is no top-level `analysis` key.
    // Reading `json.analysis.state` threw on every load (undefined.state),
    // which the catch swallowed as a phantom "fetch failed" log, and the
    // banner could never fire even when sections were detected without
    // structured requirements.
    fetch(`/api/tenders/${tenderId}/workflow-center`)
      .then(res => res.json())
      .then((json: { snapshot?: { analysis?: { state?: string } } }) => setStatus(json.snapshot?.analysis?.state ?? null))
      .catch((e: unknown) => clientLogger.error("fetch failed", e instanceof Error ? { message: e.message } : { error: String(e) }));
  }, [tenderId]);

  if (status !== "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED") return null;

  return (
    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white font-bold text-sm">!</span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-red-900">Requirements unknown</h3>
          <p className="text-xs text-red-700 mt-0.5">Relevant tender pages were detected (Evaluation/Submission), but no structured requirements have been saved yet. Downstream generation and export are blocked.</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          Retry AI Extraction
        </button>
      </div>
    </div>
  );
}

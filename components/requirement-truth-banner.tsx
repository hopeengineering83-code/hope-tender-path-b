"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clientLogger } from "@/lib/ui/client-logger";
import {
  canonicalWorkflowFingerprint,
  emitTenderWorkflowSync,
  isUserEditingDocument,
  workflowHasInProgressStage,
} from "@/lib/ui/tender-workflow-sync";

type WorkflowCenterPayload = {
  snapshot?: { analysis?: { state?: string } };
  stages?: Array<{ status?: string }>;
};

/**
 * Requirement warning plus the page-level workflow synchronization sentinel.
 *
 * The workspace reads several bounded endpoints, but they ultimately depend on
 * the workflow-center's canonical snapshot and decision. This component polls
 * that contract and refreshes server-rendered panels when canonical business
 * state changes, so source, analysis, matching, generation, review and package
 * views do not remain on different revisions after an action completes.
 */
export function RequirementTruthBanner({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [refreshAvailable, setRefreshAvailable] = useState(false);
  const baselineFingerprint = useRef<string | null>(null);

  const refreshWorkspace = useCallback(() => {
    if (isUserEditingDocument()) {
      setRefreshAvailable(true);
      return;
    }
    setRefreshAvailable(false);
    router.refresh();
  }, [router]);

  const loadCanonicalWorkflow = useCallback(async () => {
    try {
      const response = await fetch(`/api/tenders/${tenderId}/workflow-center`, {
        cache: "no-store",
        credentials: "include",
      });
      const json = await response.json().catch(() => ({})) as WorkflowCenterPayload & { error?: string };
      if (!response.ok) throw new Error(json.error ?? `workflow-center ${response.status}`);

      setStatus(json.snapshot?.analysis?.state ?? null);
      const nextFingerprint = canonicalWorkflowFingerprint(json);

      if (baselineFingerprint.current === null) {
        baselineFingerprint.current = nextFingerprint;
        return;
      }
      if (baselineFingerprint.current === nextFingerprint) return;

      baselineFingerprint.current = nextFingerprint;
      emitTenderWorkflowSync({
        tenderId,
        source: "canonical-workflow-poll",
        fingerprint: nextFingerprint,
      });

      if (!workflowHasInProgressStage(json)) refreshWorkspace();
    } catch (error) {
      clientLogger.error(
        "workflow truth synchronization failed",
        error instanceof Error ? { message: error.message } : { error: String(error) },
      );
    }
  }, [refreshWorkspace, tenderId]);

  useEffect(() => {
    void loadCanonicalWorkflow();
    const interval = window.setInterval(() => {
      if (!document.hidden) void loadCanonicalWorkflow();
    }, 8_000);
    return () => window.clearInterval(interval);
  }, [loadCanonicalWorkflow]);

  const applyDeferredRefresh = () => {
    setRefreshAvailable(false);
    router.refresh();
  };

  if (refreshAvailable) {
    return (
      <div role="status" className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-blue-900">Workflow state updated</h3>
            <p className="mt-0.5 text-xs text-blue-700">
              A tender action completed. Save any text currently being edited, then refresh the workspace to show one consistent revision.
            </p>
          </div>
          <button
            type="button"
            onClick={applyDeferredRefresh}
            className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
          >
            Refresh workspace
          </button>
        </div>
      </div>
    );
  }

  if (status !== "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED") return null;

  return (
    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">!</span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-red-900">Requirements need structuring</h3>
          <p className="mt-0.5 text-xs text-red-700">Relevant tender pages were detected, but structured requirements have not been saved. Confirm the source-traced requirements before matching, generation, or export.</p>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          Refresh status
        </button>
      </div>
    </div>
  );
}

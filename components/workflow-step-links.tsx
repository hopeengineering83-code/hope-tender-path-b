"use client";

import { useCallback, useEffect, useState } from "react";
import { openParentDetailsAndScroll } from "@/lib/ui/tender-workflow-sync";
import { TENDER_WORKFLOW_STAGES } from "@/lib/tender-workflow-stages";
import { CheckCircleIcon, ArrowRightIcon, ChevronDownIcon } from "./icons";

const STEP_LABELS = TENDER_WORKFLOW_STAGES.map((stage) => stage.label);

// Actions that require MANUAL user clicks. These are NOT automatic.
const MANUAL_ACTIONS = new Set([
  "RUN_AI_ANALYZE",
  "RESUME_AI_ANALYZE",
  "RUN_ENGINE",
]);

// Actions that are automatic AFTER Run Engine succeeds.
const AUTOMATIC_DOWNSTREAM_ACTIONS = new Set([
  "BUILD_SUBMISSION_PLAN",
  "GENERATE_REQUIRED_DOCUMENTS",
]);

// Truthful status messages for each workflow state.
function statusMessage(currentAction: string, complete: boolean): string | null {
  if (complete) return "Workflow complete.";
  if (MANUAL_ACTIONS.has(currentAction)) {
    switch (currentAction) {
      case "RUN_AI_ANALYZE":
        return "Extraction complete. Run AI Analyze to continue.";
      case "RESUME_AI_ANALYZE":
        return "AI Analyze is running.";
      case "RUN_ENGINE":
        return "AI Analyze complete. Run Engine to continue.";
      default:
        return "Manual action required.";
    }
  }
  if (AUTOMATIC_DOWNSTREAM_ACTIONS.has(currentAction)) {
    return "Engine started. Downstream processing continues automatically.";
  }
  // Extraction and other pre-AI-Analyze stages
  if (currentAction === "EXTRACT_TEXT" || currentAction === "WAIT_FOR_SOURCE_EXTRACTION") {
    return "Source extraction is running automatically.";
  }
  if (currentAction === "PROCESSING_STOPPED_REVIEW_REQUIRED") {
    return "Processing stopped because review is required.";
  }
  return null;
}

/**
 * Workflow navigation and status only.
 *
 * AI Analyze and Run Engine are MANUAL user actions. This component must
 * never POST AI Analyze or Engine mutations — those live in the dedicated
 * AIAnalyzePanel and MatchingSelectedEvidencePanel components.
 */
export function WorkflowStepLinks({
  currentIndex,
  currentAction,
}: {
  currentIndex: number;
  currentAction: string;
}) {
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    setInteractive(true);
  }, []);

  const handleClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, selectors: string[]) => {
    event.preventDefault();
    const element = selectors
      .map((selector) => document.querySelector(selector))
      .find((candidate): candidate is Element => candidate !== null);
    if (!element) return;
    openParentDetailsAndScroll(element);
  }, []);

  const complete = currentIndex >= STEP_LABELS.length;
  const safeIndex = complete ? STEP_LABELS.length - 1 : Math.max(0, currentIndex);
  const currentStage = TENDER_WORKFLOW_STAGES[safeIndex];
  const currentLabel = currentStage.label;
  const statusMsg = statusMessage(currentAction, complete);
  const isManualAction = MANUAL_ACTIONS.has(currentAction);

  return (
    <div className="mt-4 space-y-3">
      {complete ? (
        <p className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800">
          <CheckCircleIcon /> Workflow complete
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {statusMsg && (
            <p
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                isManualAction
                  ? "border-purple-200 bg-purple-50 text-purple-800"
                  : "border-blue-200 bg-blue-50 text-blue-800"
              }`}
              role="status"
              aria-live="polite"
            >
              {statusMsg}
            </p>
          )}
          <a
            href={interactive ? currentStage.targets[0] : undefined}
            onClick={interactive ? (event) => handleClick(event, currentStage.targets) : undefined}
            aria-disabled={!interactive}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white ${interactive ? "bg-slate-900 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2" : "cursor-wait bg-slate-500"}`}
            title={interactive ? `Go to ${currentLabel}` : "Preparing workflow navigation"}
          >
            <ArrowRightIcon /> Open {currentLabel} details
          </a>
        </div>
      )}

      <details className="group rounded-lg border border-slate-200 bg-white/70">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700 marker:content-none">
          View full workflow
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            <ChevronDownIcon />
          </span>
        </summary>
        <nav className="flex flex-wrap gap-1.5 border-t border-slate-200 p-3" aria-label="Full tender workflow" aria-busy={!interactive}>
          {TENDER_WORKFLOW_STAGES.map((stage, index) => {
            const done = index < currentIndex;
            const active = index === currentIndex;
            const baseClass = done
              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
              : active
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200";

            return (
              <a
                key={stage.stage}
                href={interactive ? stage.targets[0] : undefined}
                onClick={interactive ? (event) => handleClick(event, stage.targets) : undefined}
                aria-current={active ? "step" : undefined}
                aria-disabled={!interactive}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${interactive ? baseClass : "cursor-wait bg-slate-100 text-slate-400"}`}
                title={interactive ? `Go to ${stage.label}` : "Preparing workflow navigation"}
              >
                <span aria-hidden="true" className="inline-flex items-center">
                  {done ? <CheckCircleIcon className="mr-0.5" /> : active ? <ArrowRightIcon className="mr-0.5" /> : null}
                </span>
                {stage.label}
              </a>
            );
          })}
        </nav>
      </details>
    </div>
  );
}

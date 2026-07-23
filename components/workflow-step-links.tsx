"use client";

// Client component for the tender workflow shortcuts.
//
// The current step is the one visible primary action. The complete ten-step
// workflow remains available inside a closed disclosure so it does not compete
// with the canonical Next Required Action or make the tender page unnecessarily
// long. Every link opens closed workflow disclosures before scrolling.

import { useCallback } from "react";
import { openParentDetailsAndScroll } from "@/lib/ui/tender-workflow-sync";
import { TENDER_WORKFLOW_STAGES } from "@/lib/tender-workflow-stages";
import { CheckCircleIcon, ArrowRightIcon, ChevronDownIcon } from "./icons";

const STEP_LABELS = TENDER_WORKFLOW_STAGES.map((stage) => stage.label);

export function WorkflowStepLinks({ currentIndex }: { currentIndex: number }) {
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

  return (
    <div className="mt-4 space-y-3">
      {complete ? (
        <p className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800">
          <CheckCircleIcon /> Workflow complete
        </p>
      ) : (
        <a
          href={currentStage.targets[0]}
          onClick={(event) => handleClick(event, currentStage.targets)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          title={`Go to ${currentStage.label}`}
        >
          <ArrowRightIcon /> Open {currentStage.label}
        </a>
      )}

      <details className="group rounded-lg border border-slate-200 bg-white/70">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700 marker:content-none">
          View full workflow
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            <ChevronDownIcon />
          </span>
        </summary>
        <nav className="flex flex-wrap gap-1.5 border-t border-slate-200 p-3" aria-label="Full tender workflow">
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
                href={stage.targets[0]}
                onClick={(event) => handleClick(event, stage.targets)}
                aria-current={active ? "step" : undefined}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${baseClass}`}
                title={`Go to ${stage.label}`}
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

"use client";

// Client component for the tender workflow shortcuts.
//
// The current step is the one visible primary action. The complete ten-step
// workflow remains available inside a closed disclosure so it does not compete
// with the canonical Next Required Action or make the tender page unnecessarily
// long. Every link opens closed workflow disclosures before scrolling.

import { useCallback, useEffect, useState } from "react";
import { openParentDetailsAndScroll } from "@/lib/ui/tender-workflow-sync";
import { TENDER_WORKFLOW_STAGES } from "@/lib/tender-workflow-stages";
import { CheckCircleIcon, ArrowRightIcon, ChevronDownIcon } from "./icons";

const STEP_LABELS = TENDER_WORKFLOW_STAGES.map((stage) => stage.label);

export function WorkflowStepLinks({ currentIndex }: { currentIndex: number }) {
  // A server-rendered href can be activated before React hydrates this client
  // component. Native hash navigation cannot open closed <details> ancestors,
  // leaving the destination attached but hidden. Keep anchors non-interactive
  // until hydration guarantees that the canonical open-and-scroll handler owns
  // every click.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);

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

  return (
    <div className="mt-4 space-y-3">
      {complete ? (
        <p className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800">
          <CheckCircleIcon /> Workflow complete
        </p>
      ) : (
        <a
          href={interactive ? currentStage.targets[0] : undefined}
          onClick={interactive ? (event) => handleClick(event, currentStage.targets) : undefined}
          aria-disabled={!interactive}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white ${interactive ? "bg-slate-900 hover:bg-slate-800" : "cursor-wait bg-slate-500"}`}
          title={interactive ? `Go to ${currentLabel}` : "Preparing workflow navigation"}
        >
          <ArrowRightIcon /> Open {currentLabel}
        </a>
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

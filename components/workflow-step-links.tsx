"use client";

// Client component for the workflow step shortcut links.
//
// Labels and targets are imported from the single canonical registry in
// lib/tender-workflow-stages.ts — no duplicated arrays. The parent
// NextActionPanel (server component) also imports from the same registry.

import { useCallback } from "react";
import { openParentDetailsAndScroll } from "@/lib/ui/tender-workflow-sync";
import {
  TENDER_WORKFLOW_STAGE_LABEL_LIST as STEP_LABELS,
  TENDER_WORKFLOW_STAGE_PRIMARY_TARGETS as STEP_TARGETS,
} from "@/lib/tender-workflow-stages";
import { CheckCircleIcon, ArrowRightIcon } from "./icons";

export function WorkflowStepLinks({ currentIndex }: { currentIndex: number }) {
  const handleClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, selector: string) => {
    // Prevent the browser's default anchor jump — it cannot open closed
    // <details> wrappers and would scroll to the wrong position (or nowhere).
    event.preventDefault();
    const element = document.querySelector(selector);
    if (!element) return;
    openParentDetailsAndScroll(element);
  }, []);

  return (
    <nav className="mt-4 flex flex-wrap gap-1.5" aria-label="Tender workflow shortcuts">
      {STEP_LABELS.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const baseClass = done ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" :
          active ? "bg-slate-900 text-white hover:bg-slate-800" :
          "bg-slate-100 text-slate-500 hover:bg-slate-200";
        return (
          <a
            key={s}
            href={STEP_TARGETS[i]}
            onClick={(e) => handleClick(e, STEP_TARGETS[i])}
            aria-current={active ? "step" : undefined}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${baseClass}`}
            title={`Go to ${s}`}
          >
            <span aria-hidden="true" className="inline-flex items-center">{done ? <CheckCircleIcon className="mr-0.5" /> : active ? <ArrowRightIcon className="mr-0.5" /> : null}</span>{s}
          </a>
        );
      })}
    </nav>
  );
}

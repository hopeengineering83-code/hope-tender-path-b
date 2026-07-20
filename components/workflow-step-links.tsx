"use client";

// Client component for the workflow step shortcut links.
//
// The parent NextActionPanel is a server component (it reads the canonical
// workflow decision from the DB). The step links need a client onClick handler
// to open parent <details>/<WorkflowStage>/<Disclosure> wrappers before
// scrolling — without this, clicking a step link to a panel hidden inside a
// closed disclosure silently fails (the anchor exists in the DOM but is not
// displayed, so the browser cannot scroll to it).
//
// This was the root cause of the "icons act independently" interlinking bug:
// every step link and workflow shortcut button tried to navigate to panels
// that were invisible inside closed disclosures.

import { useCallback } from "react";
import { openParentDetailsAndScroll } from "@/lib/ui/tender-workflow-sync";
import { CheckCircleIcon, ArrowRightIcon } from "./icons";

const STEP_LABELS = [
  "Upload Tender",
  "Fix Extraction",
  "Run AI Analyze",
  "Confirm Requirements",
  "Build Plan",
  "Match Evidence",
  "Generate Docs",
  "Validate & Approve Docs",
  "Review Manifest",
  "Export ZIP",
] as const;

const STEP_TARGETS = [
  "#tender-files",
  "#tender-files",
  "#ai-analyze-section",
  "#requirement-coverage",
  "#submission-plan",
  "#requirement-coverage",
  "#generated-documents",
  "#generated-documents",
  "#final-package-manifest",
  "#export-readiness",
] as const;

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

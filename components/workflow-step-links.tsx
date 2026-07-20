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
//
// STAGE ALIGNMENT: The labels and targets below MUST match the server-side
// stage definitions in app/api/tenders/[id]/workflow-center/route.ts (stages
// 1-10). Both components navigate to the same 10 stages — if their labels or
// targets disagree, the user sees inconsistent navigation. The
// TenderWorkflowActionCenter uses a primary+fallback target list per stage;
// here we use only the primary target (the first one) for the step link.

import { useCallback } from "react";
import { openParentDetailsAndScroll } from "@/lib/ui/tender-workflow-sync";
import { CheckCircleIcon, ArrowRightIcon } from "./icons";

const STEP_LABELS = [
  "Source Files",           // Stage 1
  "Extraction Quality",     // Stage 2
  "AI Analyze",             // Stage 3
  "Confirm Requirements",   // Stage 4
  "Tender Details",         // Stage 5
  "Build Plan",             // Stage 6
  "Match Evidence",         // Stage 7
  "Generate Documents",     // Stage 8
  "Validate & Approve",     // Stage 9
  "Export ZIP",             // Stage 10
] as const;

// Primary targets — match the first entry in each stage's targets array in
// TenderWorkflowActionCenter.handleAction(). If the primary target is absent
// from the page, the user can still use the Workflow Control Center's stage
// buttons which have fallback targets.
const STEP_TARGETS = [
  "#tender-files",            // Stage 1 → Source Files
  "#extraction-quality",      // Stage 2 → Extraction Quality
  "#ai-analyze-section",      // Stage 3 → AI Analyze
  "#requirement-coverage",    // Stage 4 → Confirm Requirements
  "#tender-edit-form",        // Stage 5 → Tender Details
  "#submission-plan",         // Stage 6 → Build Plan
  "#match-evidence",          // Stage 7 → Match Evidence
  "#generated-documents",     // Stage 8 → Generate Documents
  "#authority-review",        // Stage 9 → Validate & Approve
  "#export-readiness",        // Stage 10 → Export ZIP
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

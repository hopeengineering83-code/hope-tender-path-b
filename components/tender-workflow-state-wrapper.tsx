"use client";

import { type ReactNode } from "react";
import { WorkflowStateProvider } from "../lib/ui/tender-workflow-sync";

// Client wrapper that wraps all tender-detail panels in the shared
// WorkflowStateProvider. This ensures every panel that calls
// useWorkflowState() gets the same canonical readiness data.
export function TenderWorkflowStateWrapper({ tenderId, children }: { tenderId: string; children: ReactNode }) {
  return (
    <WorkflowStateProvider tenderId={tenderId}>
      {children}
    </WorkflowStateProvider>
  );
}

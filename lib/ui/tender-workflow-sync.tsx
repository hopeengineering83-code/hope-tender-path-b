// Shared workflow state synchronization for all tender-detail panels.
//
// PROBLEM: Each panel (Workflow Control Center, Recovery Command Center,
// Canonical Readiness, Tender Health Score, Bid Control Verdict, Final
// Submission Control Center, Evidence/Matching, Generation/Review, Final
// Package) independently fetches its own readiness data from different
// API endpoints. This causes contradictions: one panel says "Ready" while
// another says "Blocked" for the same tender.
//
// SOLUTION: This module provides a shared React context + hook that
// fetches the canonical readiness state ONCE and distributes it to all
// panels. Panels consume the shared state instead of fetching independently.
//
// The canonical source is /api/tenders/[id]/export-readiness which calls
// getFinalSubmissionReadiness — the same server-side authority used by
// the download route, generation gate, and ZIP assembly.

"use client";

import { useEffect, useState, useCallback, createContext, useContext, type ReactNode } from "react";

export type SharedWorkflowState = {
  ok: boolean;
  blockers: Array<{ code: string; message: string; severity: string; nextAction?: string | null }>;
  warnings: Array<{ code: string; message: string; severity: string }>;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => void;
};

const defaultState: SharedWorkflowState = {
  ok: false,
  blockers: [],
  warnings: [],
  loading: true,
  error: null,
  lastUpdated: null,
  refresh: () => {},
};

const WorkflowStateContext = createContext<SharedWorkflowState>(defaultState);

export function WorkflowStateProvider({ tenderId, children }: { tenderId: string; children: ReactNode }) {
  const [state, setState] = useState<Omit<SharedWorkflowState, "refresh">>(defaultState);

  const fetchState = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`/api/tenders/${tenderId}/export-readiness`, { method: "GET" });
      if (!res.ok) {
        setState((prev) => ({ ...prev, loading: false, error: `HTTP ${res.status}` }));
        return;
      }
      const body = await res.json();
      const blockers = Array.isArray(body?.blockers)
        ? body.blockers.map((b: any) => ({
            code: b.code ?? "UNKNOWN",
            message: b.message ?? "",
            severity: b.severity ?? "HIGH",
            nextAction: b.nextAction ?? null,
          }))
        : [];
      const warnings = Array.isArray(body?.warnings)
        ? body.warnings.map((w: any) => ({
            code: w.code ?? "UNKNOWN",
            message: w.message ?? "",
            severity: w.severity ?? "MEDIUM",
          }))
        : [];
      setState({
        ok: body?.ok === true && blockers.length === 0,
        blockers,
        warnings,
        loading: false,
        error: null,
        lastUpdated: Date.now(),
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch workflow state",
      }));
    }
  }, [tenderId]);

  useEffect(() => {
    void fetchState();
    const interval = setInterval(fetchState, 15_000); // refresh every 15s
    return () => clearInterval(interval);
  }, [fetchState]);

  return (
    <WorkflowStateContext.Provider value={{ ...state, refresh: fetchState }}>
      {children}
    </WorkflowStateContext.Provider>
  );
}

export function useWorkflowState(): SharedWorkflowState {
  return useContext(WorkflowStateContext);
}

// Helper: get the primary blocker code (for display in headers/summaries)
export function getPrimaryBlockerCode(state: SharedWorkflowState): string | null {
  if (state.blockers.length === 0) return null;
  return state.blockers[0].code;
}

// Helper: get the primary next action (for display in action centers)
export function getPrimaryNextAction(state: SharedWorkflowState): string | null {
  if (state.blockers.length === 0) return null;
  return state.blockers[0].nextAction ?? null;
}

// Helper: check if a specific blocker code is present
export function hasBlocker(state: SharedWorkflowState, code: string): boolean {
  return state.blockers.some((b) => b.code === code);
}

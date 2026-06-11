// Canonical 8-state module readiness resolver.
//
// Maps the output of computeTenderReadinessState() to a per-module
// CanonicalModuleStatus so every panel reads from a single source of truth
// instead of using local threshold/color logic that can contradict each other.
//
// The 8 states and their strict meanings:
//   READY          — all upstream gates pass; safe to rely on this output
//   WARNING        — non-blocking issue; user should review but can continue
//   BLOCKED        — must fix before proceeding to downstream steps
//   STALE          — result exists but was generated from an older state hash
//   PARTIAL        — useful progress, not final/safe for export
//   NOT_RUN        — required process has not run yet
//   RUNNING        — process is actively running (caller must set externally)
//   NOT_APPLICABLE — explicitly marked N/A by user or tender rule

import type { TenderReadinessState } from "../tender-readiness-state";

export type CanonicalModuleStatus =
  | "READY"
  | "WARNING"
  | "BLOCKED"
  | "STALE"
  | "PARTIAL"
  | "NOT_RUN"
  | "RUNNING"
  | "NOT_APPLICABLE";

export type CanonicalModuleStates = {
  extraction: CanonicalModuleStatus;
  analysis: CanonicalModuleStatus;
  metadata: CanonicalModuleStatus;
  requirements: CanonicalModuleStatus;
  submissionPlan: CanonicalModuleStatus;
  compliance: CanonicalModuleStatus;
  documents: CanonicalModuleStatus;
  export: CanonicalModuleStatus;
};

export type CanonicalStatusConfig = {
  label: string;
  icon: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
};

export const CANONICAL_STATUS_CONFIG: Record<CanonicalModuleStatus, CanonicalStatusConfig> = {
  READY: { label: "Ready", icon: "✓", textClass: "text-emerald-700", bgClass: "bg-emerald-50", borderClass: "border-emerald-200" },
  WARNING: { label: "Warning", icon: "⚠", textClass: "text-amber-700", bgClass: "bg-amber-50", borderClass: "border-amber-200" },
  BLOCKED: { label: "Blocked", icon: "✗", textClass: "text-red-700", bgClass: "bg-red-50", borderClass: "border-red-200" },
  STALE: { label: "Stale", icon: "↻", textClass: "text-purple-700", bgClass: "bg-purple-50", borderClass: "border-purple-200" },
  PARTIAL: { label: "Partial", icon: "◑", textClass: "text-blue-700", bgClass: "bg-blue-50", borderClass: "border-blue-200" },
  NOT_RUN: { label: "Not run", icon: "○", textClass: "text-slate-500", bgClass: "bg-slate-50", borderClass: "border-slate-200" },
  RUNNING: { label: "Running", icon: "↻", textClass: "text-blue-700", bgClass: "bg-blue-50", borderClass: "border-blue-200" },
  NOT_APPLICABLE: { label: "N/A", icon: "—", textClass: "text-slate-400", bgClass: "bg-slate-50", borderClass: "border-slate-100" },
};

export type ComputeCanonicalStatesInput = TenderReadinessState & {
  hasAnalysis: boolean;
  hasRequirements: boolean;
  hasDocuments: boolean;
  analysisIsApprovedFallback?: boolean;
};

export function computeCanonicalModuleStates(input: ComputeCanonicalStatesInput): CanonicalModuleStates {
  // ── Extraction ─────────────────────────────────────────────────────────────
  const extraction: CanonicalModuleStatus = input.extractionTrusted ? "READY" : "BLOCKED";

  // ── Analysis ───────────────────────────────────────────────────────────────
  let analysis: CanonicalModuleStatus;
  if (!input.extractionTrusted) {
    analysis = "BLOCKED";
  } else if (!input.hasAnalysis) {
    analysis = "NOT_RUN";
  } else if (input.analysisIsApprovedFallback) {
    analysis = "WARNING";
  } else if (!input.analysisTrusted) {
    analysis = "BLOCKED";
  } else {
    analysis = "READY";
  }

  // ── Metadata ───────────────────────────────────────────────────────────────
  const metadata: CanonicalModuleStatus = input.metadataTrusted ? "READY" : "BLOCKED";

  // ── Requirements ───────────────────────────────────────────────────────────
  let requirements: CanonicalModuleStatus;
  if (!input.hasAnalysis || !input.hasRequirements) {
    requirements = "NOT_RUN";
  } else if (!input.analysisTrusted) {
    // requirements may exist but are derived from untrusted analysis
    requirements = "BLOCKED";
  } else if (!input.requirementsTrusted) {
    requirements = "PARTIAL";
  } else {
    requirements = "READY";
  }

  // ── Submission Plan ────────────────────────────────────────────────────────
  const submissionPlan: CanonicalModuleStatus = input.submissionPlanBuilt ? "READY" : "NOT_RUN";

  // ── Compliance ─────────────────────────────────────────────────────────────
  let compliance: CanonicalModuleStatus;
  if (!input.requirementsTrusted || !input.analysisTrusted || !input.extractionTrusted) {
    compliance = "BLOCKED";
  } else if (!input.complianceCurrent) {
    compliance = "PARTIAL";
  } else {
    compliance = "READY";
  }

  // ── Documents ──────────────────────────────────────────────────────────────
  let documents: CanonicalModuleStatus;
  if (!input.hasDocuments) {
    documents = "NOT_RUN";
  } else if (!input.submissionPlanBuilt) {
    // docs exist but plan was never built — can't trust file names/order
    documents = "BLOCKED";
  } else if (!input.analysisTrusted) {
    documents = "BLOCKED";
  } else if (!input.docsGeneratedFromCurrentAnalysis) {
    documents = "STALE";
  } else if (!input.documentsCurrent) {
    documents = "PARTIAL";
  } else {
    documents = "READY";
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  let exportStatus: CanonicalModuleStatus;
  if (!input.extractionTrusted || !input.analysisTrusted || !input.metadataTrusted || !input.requirementsTrusted) {
    exportStatus = "BLOCKED";
  } else if (!input.submissionPlanBuilt || !input.hasDocuments) {
    exportStatus = "NOT_RUN";
  } else if (!input.docsGeneratedFromCurrentAnalysis) {
    exportStatus = "STALE";
  } else if (!input.exportAllowed) {
    exportStatus = "BLOCKED";
  } else {
    exportStatus = "READY";
  }

  return { extraction, analysis, metadata, requirements, submissionPlan, compliance, documents, export: exportStatus };
}

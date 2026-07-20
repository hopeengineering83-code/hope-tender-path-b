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

import { createElement, type ReactNode } from "react";
import type { TenderReadinessState } from "../tender-readiness-state";
import { CheckIcon, WarningIcon, CrossIcon, RefreshIcon, AlertCircleIcon, CircleIcon } from "../../components/icons";

export type CanonicalModuleStatus =
  | "READY"
  | "WARNING"
  | "BLOCKED"
  | "STALE"
  | "PARTIAL"
  | "NOT_RUN"
  | "RUNNING"
  | "NOT_APPLICABLE";

export const CANONICAL_MODULE_KEYS = [
  "extraction",
  "analysis",
  "metadata",
  "requirements",
  "matching",
  "submissionPlan",
  "compliance",
  "documents",
  "generation",
  "export",
] as const;

export type CanonicalModuleKey = typeof CANONICAL_MODULE_KEYS[number];

export type CanonicalModuleStates = Record<CanonicalModuleKey, CanonicalModuleStatus>;

export type CanonicalModuleDetail = {
  state: CanonicalModuleStatus;
  blockers: string[];
  warnings: string[];
  sourceRevision: string;
  calculatedAt: string;
  nextAction: string | null;
  reason: string;
};

export type CanonicalModuleStatePayload = Record<CanonicalModuleKey, CanonicalModuleDetail>;

export type CanonicalStatusConfig = {
  label: string;
  // A rendered icon element (inline SVG), not a raw Unicode string — glyph
  // coverage depends on the viewer's OS/browser font stack (see
  // components/icons.tsx). Built with createElement rather than JSX since
  // this file stays plain .ts.
  icon: ReactNode;
  textClass: string;
  bgClass: string;
  borderClass: string;
};

export const CANONICAL_STATUS_CONFIG: Record<CanonicalModuleStatus, CanonicalStatusConfig> = {
  READY: { label: "Ready", icon: createElement(CheckIcon), textClass: "text-emerald-700", bgClass: "bg-emerald-50", borderClass: "border-emerald-200" },
  WARNING: { label: "Warning", icon: createElement(WarningIcon), textClass: "text-amber-800", bgClass: "bg-amber-50", borderClass: "border-amber-200" },
  BLOCKED: { label: "Blocked", icon: createElement(CrossIcon), textClass: "text-red-700", bgClass: "bg-red-50", borderClass: "border-red-200" },
  STALE: { label: "Stale", icon: createElement(RefreshIcon), textClass: "text-purple-700", bgClass: "bg-purple-50", borderClass: "border-purple-200" },
  PARTIAL: { label: "Partial", icon: createElement(AlertCircleIcon), textClass: "text-blue-700", bgClass: "bg-blue-50", borderClass: "border-blue-200" },
  NOT_RUN: { label: "Not run", icon: createElement(CircleIcon), textClass: "text-slate-500", bgClass: "bg-slate-50", borderClass: "border-slate-200" },
  RUNNING: { label: "Running", icon: createElement(RefreshIcon), textClass: "text-blue-700", bgClass: "bg-blue-50", borderClass: "border-blue-200" },
  NOT_APPLICABLE: { label: "N/A", icon: "—", textClass: "text-slate-400", bgClass: "bg-slate-50", borderClass: "border-slate-100" },
};

export type ComputeCanonicalStatesInput = TenderReadinessState & {
  hasAnalysis: boolean;
  hasRequirements: boolean;
  hasDocuments: boolean;
  matchingComplete?: boolean;
  matchingBlocked?: boolean;
  generationServerReady?: boolean;
  analysisIsApprovedFallback?: boolean;
  extractionStale?: boolean;
  analysisStale?: boolean;
  requirementsStale?: boolean;
  complianceStale?: boolean;
  submissionPlanStale?: boolean;
  documentsStale?: boolean;
  runningModules?: Partial<Record<CanonicalModuleKey, boolean>>;
  notApplicableModules?: Partial<Record<CanonicalModuleKey, boolean>>;
};

const DOWNSTREAM_NOT_READY = new Set<CanonicalModuleStatus>(["BLOCKED", "PARTIAL", "STALE", "NOT_RUN"]);

function overrideModule(key: CanonicalModuleKey, state: CanonicalModuleStatus, input: ComputeCanonicalStatesInput): CanonicalModuleStatus {
  if (input.notApplicableModules?.[key]) return "NOT_APPLICABLE";
  if (input.runningModules?.[key]) return "RUNNING";
  return state;
}

export function isCanonicalReady(state: CanonicalModuleStatus): boolean {
  return state === "READY";
}

export function computeCanonicalModuleStates(input: ComputeCanonicalStatesInput): CanonicalModuleStates {
  const extractionBase: CanonicalModuleStatus = input.extractionStale ? "STALE" : input.extractionTrusted ? "READY" : "BLOCKED";
  const extraction = overrideModule("extraction", extractionBase, input);

  let analysisBase: CanonicalModuleStatus;
  if (extraction === "STALE") analysisBase = "STALE";
  else if (extraction === "BLOCKED") analysisBase = "BLOCKED";
  else if (input.analysisStale) analysisBase = "STALE";
  else if (!input.hasAnalysis) analysisBase = "NOT_RUN";
  else if (input.analysisIsApprovedFallback) analysisBase = "WARNING";
  else if (!input.analysisTrusted) analysisBase = input.blockers.some((blocker) => /regex fallback/i.test(blocker)) ? "BLOCKED" : input.rawRequirementsCount > 0 ? "PARTIAL" : "BLOCKED";
  else analysisBase = "READY";
  const analysis = overrideModule("analysis", analysisBase, input);

  const metadataBase: CanonicalModuleStatus = input.metadataTrusted ? "READY" : "BLOCKED";
  const metadata = overrideModule("metadata", metadataBase, input);

  let requirementsBase: CanonicalModuleStatus;
  if (DOWNSTREAM_NOT_READY.has(analysis)) requirementsBase = analysis === "STALE" ? "STALE" : analysis === "NOT_RUN" ? "NOT_RUN" : analysis === "PARTIAL" ? "PARTIAL" : "BLOCKED";
  else if (input.requirementsStale) requirementsBase = "STALE";
  else if (!input.hasRequirements) requirementsBase = "NOT_RUN";
  else if (!input.requirementsTrusted) requirementsBase = "PARTIAL";
  else requirementsBase = "READY";
  const requirements = overrideModule("requirements", requirementsBase, input);

  let matchingBase: CanonicalModuleStatus;
  if (DOWNSTREAM_NOT_READY.has(requirements)) matchingBase = requirements === "STALE" ? "STALE" : requirements === "NOT_RUN" ? "NOT_RUN" : "BLOCKED";
  else if (input.matchingBlocked) matchingBase = "BLOCKED";
  else if (input.matchingComplete === false) matchingBase = "NOT_RUN";
  else matchingBase = "READY";
  const matching = overrideModule("matching", matchingBase, input);

  const submissionPlanBase: CanonicalModuleStatus = input.submissionPlanStale ? "STALE" : input.submissionPlanBuilt ? "READY" : "NOT_RUN";
  const submissionPlan = overrideModule("submissionPlan", submissionPlanBase, input);

  let complianceBase: CanonicalModuleStatus;
  if (DOWNSTREAM_NOT_READY.has(requirements)) complianceBase = requirements === "STALE" ? "STALE" : requirements === "NOT_RUN" ? "NOT_RUN" : "BLOCKED";
  else if (input.complianceStale) complianceBase = "STALE";
  else if (!input.complianceCurrent) complianceBase = "PARTIAL";
  else complianceBase = "READY";
  const compliance = overrideModule("compliance", complianceBase, input);

  let documentsBase: CanonicalModuleStatus;
  if (submissionPlan !== "READY") documentsBase = submissionPlan === "STALE" ? "STALE" : input.hasDocuments ? "BLOCKED" : "NOT_RUN";
  else if (input.documentsStale || (!input.docsGeneratedFromCurrentAnalysis && input.hasDocuments)) documentsBase = "STALE";
  else if (!input.hasDocuments) documentsBase = "NOT_RUN";
  else if (DOWNSTREAM_NOT_READY.has(analysis)) documentsBase = analysis === "STALE" ? "STALE" : "BLOCKED";
  else if (!input.documentsCurrent) documentsBase = "PARTIAL";
  else documentsBase = "READY";
  const documents = overrideModule("documents", documentsBase, input);

  let generationBase: CanonicalModuleStatus;
  if (compliance === "BLOCKED" || compliance === "STALE") generationBase = compliance;
  else if (DOWNSTREAM_NOT_READY.has(documents)) generationBase = documents === "STALE" ? "STALE" : documents === "NOT_RUN" ? "NOT_RUN" : documents === "PARTIAL" ? "PARTIAL" : "BLOCKED";
  else if (input.generationServerReady === false) generationBase = "BLOCKED";
  else if (input.warnings.length > 0) generationBase = "WARNING";
  else generationBase = "READY";
  const generation = overrideModule("generation", generationBase, input);

  let exportStatusBase: CanonicalModuleStatus;
  if ([extraction, analysis, metadata, requirements, compliance, documents, generation].some((s) => s === "BLOCKED")) exportStatusBase = "BLOCKED";
  else if ([extraction, analysis, requirements, compliance, documents, generation].some((s) => s === "STALE")) exportStatusBase = "STALE";
  else if ([analysis, requirements, documents, generation].some((s) => s === "PARTIAL")) exportStatusBase = "BLOCKED";
  else if ([analysis, requirements, submissionPlan, documents, generation].some((s) => s === "NOT_RUN")) exportStatusBase = "NOT_RUN";
  else if (!input.exportAllowed) exportStatusBase = "BLOCKED";
  else exportStatusBase = "READY";
  const exportStatus = overrideModule("export", exportStatusBase, input);

  return { extraction, analysis, metadata, requirements, matching, submissionPlan, compliance, documents, generation, export: exportStatus };
}

const NEXT_ACTION_BY_MODULE: Record<CanonicalModuleKey, string> = {
  extraction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
  analysis: "RUN_AI_ANALYZE",
  metadata: "EDIT_TENDER_METADATA",
  requirements: "RUN_AI_ANALYZE",
  matching: "REVIEW_MATCHES",
  submissionPlan: "BUILD_SUBMISSION_PLAN",
  compliance: "RESOLVE_COMPLIANCE_GAPS",
  documents: "GENERATE_DOCUMENTS",
  generation: "RESOLVE_GENERATION_BLOCKERS",
  export: "OPEN_EXPORT_READINESS",
};

function reasonFor(key: CanonicalModuleKey, state: CanonicalModuleStatus): string {
  if (state === "READY") return `${key} is ready according to canonical upstream gates.`;
  if (state === "WARNING") return `${key} has non-blocking warnings; server gates remain authoritative.`;
  if (state === "RUNNING") return `${key} is currently running.`;
  if (state === "STALE") return `${key} is stale relative to current upstream inputs.`;
  if (state === "PARTIAL") return `${key} is partially complete but not final-ready.`;
  if (state === "NOT_RUN") return `${key} has not run yet.`;
  if (state === "NOT_APPLICABLE") return `${key} is not applicable for this tender.`;
  return `${key} is blocked by canonical upstream gates.`;
}

export function buildCanonicalModulePayload(
  states: CanonicalModuleStates,
  input: Pick<TenderReadinessState, "blockers" | "warnings" | "currentAnalysisHash">,
  options: { calculatedAt?: string; sourceRevision?: string; moduleReasons?: Partial<Record<CanonicalModuleKey, string>> } = {},
): CanonicalModuleStatePayload {
  const calculatedAt = options.calculatedAt ?? new Date().toISOString();
  const sourceRevision = options.sourceRevision ?? input.currentAnalysisHash;
  return CANONICAL_MODULE_KEYS.reduce((acc, key) => {
    const state = states[key];
    acc[key] = {
      state,
      blockers: state === "READY" || state === "WARNING" ? [] : input.blockers,
      warnings: input.warnings,
      sourceRevision,
      calculatedAt,
      nextAction: state === "READY" || state === "WARNING" || state === "NOT_APPLICABLE" ? null : NEXT_ACTION_BY_MODULE[key],
      reason: options.moduleReasons?.[key] ?? reasonFor(key, state),
    };
    return acc;
  }, {} as CanonicalModuleStatePayload);
}

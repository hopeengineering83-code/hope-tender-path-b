// Tender Controls Ledger — suggestion derivation.
//
// PRODUCTION SYMPTOM
// ──────────────────
// Screenshots showed Tender Controls Ledger total 0 even when real blockers
// existed: regex fallback unapproved, missing evaluationCriteria, no active
// generated docs, mandatory coverage 0, source-traceability missing,
// outside-plan docs, planned-not-generated docs, etc. The controls GET was
// already returning a small `suggestedControls` array but the panel ignored
// it AND many blocker categories had no suggestion at all.
//
// WHAT THIS MODULE DOES
// ─────────────────────
// Pure derivation function: given a `TenderLifecycleResult`-shaped input, it
// returns `SuggestedControl[]` covering every blocker category called out in
// the audit task:
//
//   • metadata incomplete
//   • regex fallback unapproved
//   • source refs missing
//   • mandatory coverage 0
//   • outside-plan docs
//   • required planned docs not generated
//   • no active export candidates
//   • provider rate-limited
//   • missing official originals
//   • quality-failed docs
//   • submission plan not built
//
// Each suggestion has a STABLE `code` so an Accept/Reject decision can be
// recorded against it in the audit log and the panel can dedupe.

export type ControlSuggestionCode =
  | "TENDER_FACTS_INCOMPLETE"
  | "ANALYSIS_NOT_RUN"
  | "REGEX_FALLBACK_UNAPPROVED"
  | "SOURCE_REFS_MISSING"
  | "MANDATORY_COVERAGE_ZERO"
  | "OUTSIDE_PLAN_DOCS"
  | "PLANNED_DOCS_NOT_GENERATED"
  | "NO_ACTIVE_EXPORT_CANDIDATES"
  | "AI_PROVIDERS_COOLING"
  | "AI_PROVIDERS_NOT_CONFIGURED"
  | "MISSING_OFFICIAL_ORIGINALS"
  | "QUALITY_FAILED_DOCS"
  | "SUBMISSION_PLAN_NOT_BUILT"
  // I — weak-match feeds. Selected expert/project matches with a score
  // below the strong threshold are "selected but weak coverage" and must
  // not be treated as fully covered. JV mitigation suggestions fire when
  // no strong candidate exists in the vault at all.
  | "WEAK_EXPERT_COVERAGE"
  | "WEAK_PROJECT_COVERAGE"
  | "JV_MITIGATION_NEEDED_EXPERTS"
  | "JV_MITIGATION_NEEDED_PROJECTS";

export type SuggestedControl = {
  /** Stable suggestion code — used by the accept/reject endpoint to dedupe. */
  code: ControlSuggestionCode;
  /** Mapped to the existing TenderControl.type union when accepted. */
  type: "TASK" | "RISK";
  title: string;
  description: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  /** UI-only marker for the suggestion row (not persisted). */
  status: "SUGGESTED";
  /** Free-form short hint for the user — what clicking Accept will do. */
  nextAction: string;
  /** Stable composite id "suggestion:<code>" for React keys + reject endpoint. */
  id: string;
  /** Always null on suggestions; set when promoted to a real control row. */
  createdAt: string;
  createdBy: null;
};

export type SuggestionDerivationInput = {
  metadataStatus: { criticalMissing: string[] };
  analysisStatus: { source: string | null };
  sourceReferenceStatus?: { ungroundedMandatoryCount: number; totalMandatoryCount: number };
  planStatus: {
    hasExplicitPlan: boolean;
    totalRequired: number;
    totalMissing: number;
    totalOutsidePlan: number;
  };
  evidenceStatus: { totalRequirements: number; requirementsWithLinkedEvidence: number };
  counts: { finalExportCandidates: number; qualityFailedCandidates: number; outsidePlanRows: number };
  providerStatus: { hasAnyProvider: boolean; hasCooledDownProvider: boolean };
  officialOriginalStatus?: { required: number; attached: number };
  /** Weak-match feed (I) — optional so existing callers keep working. */
  weakMatchReport?: {
    selectedButWeakExperts: number;
    selectedButWeakProjects: number;
    needsJVExperts: boolean;
    needsJVProjects: boolean;
    selectedButWeakExpertLabels: string[];
    selectedButWeakProjectLabels: string[];
  };
};

const REGEX_FALLBACK_SOURCES = new Set([
  "REGEX_FALLBACK",
  "REGEX_FALLBACK_AI_ERROR",
  "DETERMINISTIC_FALLBACK",
  "UNKNOWN_FALLBACK",
  "AI_PROVIDERS_EXHAUSTED",
]);

function mkSuggestion(opts: Omit<SuggestedControl, "id" | "status" | "createdAt" | "createdBy">): SuggestedControl {
  return {
    ...opts,
    id: `suggestion:${opts.code}`,
    status: "SUGGESTED",
    createdAt: new Date().toISOString(),
    createdBy: null,
  };
}

/**
 * Returns the set of controls the engine recommends adding to the Tender
 * Controls Ledger based on the current lifecycle state. Pure function — no
 * I/O, no side effects.
 */
export function deriveControlSuggestions(input: SuggestionDerivationInput): SuggestedControl[] {
  const out: SuggestedControl[] = [];

  // 1. AI providers not configured at all — this should be the first thing
  // the user sees, since nothing else recovers without a key.
  if (!input.providerStatus.hasAnyProvider) {
    out.push(mkSuggestion({
      code: "AI_PROVIDERS_NOT_CONFIGURED",
      type: "RISK",
      title: "No AI provider configured",
      description: "AI Analyze cannot run because no API key is configured. Add ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY in Vercel environment variables.",
      severity: "HIGH",
      nextAction: "Set a provider key in Vercel and redeploy.",
    }));
  } else if (input.providerStatus.hasCooledDownProvider) {
    // 2. Provider rate-limited (some provider is in cooldown). Distinct from
    // a permanent config issue.
    out.push(mkSuggestion({
      code: "AI_PROVIDERS_COOLING",
      type: "RISK",
      title: "AI providers are rate-limited or in cooldown",
      description: "At least one configured AI provider is currently in cooldown after a 429. AI Analyze will fall back to regex (unapproved) until the cooldown window expires.",
      severity: "MEDIUM",
      nextAction: "Wait for the cooldown to expire and re-run AI Analyze.",
    }));
  }

  // 3a. Analysis never run (source null/empty/UNKNOWN)
  const sourceRaw = (input.analysisStatus.source ?? "").toString().trim();
  const sourceUpper = sourceRaw.toUpperCase();
  if (sourceRaw.length === 0 || sourceUpper === "UNKNOWN") {
    out.push(mkSuggestion({
      code: "ANALYSIS_NOT_RUN",
      type: "TASK",
      title: "Run AI Analyze before generating proposals",
      description: "This tender has not been analyzed yet. AI Analyze extracts requirements, evaluation criteria, scoring weights, and submission rules. Without it, proposal generation is blocked and requirement coverage cannot be assessed.",
      severity: "HIGH",
      nextAction: "Click 'Run AI Analyze' in the engine panel above.",
    }));
  }

  // 3b. Regex fallback unapproved
  if (sourceRaw.length > 0 && REGEX_FALLBACK_SOURCES.has(sourceUpper)) {
    out.push(mkSuggestion({
      code: "REGEX_FALLBACK_UNAPPROVED",
      type: "RISK",
      title: "Analysis source is unapproved regex fallback",
      description: "AI analysis failed and the regex fallback is unapproved. Requirements may be partial; downstream scoring is unreliable. Retry AI Analyze when providers recover, or explicitly approve the fallback with a human note.",
      severity: "HIGH",
      nextAction: "Retry AI Analyze, or approve the fallback with a written justification.",
    }));
  }

  // 4. Metadata incomplete
  if (input.metadataStatus.criticalMissing.length > 0) {
    const fieldsList = input.metadataStatus.criticalMissing.slice(0, 4).join(", ");
    out.push(mkSuggestion({
      code: "TENDER_FACTS_INCOMPLETE",
      type: "TASK",
      title: "Complete critical Tender Details",
      description: `${input.metadataStatus.criticalMissing.length} critical field(s) missing (${fieldsList}). The Repair-all button will populate any value that is in the uploaded tender source; the rest must be confirmed manually.`,
      severity: "HIGH",
      nextAction: "Click 'Repair all empty fields from source' on the Generation panel, then edit any field still empty.",
    }));
  }

  // 5. Source-refs missing on mandatory requirements
  if (input.sourceReferenceStatus && input.sourceReferenceStatus.ungroundedMandatoryCount > 0) {
    out.push(mkSuggestion({
      code: "SOURCE_REFS_MISSING",
      type: "RISK",
      title: `${input.sourceReferenceStatus.ungroundedMandatoryCount} mandatory requirement(s) lack source page/quote`,
      description: "Mandatory requirements without a source reference cannot be cross-checked against the tender file. Run 'Repair source references' or edit the requirements to add verbatim quotes.",
      severity: "HIGH",
      nextAction: "Run 'Repair source references' on the Recovery panel.",
    }));
  }

  // 6. Mandatory coverage zero
  if (input.evidenceStatus.totalRequirements > 0 && input.evidenceStatus.requirementsWithLinkedEvidence === 0) {
    out.push(mkSuggestion({
      code: "MANDATORY_COVERAGE_ZERO",
      type: "RISK",
      title: "Mandatory requirements have zero evidence coverage",
      description: `${input.evidenceStatus.totalRequirements} requirement(s) have no linked evidence. Link reviewed experts, projects, or vault documents before generating the proposal.`,
      severity: "HIGH",
      nextAction: "Confirm reviewed-evidence suggestions on the Requirement Coverage panel, or link evidence from the vault.",
    }));
  }

  // 7. Submission plan not built (no explicit plan AND no required rows yet)
  if (!input.planStatus.hasExplicitPlan && input.planStatus.totalRequired === 0) {
    out.push(mkSuggestion({
      code: "SUBMISSION_PLAN_NOT_BUILT",
      type: "TASK",
      title: "Build the submission plan",
      description: "No explicit submission plan was detected and no plan rows exist yet. Without a plan, generated documents cannot be validated against tender requirements.",
      severity: "MEDIUM",
      nextAction: "Open Submission Plan Reconciliation, build the draft, review every ordered file, and confirm the Build Plan.",
    }));
  }

  // 8. Required planned docs not generated (plan exists, missing rows)
  if (input.planStatus.totalRequired > 0 && input.planStatus.totalMissing > 0) {
    out.push(mkSuggestion({
      code: "PLANNED_DOCS_NOT_GENERATED",
      type: "TASK",
      title: `${input.planStatus.totalMissing} planned document(s) not generated`,
      description: "Submission plan rows exist but the corresponding generated documents are missing. Click Generate Docs (or 'Generate missing planned documents') to produce them.",
      severity: "HIGH",
      nextAction: "Click 'Generate missing planned documents' or 'Generate Docs'.",
    }));
  }

  // 9. Outside-plan documents
  if (input.counts.outsidePlanRows > 0) {
    out.push(mkSuggestion({
      code: "OUTSIDE_PLAN_DOCS",
      type: "TASK",
      title: `Reconcile ${input.counts.outsidePlanRows} outside-plan document(s)`,
      description: "Generated documents exist that are not mapped to any submission plan row. Map them to the plan, supersede, or mark as not-exportable before final export.",
      severity: "MEDIUM",
      nextAction: "Use the row-level actions on the Submission Plan Completeness panel.",
    }));
  }

  // 10. No active export candidates (independent — may apply alongside plan/missing above)
  if (input.counts.finalExportCandidates === 0) {
    out.push(mkSuggestion({
      code: "NO_ACTIVE_EXPORT_CANDIDATES",
      type: "RISK",
      title: "No active final-export candidates",
      description: "There are no documents currently eligible for the final ZIP. Generate planned documents, attach official originals, or repair quality-failed documents before export.",
      severity: "HIGH",
      nextAction: "Generate or attach documents until at least one is final-export ready.",
    }));
  }

  // 11. Missing official originals
  if (input.officialOriginalStatus && input.officialOriginalStatus.required > 0 && input.officialOriginalStatus.attached < input.officialOriginalStatus.required) {
    const missing = input.officialOriginalStatus.required - input.officialOriginalStatus.attached;
    out.push(mkSuggestion({
      code: "MISSING_OFFICIAL_ORIGINALS",
      type: "RISK",
      title: `${missing} official original(s) not attached`,
      description: "The submission plan calls for tender-issued official originals (forms, declarations, sealed certificates). The system will NOT fabricate these — attach the signed/sealed originals before final export.",
      severity: "HIGH",
      nextAction: "Attach the official originals on the Generated Documents panel.",
    }));
  }

  // 12. Quality-failed documents
  if (input.counts.qualityFailedCandidates > 0) {
    out.push(mkSuggestion({
      code: "QUALITY_FAILED_DOCS",
      type: "RISK",
      title: `${input.counts.qualityFailedCandidates} document(s) failed the quality gate`,
      description: "Quality-failed documents cannot be included in the export package. Rewrite, regenerate, or replace them with official originals.",
      severity: "HIGH",
      nextAction: "Rewrite or attach official originals for the quality-failed documents.",
    }));
  }

  // 13-16 — weak-match feeds (I). Selected-but-weak matches must not be
  // treated as fully covered. JV mitigation fires when the vault simply
  // does not contain a strong candidate for the required disciplines.
  if (input.weakMatchReport) {
    const w = input.weakMatchReport;
    if (w.selectedButWeakExperts > 0) {
      const labels = w.selectedButWeakExpertLabels.length > 0 ? ` (${w.selectedButWeakExpertLabels.join(", ")})` : "";
      out.push(mkSuggestion({
        code: "WEAK_EXPERT_COVERAGE",
        type: "RISK",
        title: `${w.selectedButWeakExperts} selected expert(s) have weak scope coverage`,
        description: `Selected experts${labels} score below the strong-coverage threshold for this tender's disciplines. Evaluator scoring will be weak; consider replacing them with stronger reviewed experts from the vault or adding a JV/subcontract for the missing disciplines.`,
        severity: "HIGH",
        nextAction: "Open Knowledge Review and replace the weak selections, or add a JV/subcontractor for the missing disciplines.",
      }));
    }
    if (w.selectedButWeakProjects > 0) {
      const labels = w.selectedButWeakProjectLabels.length > 0 ? ` (${w.selectedButWeakProjectLabels.join(", ")})` : "";
      out.push(mkSuggestion({
        code: "WEAK_PROJECT_COVERAGE",
        type: "RISK",
        title: `${w.selectedButWeakProjects} selected project reference(s) have weak scope coverage`,
        description: `Selected project references${labels} score below the strong-coverage threshold for this tender. Evaluator experience-fit scoring will be weak; replace them with closer-fitting reviewed projects or add a JV/subcontract.`,
        severity: "HIGH",
        nextAction: "Open Knowledge Review and replace the weak project selections, or add a JV/subcontractor.",
      }));
    }
    if (w.needsJVExperts) {
      out.push(mkSuggestion({
        code: "JV_MITIGATION_NEEDED_EXPERTS",
        type: "TASK",
        title: "Consider a JV / subcontract for missing expert disciplines",
        description: "The tender requires expert disciplines but the company vault has NO strong-coverage expert match for them. A JV with (or subcontract to) a firm carrying those disciplines is the realistic mitigation; otherwise the bid carries a high capability risk.",
        severity: "MEDIUM",
        nextAction: "Identify a JV / subcontract partner whose vault covers the missing expert disciplines and add a JV-mitigation note.",
      }));
    }
    if (w.needsJVProjects) {
      out.push(mkSuggestion({
        code: "JV_MITIGATION_NEEDED_PROJECTS",
        type: "TASK",
        title: "Consider a JV / subcontract for missing project references",
        description: "The tender requires similar-experience project references but the company vault has NO strong-coverage reference. A JV / subcontract is the realistic mitigation.",
        severity: "MEDIUM",
        nextAction: "Identify a JV / subcontract partner whose vault carries similar past projects and add a JV-mitigation note.",
      }));
    }
  }

  return out;
}

/**
 * True when the suggestion can be accepted in bulk without per-suggestion
 * confirmation. We restrict bulk-accept to HIGH-severity, deterministic
 * categories so the user doesn't accidentally create a low-signal MEDIUM
 * task with one click.
 */
export function isHighConfidenceSuggestion(s: SuggestedControl): boolean {
  if (s.severity !== "HIGH") return false;
  const highConfidence: ControlSuggestionCode[] = [
    "AI_PROVIDERS_NOT_CONFIGURED",
    "ANALYSIS_NOT_RUN",
    "REGEX_FALLBACK_UNAPPROVED",
    "TENDER_FACTS_INCOMPLETE",
    "MANDATORY_COVERAGE_ZERO",
    "NO_ACTIVE_EXPORT_CANDIDATES",
    "MISSING_OFFICIAL_ORIGINALS",
    "QUALITY_FAILED_DOCS",
    "WEAK_EXPERT_COVERAGE",
    "WEAK_PROJECT_COVERAGE",
  ];
  return highConfidence.includes(s.code);
}

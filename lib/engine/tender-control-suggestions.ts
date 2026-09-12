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
  | "CANONICAL_CURRENT_ACTION"
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

// ─── GAP D: suggestion register ──────────────────────────────────────────────
//
// Every ControlSuggestionCode audited. Three things went wrong before this
// audit, and all three were the same mistake in different clothes: a
// suggestion told the owner to press something that does not exist.
//
//   • "The Repair-all button will populate any value that is in the uploaded
//     tender source" — there is no Repair-all button anywhere in the app.
//   • "Run 'Repair source references' on the Recovery panel" — there is no
//     Recovery panel with that action. /repair-source-grounding exists as a
//     route, but source grounding is repaired automatically by
//     automatic-requirement-coverage and the auto-finalize continuation
//     service; it is not an owner-facing control.
//   • Suggestions phrased as manual "Generate Docs" work, which stopped being
//     a user action when generation moved behind a successful Run Engine.
//
// `kind` records what the suggestion IS, which is the distinction the copy
// kept losing:
//
//   CURRENT       the canonical workflow's own current action, restated here.
//   DOWNSTREAM    a symptom of an upstream blocker. NOT something to act on —
//                 it clears when the upstream action clears. Never phrase one
//                 of these as an instruction.
//   INFORMATIONAL a real condition the owner may want to act on, but which is
//                 not the workflow's current blocker.
//
// AUTHORITY: none of these, in any kind. Accepting or rejecting a suggestion
// writes an audit-log row and nothing else — see the controls route, which has
// no tender mutation at all. Generation and export eligibility are owned by
// the canonical workflow decision and the readiness calculators, and are not
// reachable from this file.
export type ControlSuggestionKind = "CURRENT" | "DOWNSTREAM" | "INFORMATIONAL";

export const CONTROL_SUGGESTION_REGISTER: Record<
  ControlSuggestionCode,
  { kind: ControlSuggestionKind; canonicalStage: string; condition: string }
> = {
  CANONICAL_CURRENT_ACTION: { kind: "CURRENT", canonicalStage: "canonical", condition: "A canonical workflow decision exists and is not an automatic/complete state." },
  AI_PROVIDERS_NOT_CONFIGURED: { kind: "INFORMATIONAL", canonicalStage: "AI_ANALYZE_NOT_RUN", condition: "No AI provider key is configured." },
  AI_PROVIDERS_COOLING: { kind: "INFORMATIONAL", canonicalStage: "AI_ANALYZE_NOT_RUN", condition: "A configured provider is in cooldown after a 429." },
  ANALYSIS_NOT_RUN: { kind: "CURRENT", canonicalStage: "AI_ANALYZE_NOT_RUN", condition: "Analysis source is empty or UNKNOWN." },
  REGEX_FALLBACK_UNAPPROVED: { kind: "CURRENT", canonicalStage: "AI_ANALYZE_NOT_RUN", condition: "Analysis source is an unapproved regex/deterministic fallback." },
  TENDER_FACTS_INCOMPLETE: { kind: "CURRENT", canonicalStage: "CRITICAL_TENDER_DETAILS_INVALID", condition: "One or more critical tender facts are missing or invalid." },
  SOURCE_REFS_MISSING: { kind: "CURRENT", canonicalStage: "REQUIREMENTS_NOT_SOURCE_GROUNDED", condition: "Mandatory requirements exist without a source page/quote." },
  MANDATORY_COVERAGE_ZERO: { kind: "CURRENT", canonicalStage: "MANDATORY_NO_COMPLIANCE_ROWS", condition: "Requirements exist and none has linked evidence." },
  SUBMISSION_PLAN_NOT_BUILT: { kind: "DOWNSTREAM", canonicalStage: "NO_CONFIRMED_BUILD_PLAN", condition: "No explicit plan and no plan rows. Run Engine uses the verified source and current AI analysis to build and verify the plan." },
  PLANNED_DOCS_NOT_GENERATED: { kind: "DOWNSTREAM", canonicalStage: "REQUIRED_DOCS_NOT_GENERATED", condition: "Plan rows exist whose outputs are not yet generated." },
  OUTSIDE_PLAN_DOCS: { kind: "INFORMATIONAL", canonicalStage: "REQUIRED_DOCS_NOT_GENERATED", condition: "Generated documents exist that map to no plan row." },
  NO_ACTIVE_EXPORT_CANDIDATES: { kind: "DOWNSTREAM", canonicalStage: "EXPORT_BLOCKED", condition: "Zero documents are eligible for the final ZIP." },
  MISSING_OFFICIAL_ORIGINALS: { kind: "INFORMATIONAL", canonicalStage: "EXPORT_BLOCKED", condition: "The plan requires tender-issued forms absent from Tender Intake." },
  QUALITY_FAILED_DOCS: { kind: "INFORMATIONAL", canonicalStage: "AUTHORITY_OR_QUALITY_BLOCKERS", condition: "Generated documents failed the quality gate." },
  WEAK_EXPERT_COVERAGE: { kind: "INFORMATIONAL", canonicalStage: "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE", condition: "Selected experts score below the strong-coverage threshold." },
  WEAK_PROJECT_COVERAGE: { kind: "INFORMATIONAL", canonicalStage: "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE", condition: "Selected project references score below the strong-coverage threshold." },
  JV_MITIGATION_NEEDED_EXPERTS: { kind: "INFORMATIONAL", canonicalStage: "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE", condition: "No strong-coverage expert exists in the vault for a required discipline." },
  JV_MITIGATION_NEEDED_PROJECTS: { kind: "INFORMATIONAL", canonicalStage: "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE", condition: "No strong-coverage project reference exists in the vault." },
};

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
  /**
   * CURRENT / DOWNSTREAM / INFORMATIONAL, from CONTROL_SUGGESTION_REGISTER.
   * DOWNSTREAM rows are symptoms of an upstream blocker and must not be
   * rendered as instructions. Presentation only — no gate reads this.
   */
  kind: ControlSuggestionKind;
  /** Stable composite id "suggestion:<code>" for React keys + reject endpoint. */
  id: string;
  /** Always null on suggestions; set when promoted to a real control row. */
  createdAt: string;
  createdBy: null;
};

export type SuggestionDerivationInput = {
  canonicalDecision?: { nextRequiredAction: string; nextRequiredActionLabel: string; nextRequiredActionReason: string } | null;
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

function mkSuggestion(opts: Omit<SuggestedControl, "id" | "status" | "createdAt" | "createdBy" | "kind">): SuggestedControl {
  return {
    ...opts,
    kind: CONTROL_SUGGESTION_REGISTER[opts.code].kind,
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
  if (input.canonicalDecision) {
    const decision = input.canonicalDecision;
    if (["AUTOMATIC_PROCESSING", "WORKFLOW_COMPLETE", "COMPLETE", "EXPORT_READY"].includes(decision.nextRequiredAction)) return [];
    return [mkSuggestion({ code: "CANONICAL_CURRENT_ACTION", type: "TASK", title: decision.nextRequiredActionLabel, description: decision.nextRequiredActionReason, severity: "HIGH", nextAction: decision.nextRequiredActionLabel })];
  }
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
      nextAction: "Select Run AI Analyze on the AI Analyze panel. This is a manual action — nothing queues it for you.",
    }));
  }

  // 3b. Regex fallback unapproved
  if (sourceRaw.length > 0 && REGEX_FALLBACK_SOURCES.has(sourceUpper)) {
    out.push(mkSuggestion({
      code: "REGEX_FALLBACK_UNAPPROVED",
      type: "RISK",
      title: "Analysis source is unapproved regex fallback",
      description: "AI analysis failed and the regex fallback is unapproved. Requirements may be partial; downstream scoring is unreliable. Retry AI Analyze when providers recover.",
      severity: "HIGH",
      nextAction: "Retry AI Analyze when providers are available.",
    }));
  }

  // 4. Metadata incomplete
  if (input.metadataStatus.criticalMissing.length > 0) {
    const fieldsList = input.metadataStatus.criticalMissing.slice(0, 4).join(", ");
    out.push(mkSuggestion({
      code: "TENDER_FACTS_INCOMPLETE",
      type: "TASK",
      title: "Complete critical Tender Details",
      description: `${input.metadataStatus.criticalMissing.length} critical field(s) missing (${fieldsList}). Open Tender Details and correct each field against the tender source; a field with no value in the source must be marked as not stated rather than filled with a placeholder.`,
      severity: "HIGH",
      nextAction: "Open Tender Details and resolve the current canonical Tender Details action.",
    }));
  }

  // 5. Source-refs missing on mandatory requirements
  if (input.sourceReferenceStatus && input.sourceReferenceStatus.ungroundedMandatoryCount > 0) {
    out.push(mkSuggestion({
      code: "SOURCE_REFS_MISSING",
      type: "RISK",
      title: `${input.sourceReferenceStatus.ungroundedMandatoryCount} mandatory requirement(s) lack source page/quote`,
      description: "Mandatory requirements without a source page and quote cannot be cross-checked against the tender file. Re-run AI Analyze so requirements are re-extracted with page and quote anchors; if the source pages themselves are unreadable, upload a clearer copy of the tender document first.",
      severity: "HIGH",
      nextAction: "Re-run AI Analyze, or upload a clearer source file if the pages are unreadable.",
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
      nextAction: "Add or strengthen eligible source-backed evidence.",
    }));
  }

  // 7. Submission plan not built (no explicit plan AND no required rows yet)
  if (!input.planStatus.hasExplicitPlan && input.planStatus.totalRequired === 0) {
    out.push(mkSuggestion({
      code: "SUBMISSION_PLAN_NOT_BUILT",
      type: "TASK",
      title: "Build the submission plan",
      description: "No explicit submission plan was detected and no plan rows exist yet. Run Engine uses the verified source and current AI analysis to create and verify the Build Plan; this is a downstream consequence of the Engine not having run for the current source revision, not a separate manual build step.",
      severity: "MEDIUM",
      nextAction: "Run Engine. Build Plan creation and verification against that source follow automatically.",
    }));
  }

  // 8. Required planned docs not generated (plan exists, missing rows)
  if (input.planStatus.totalRequired > 0 && input.planStatus.totalMissing > 0) {
    out.push(mkSuggestion({
      code: "PLANNED_DOCS_NOT_GENERATED",
      type: "TASK",
      title: `${input.planStatus.totalMissing} planned document(s) not generated`,
      description: "Submission plan rows exist but their outputs have not been produced yet. Generation runs automatically once the Engine succeeds and no upstream blocker remains, so this is a downstream diagnostic — not an action. It clears on its own when generation is reached.",
      severity: "HIGH",
      nextAction: "No action here. Resolve the current canonical workflow action; generation follows automatically.",
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
      nextAction: "Use the row-level actions on the Submission Plan Reconciliation panel.",
    }));
  }

  // 10. No active export candidates (independent — may apply alongside plan/missing above)
  if (input.counts.finalExportCandidates === 0) {
    out.push(mkSuggestion({
      code: "NO_ACTIVE_EXPORT_CANDIDATES",
      type: "RISK",
      title: "No active final-export candidates",
      description: "No document is currently eligible for the final ZIP. This is a downstream consequence of whatever is blocking the workflow upstream — documents cannot become export candidates before they are generated. Tender-issued forms are sourced automatically from uploaded Tender Intake files and are never fabricated.",
      severity: "HIGH",
      nextAction: "No action here. Resolve the current canonical workflow action; export candidates follow from it.",
    }));
  }

  // 11. Missing official originals
  if (input.officialOriginalStatus && input.officialOriginalStatus.required > 0 && input.officialOriginalStatus.attached < input.officialOriginalStatus.required) {
    const missing = input.officialOriginalStatus.required - input.officialOriginalStatus.attached;
    out.push(mkSuggestion({
      code: "MISSING_OFFICIAL_ORIGINALS",
      type: "RISK",
      title: `${missing} tender-issued form(s) not found in Tender Intake`,
      description: "The submission plan requires tender-issued forms that were not found in the uploaded Tender Intake files. Upload the complete tender package to resolve this. The system will NOT fabricate these forms.",
      severity: "HIGH",
      nextAction: "Upload the complete tender package containing the required forms.",
    }));
  }

  // 12. Quality-failed documents
  if (input.counts.qualityFailedCandidates > 0) {
    out.push(mkSuggestion({
      code: "QUALITY_FAILED_DOCS",
      type: "RISK",
      title: `${input.counts.qualityFailedCandidates} document(s) failed the quality gate`,
      description: "Quality-failed documents cannot be included in the export package. Rewrite or regenerate the quality-failed documents.",
      severity: "HIGH",
      nextAction: "Rewrite or regenerate the quality-failed documents.",
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
        description: `Selected experts${labels} score below the strong-coverage threshold for this tender's disciplines. Evaluator scoring will be weak. Strengthen the Company Vault with better-matching source-verified experts, or record a JV/subcontract for the missing disciplines.`,
        severity: "HIGH",
        nextAction: "Add stronger source-verified experts to the Company Vault for the missing disciplines, or record a JV/subcontract mitigation. Selections are re-matched on the next Engine run.",
      }));
    }
    if (w.selectedButWeakProjects > 0) {
      const labels = w.selectedButWeakProjectLabels.length > 0 ? ` (${w.selectedButWeakProjectLabels.join(", ")})` : "";
      out.push(mkSuggestion({
        code: "WEAK_PROJECT_COVERAGE",
        type: "RISK",
        title: `${w.selectedButWeakProjects} selected project reference(s) have weak scope coverage`,
        description: `Selected project references${labels} score below the strong-coverage threshold for this tender. Evaluator experience-fit scoring will be weak. Add closer-fitting source-verified project references to the Company Vault, or record a JV/subcontract.`,
        severity: "HIGH",
        nextAction: "Add closer-fitting source-verified project references to the Company Vault, or record a JV/subcontract mitigation. Selections are re-matched on the next Engine run.",
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
export function isHighConfidenceSuggestion(
  // Only the code and severity are read, so callers holding a partial row —
  // the UI's own narrower SuggestedControl shape, a test literal — can ask
  // without constructing fields this predicate ignores.
  s: Partial<SuggestedControl> & Pick<SuggestedControl, "code" | "severity">,
): boolean {
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

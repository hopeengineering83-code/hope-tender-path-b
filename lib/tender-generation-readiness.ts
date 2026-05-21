import type { PrismaClient } from "@prisma/client";
import { ensureCompanyForUser } from "./company-workspace";
import { getCompanyIngestionReadiness, type CompanyIngestionReadiness } from "./company-ingestion-readiness";
import { assessTenderAnalysisQuality, type AnalysisQualityReport } from "./analysis-quality";
import { assessMatchingQuality, type MatchingQualityReport } from "./matching-quality";
import { isValidClientName, getClientNameStatus } from "./engine/metadata-validators";
import { buildSubmissionPlan, findExtraGeneratedDocuments, findMissingGeneratedDocuments } from "./engine/submission-plan";

export type GenerationReadinessItem = {
  code: string;
  message: string;
  nextAction?: string;
};

export type TenderGenerationReadiness = {
  /**
   * Legacy "ready" flag — true when there are no blockers. Equivalent to
   * supportPackageReady. Kept for backward compatibility with existing
   * UI panels that haven't migrated to the split gates yet.
   */
  ready: boolean;
  /**
   * Gap 6 fix — SUPPORT-PACKAGE generation may be allowed even when full
   * proposal generation isn't (e.g. vault fallback evidence exists but
   * the tender has 0 matches). Use this flag for "Generate Support
   * Files" / "Generate Compliance Pack" actions.
   */
  supportPackageReady: boolean;
  /**
   * Gap 6 fix — FULL_PROPOSAL_READY is stricter: requires valid client
   * metadata, real tender-specific matches with reviewed selections,
   * non-zero matching score, and analysis quality not POOR. Use this for
   * the "Generate Full Proposal" button — never use supportPackageReady.
   */
  fullProposalReady: boolean;
  readyForAnySafeGeneration: boolean;
  readyForFinalExport: boolean;
  matchingComplete: boolean;
  /**
   * Reasons full-proposal generation is blocked (subset of blockers + warnings).
   * Surfaced separately so the UI can render a clear "NOT READY because..."
   * message at the top-level Bid Control Verdict panel.
   */
  fullProposalBlockers: GenerationReadinessItem[];
  tenderId: string;
  blockers: GenerationReadinessItem[];
  warnings: GenerationReadinessItem[];
  counts: {
    requirements: number;
    unresolvedCriticalGaps: number;
    hardBlockers: number;
    expertMatches: number;
    reviewedExpertMatches: number;
    selectedExperts: number;
    reviewedSelectedExperts: number;
    projectMatches: number;
    reviewedProjectMatches: number;
    selectedProjects: number;
    reviewedSelectedProjects: number;
    activeGeneratedDocuments: number;
    requiredPlannedFiles: number;
    missingPlannedFiles: number;
    extraGeneratedFiles: number;
  };
  companyReadiness: CompanyIngestionReadiness;
  analysisQuality: AnalysisQualityReport;
  matchingQuality: MatchingQualityReport;
  generatedAt: string;
};

function criticalGapIsHardBlock(gap: { title: string; description: string; mitigationPlan: string | null }) {
  const text = `${gap.title} ${gap.description} ${gap.mitigationPlan ?? ""}`;
  return /(ineligible|debarred|blacklisted|deadline.*passed|late submission|missing required file name|missing exact file|tender not found|company profile required|no documents? have been generated|signature prohibited|branding prohibited)/i.test(text);
}

/**
 * Backward-compat shim. Delegates to the canonical validator so all
 * client-name checks across the codebase resolve to the same rules. This
 * also closes the gap where TOC fragments ("references (where available)
 * Photos or drawings...") used to pass this check.
 */
function hasRealClientName(value?: string | null): boolean {
  return isValidClientName(value);
}

function addMatchingQualityReadiness(params: {
  blockers: GenerationReadinessItem[];
  warnings: GenerationReadinessItem[];
  matchingQuality: MatchingQualityReport;
  reviewedVaultExperts: number;
  reviewedVaultProjects: number;
}) {
  const { blockers, warnings, matchingQuality, reviewedVaultExperts, reviewedVaultProjects } = params;
  const vaultFallbackAvailable = (!matchingQuality.expertRequirementExists || reviewedVaultExperts > 0) && (!matchingQuality.projectRequirementExists || reviewedVaultProjects > 0);

  // When VAULT_AWAITS_ENGINE, the score is depressed purely because the engine
  // hasn't created tender-specific match rows yet (−18/−18). The separate
  // engine-not-run warning already covers that — suppress the score-derived
  // warning to avoid restating the same root cause.
  const skipScoreWarning = matchingQuality.state === "VAULT_AWAITS_ENGINE";

  if (matchingQuality.severity === "POOR") {
    const message = `Matching quality is poor (${matchingQuality.score}/100). Review expert/project matches before final proposal generation.`;
    if (vaultFallbackAvailable) {
      if (!skipScoreWarning) {
        warnings.push({ code: "MATCHING_QUALITY_POOR_VAULT_FALLBACK", message: `${message} Vault fallback evidence is available, so support-file generation is allowed but senior review is required.`, nextAction: "OPEN_MATCHING_QUALITY" });
      }
    } else {
      blockers.push({ code: "MATCHING_QUALITY_POOR", message, nextAction: "OPEN_MATCHING_QUALITY" });
    }
  } else if (matchingQuality.severity === "WARNING" && !skipScoreWarning) {
    warnings.push({ code: "MATCHING_QUALITY_WARNING", message: `Matching quality has warnings (${matchingQuality.score}/100). Review selected evidence before final generation/export.`, nextAction: "OPEN_MATCHING_QUALITY" });
  }
}

export async function getTenderGenerationReadiness(client: PrismaClient, userId: string, tenderId: string): Promise<TenderGenerationReadiness | null> {
  const [company, tender] = await Promise.all([
    ensureCompanyForUser(client, userId),
    client.tender.findFirst({
      where: { id: tenderId, userId },
      include: {
        requirements: true,
        generatedDocuments: {
          where: { generationStatus: { not: "SUPERSEDED" } },
          select: { id: true, name: true, documentType: true, exactFileName: true, exactOrder: true, format: true, generationStatus: true, fileContent: true },
        },
        complianceGaps: { where: { isResolved: false }, select: { title: true, description: true, mitigationPlan: true, severity: true } },
        expertMatches: { include: { expert: { select: { trustLevel: true, fullName: true } } } },
        projectMatches: { include: { project: { select: { trustLevel: true, name: true } } } },
      },
    }),
  ]);

  if (!tender) return null;

  const companyReadiness = await getCompanyIngestionReadiness(company.id, {}, client);
  const generatedDocuments = tender.generatedDocuments ?? [];
  const submissionPlan = buildSubmissionPlan(tender);
  const missingPlanFiles = findMissingGeneratedDocuments(submissionPlan, generatedDocuments);
  const extraGeneratedFiles = findExtraGeneratedDocuments(submissionPlan, generatedDocuments);
  // Matching quality first so we can feed its score into analysis quality —
  // that closes the "analysis says 100/100 while matching says 0/100" bug.
  const matchingQuality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    // Gap 5 fix — pass vault counts so matching-quality can return state
    // VAULT_AWAITS_ENGINE (not POOR) when engine hasn't run yet but vault
    // has reviewed evidence ready to be used.
    vaultReviewedExperts: companyReadiness.totals.reviewedExperts,
    vaultReviewedProjects: companyReadiness.totals.reviewedProjects,
  });
  const analysisQuality = assessTenderAnalysisQuality({
    requirements: tender.requirements,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: tender.evaluationMethodology,
    submissionNotes: [tender.notes, tender.intakeSummary].filter(Boolean).join("\n\n"),
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    // Gap 4 fix — pass metadata + matching state so the score reflects reality.
    clientName: tender.clientName,
    referenceNumber: tender.reference,
    country: tender.country,
    clientContactName: tender.clientContactName,
    matchingScore: matchingQuality.score,
    selectedReviewedExperts: tender.expertMatches.filter((m) => m.isSelected && m.expert.trustLevel === "REVIEWED").length,
    selectedReviewedProjects: tender.projectMatches.filter((m) => m.isSelected && m.project.trustLevel === "REVIEWED").length,
  });

  const blockers: GenerationReadinessItem[] = companyReadiness.blockers.map((message) => ({ code: "COMPANY_INGESTION_NOT_READY", message, nextAction: "OPEN_COMPANY_READINESS" }));
  const warnings: GenerationReadinessItem[] = companyReadiness.warnings.map((message) => ({ code: "COMPANY_INGESTION_WARNING", message, nextAction: "OPEN_COMPANY_READINESS" }));

  // Gap 12/13 fix — distinguish empty vs garbage client name. UI panels
  // need to render different messages: "Client name not set" is fixable
  // by EDIT_TENDER; "Invalid client name extracted" usually means OCR
  // captured a TOC entry and the tender needs re-extraction.
  const clientNameStatus = getClientNameStatus(tender.clientName);
  if (clientNameStatus === "EMPTY" || clientNameStatus === "PLACEHOLDER") {
    blockers.push({
      code: "CLIENT_NAME_REQUIRED",
      message: "Client name is not set. Fill the tender Client Name before generating proposal documents so final files do not use \"The Client\" as a placeholder.",
      nextAction: "EDIT_TENDER",
    });
  } else if (clientNameStatus === "GARBAGE") {
    blockers.push({
      code: "CLIENT_NAME_INVALID",
      message: "Client name was extracted but appears to be a TOC/section fragment, not a real entity. Re-run metadata extraction or correct the field manually before generation.",
      nextAction: "EDIT_TENDER",
    });
  }

  if (analysisQuality.severity === "POOR") {
    blockers.push({ code: "ANALYSIS_QUALITY_POOR", message: `Tender analysis quality is poor (${analysisQuality.score}/100). Re-run AI Analyze / Run Engine and verify evaluation criteria, submission rules, and source references before generation.`, nextAction: "OPEN_ANALYSIS_QUALITY" });
  } else if (analysisQuality.severity === "WARNING") {
    warnings.push({ code: "ANALYSIS_QUALITY_WARNING", message: `Tender analysis quality has warnings (${analysisQuality.score}/100). Review before final generation/export.`, nextAction: "OPEN_ANALYSIS_QUALITY" });
  }

  addMatchingQualityReadiness({ blockers, warnings, matchingQuality, reviewedVaultExperts: companyReadiness.totals.reviewedExperts, reviewedVaultProjects: companyReadiness.totals.reviewedProjects });

  if (tender.status === "NO_BID") {
    blockers.push({ code: "NO_BID_BLOCK", message: "Tender is marked NO_BID. Apply a BID or BID_WITH_CONDITIONS decision before generation." });
  }
  if (tender.requirements.length === 0) {
    blockers.push({ code: "NO_REQUIREMENTS", message: "No tender requirements are extracted. Run AI Analyze / Run Engine first, or add requirements manually.", nextAction: "RUN_ENGINE" });
  }

  const hardBlocks = tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL" && criticalGapIsHardBlock(gap));
  for (const gap of hardBlocks) blockers.push({ code: "HARD_COMPLIANCE_BLOCKER", message: gap.title, nextAction: "RESOLVE_COMPLIANCE_GAPS" });

  const seniorReviewGaps = tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL" && !criticalGapIsHardBlock(gap));
  if (seniorReviewGaps.length > 0) {
    warnings.push({ code: "SENIOR_REVIEW_GAPS", message: `${seniorReviewGaps.length} critical evidence/review gap(s) need senior bid review.`, nextAction: "OPEN_COMPLIANCE_REVIEW" });
  }

  const expertRequirementExists = tender.requirements.some((req) => req.requirementType === "EXPERT");
  const projectRequirementExists = tender.requirements.some((req) => req.requirementType === "PROJECT_EXPERIENCE");
  const selectedExperts = tender.expertMatches.filter((match) => match.isSelected);
  const selectedProjects = tender.projectMatches.filter((match) => match.isSelected);
  const reviewedExpertMatches = tender.expertMatches.filter((match) => match.expert.trustLevel === "REVIEWED");
  const reviewedProjectMatches = tender.projectMatches.filter((match) => match.project.trustLevel === "REVIEWED");
  const reviewedSelectedExperts = selectedExperts.filter((match) => match.expert.trustLevel === "REVIEWED");
  const reviewedSelectedProjects = selectedProjects.filter((match) => match.project.trustLevel === "REVIEWED");

  // PR #398 follow-up to #394 — BEST-AVAILABLE detection. The
  // selection policy's second-pass fallback (main-engine-selection-
  // policy.ts) promotes top-N reviewed records ABOVE 0.20 but BELOW
  // the 0.55 safe floor when the safe pass produced zero. The
  // promoted match's rationale is prefixed with
  // "[BEST-AVAILABLE BELOW THRESHOLD]". Surface this in the
  // readiness panel so the bid team knows the matches need extra
  // verification BEFORE submission — the prefix alone (buried in
  // match.rationale) is too easy to miss.
  const bestAvailableExperts = selectedExperts.filter((m) => /BEST-AVAILABLE BELOW THRESHOLD/.test(m.rationale ?? ""));
  const bestAvailableProjects = selectedProjects.filter((m) => /BEST-AVAILABLE BELOW THRESHOLD/.test(m.rationale ?? ""));
  if (bestAvailableExperts.length > 0 || bestAvailableProjects.length > 0) {
    const expertNote = bestAvailableExperts.length > 0 ? `${bestAvailableExperts.length} expert match(es)` : "";
    const projectNote = bestAvailableProjects.length > 0 ? `${bestAvailableProjects.length} project match(es)` : "";
    const both = [expertNote, projectNote].filter(Boolean).join(" and ");
    warnings.push({
      code: "BEST_AVAILABLE_MATCHES_FLAGGED",
      message: `${both} were promoted under the BEST-AVAILABLE-BELOW-THRESHOLD fallback (typical when the tender's primary sector differs from the firm's vault). Bid team MUST manually verify each of these matches against the tender's actual scope before submission. Consider uploading sector-aligned experts / projects to lift future matching scores.`,
      nextAction: "REVIEW_MATCHES",
    });
  }

  // Skip the per-type "no expert/project matches" vault-fallback warnings when
  // VAULT_AWAITS_ENGINE is already reported — the consolidated engine-not-run
  // warning above already covers both types together. Avoids triple warnings
  // (engine + expert + project) for one root cause.
  const engineNotRunCovered = matchingQuality.state === "VAULT_AWAITS_ENGINE";

  if (expertRequirementExists && tender.expertMatches.length === 0) {
    if (companyReadiness.totals.reviewedExperts === 0) {
      blockers.push({ code: "NO_EXPERT_MATCHES_FOUND", message: "Tender requires experts but no expert matches exist and the company vault has no reviewed experts. Run Engine or review expert records first.", nextAction: "RUN_ENGINE" });
    } else if (!engineNotRunCovered) {
      warnings.push({ code: "NO_EXPERT_MATCHES_FOUND", message: `No expert matches linked to this tender — generation will use ${companyReadiness.totals.reviewedExperts} vault expert(s) as fallback. Run Engine to match experts to this tender.`, nextAction: "RUN_ENGINE" });
    }
  } else if (expertRequirementExists && selectedExperts.length === 0 && reviewedExpertMatches.length === 0) {
    blockers.push({ code: "NO_REVIEWED_EXPERT_MATCHES", message: "Tender requires experts but no reviewed expert matches are available for selection or auto-promotion.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });
  } else if (expertRequirementExists && selectedExperts.length === 0 && reviewedExpertMatches.length > 0) {
    warnings.push({ code: "EXPERT_AUTO_PROMOTION_AVAILABLE", message: `${reviewedExpertMatches.length} reviewed expert match(es) are available and can be auto-selected during generation if no manual selection is made.`, nextAction: "REVIEW_MATCHES" });
  } else if (expertRequirementExists && reviewedSelectedExperts.length === 0) {
    blockers.push({ code: "ALL_EXPERTS_UNREVIEWED", message: "Selected expert matches are unreviewed. Review at least one selected expert before generation.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });
  }

  if (projectRequirementExists && tender.projectMatches.length === 0) {
    if (companyReadiness.totals.reviewedProjects === 0) {
      blockers.push({ code: "NO_PROJECT_MATCHES_FOUND", message: "Tender requires project references but no project matches exist and the company vault has no reviewed projects. Run Engine or review project records first.", nextAction: "RUN_ENGINE" });
    } else if (!engineNotRunCovered) {
      warnings.push({ code: "NO_PROJECT_MATCHES_FOUND", message: `No project matches linked to this tender — generation will use ${companyReadiness.totals.reviewedProjects} vault project(s) as fallback. Run Engine to match projects to this tender.`, nextAction: "RUN_ENGINE" });
    }
  } else if (projectRequirementExists && selectedProjects.length === 0 && reviewedProjectMatches.length === 0) {
    blockers.push({ code: "NO_REVIEWED_PROJECT_MATCHES", message: "Tender requires project references but no reviewed project matches are available for selection or auto-promotion.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });
  } else if (projectRequirementExists && selectedProjects.length === 0 && reviewedProjectMatches.length > 0) {
    warnings.push({ code: "PROJECT_AUTO_PROMOTION_AVAILABLE", message: `${reviewedProjectMatches.length} reviewed project match(es) are available and can be auto-selected during generation if no manual selection is made.`, nextAction: "REVIEW_MATCHES" });
  } else if (projectRequirementExists && reviewedSelectedProjects.length === 0) {
    blockers.push({ code: "ALL_PROJECTS_UNREVIEWED", message: "Selected project matches are unreviewed. Review at least one selected project before generation.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });
  }

  // ─── Gap 6 fix — split readiness gates ───────────────────────────
  // supportPackageReady = there are no blockers AT ALL. Identical to the
  //   legacy `ready` flag for back-compat. Allows generating support /
  //   compliance / form-template files using vault fallback evidence.
  // fullProposalReady = additionally requires REAL tender-specific
  //   matches (not just vault fallback), valid client metadata, non-zero
  //   matching score, and analysis quality not POOR.
  // Each block here records the SPECIFIC reason it failed so the UI can
  // render "NOT READY because…" with actionable detail.
  const fullProposalBlockers: GenerationReadinessItem[] = [];
  // Use the structural matchingState (Gap 5) so the blocker message
  // reflects the actual cause — "engine hasn't run yet" vs "matches
  // exist but all weak" vs "no vault at all" — instead of a generic
  // "matching is 0/100" line.
  if (matchingQuality.state === "VAULT_AWAITS_ENGINE") {
    // Vault has reviewed evidence — generation works via fallback even without
    // tender-specific matching. Downgrade to a warning so the bid control verdict
    // is not blocked solely because the user hasn't run the engine yet. Running
    // the engine will improve match quality but is not a prerequisite for generation.
    warnings.push({
      code: "FULL_PROPOSAL_ENGINE_NOT_RUN",
      message: `Run Engine has not been triggered for this tender. Generation will use vault fallback (${matchingQuality.vaultReviewedExperts} reviewed expert(s) and ${matchingQuality.vaultReviewedProjects} reviewed project(s)). Run Engine first for higher-quality tender-specific matching.`,
      nextAction: "RUN_ENGINE",
    });
  } else if (matchingQuality.state === "NO_VAULT" && (expertRequirementExists || projectRequirementExists)) {
    fullProposalBlockers.push({
      code: "FULL_PROPOSAL_NO_VAULT",
      message: "Full proposal generation is blocked: company vault has no reviewed expert/project evidence to back this tender's requirements.",
      nextAction: "OPEN_COMPANY_READINESS",
    });
  } else if (matchingQuality.state === "MATCHES_WEAK" && matchingQuality.score < 50) {
    fullProposalBlockers.push({
      code: "FULL_PROPOSAL_MATCHES_WEAK",
      message: `Full proposal generation is blocked: matching score is ${matchingQuality.score}/100 and no reviewed evidence is linked to this tender. Review/import stronger evidence and re-run matching.`,
      nextAction: "OPEN_KNOWLEDGE_REVIEW",
    });
  }
  if (clientNameStatus !== "VALID") {
    fullProposalBlockers.push({
      code: "FULL_PROPOSAL_CLIENT_INVALID",
      message: clientNameStatus === "GARBAGE"
        ? "Full proposal generation is blocked: client name is invalid (TOC/section fragment, not a real entity)."
        : "Full proposal generation is blocked: client name is empty or a placeholder.",
      nextAction: "EDIT_TENDER",
    });
  }
  if (analysisQuality.severity === "POOR") {
    fullProposalBlockers.push({
      code: "FULL_PROPOSAL_ANALYSIS_POOR",
      message: `Full proposal generation is blocked: analysis quality is poor (${analysisQuality.score}/100).`,
      nextAction: "OPEN_ANALYSIS_QUALITY",
    });
  }
  // Full proposal also requires reviewed selected evidence when the tender
  // demands experts/projects — not just vault fallback availability.
  // Skip these when the engine hasn't run yet (VAULT_AWAITS_ENGINE) — the
  // FULL_PROPOSAL_ENGINE_NOT_RUN blocker already covers that root cause and
  // these would only repeat the same underlying problem with different wording.
  if (matchingQuality.state !== "VAULT_AWAITS_ENGINE") {
    if (expertRequirementExists && reviewedSelectedExperts.length === 0 && reviewedExpertMatches.length === 0) {
      fullProposalBlockers.push({
        code: "FULL_PROPOSAL_NO_REVIEWED_EXPERTS",
        message: "Full proposal generation is blocked: tender requires experts but no reviewed expert matches exist for this tender.",
        nextAction: "OPEN_KNOWLEDGE_REVIEW",
      });
    }
    if (projectRequirementExists && reviewedSelectedProjects.length === 0 && reviewedProjectMatches.length === 0) {
      fullProposalBlockers.push({
        code: "FULL_PROPOSAL_NO_REVIEWED_PROJECTS",
        message: "Full proposal generation is blocked: tender requires project references but no reviewed project matches exist for this tender.",
        nextAction: "OPEN_KNOWLEDGE_REVIEW",
      });
    }
  }
  // Inherit hard blockers from the support-package gate — but dedupe by
  // TOPIC, not by exact message string.
  //
  // PRIOR BUG: an earlier dedupe pass compared message strings literally.
  // That missed the production-screenshot case where the local
  // full-proposal check pushed:
  //   "Full proposal generation is blocked: client name is invalid (TOC/section fragment, not a real entity)."
  // while the inherited support-package blocker said:
  //   "Client name was extracted but appears to be a TOC/section fragment, not a real entity. Re-run metadata extraction or correct the field manually before generation."
  // Same root cause, different wording → both rendered, so the user saw
  // the client-name complaint listed THREE times in the same panel
  // (matching-quality and analysis-quality had the same problem).
  //
  // Topic mapping below treats codes that describe the same underlying
  // problem as one bucket. When the full-proposal-specific blocker has
  // already fired for a topic, the inherited support-package version is
  // dropped — the user sees a single, clearer message per topic.
  const codeToTopic: Record<string, string> = {
    // Client name
    CLIENT_NAME_REQUIRED: "CLIENT_NAME",
    CLIENT_NAME_INVALID: "CLIENT_NAME",
    FULL_PROPOSAL_CLIENT_INVALID: "CLIENT_NAME",
    // Analysis quality
    ANALYSIS_QUALITY_POOR: "ANALYSIS_QUALITY",
    ANALYSIS_QUALITY_WARNING: "ANALYSIS_QUALITY",
    FULL_PROPOSAL_ANALYSIS_POOR: "ANALYSIS_QUALITY",
    // Matching quality / engine-not-run / no-vault
    MATCHING_QUALITY_POOR: "MATCHING",
    MATCHING_QUALITY_POOR_VAULT_FALLBACK: "MATCHING",
    FULL_PROPOSAL_MATCHES_WEAK: "MATCHING",
    FULL_PROPOSAL_ENGINE_NOT_RUN: "MATCHING",
    FULL_PROPOSAL_NO_VAULT: "MATCHING",
    // Expert match availability
    NO_EXPERT_MATCHES_FOUND: "EXPERT_MATCHES",
    NO_REVIEWED_EXPERT_MATCHES: "EXPERT_MATCHES",
    ALL_EXPERTS_UNREVIEWED: "EXPERT_MATCHES",
    FULL_PROPOSAL_NO_REVIEWED_EXPERTS: "EXPERT_MATCHES",
    // Project match availability
    NO_PROJECT_MATCHES_FOUND: "PROJECT_MATCHES",
    NO_REVIEWED_PROJECT_MATCHES: "PROJECT_MATCHES",
    ALL_PROJECTS_UNREVIEWED: "PROJECT_MATCHES",
    FULL_PROPOSAL_NO_REVIEWED_PROJECTS: "PROJECT_MATCHES",
  };
  function topicOf(code: string): string {
    return codeToTopic[code] ?? code;
  }

  // First pass: seed seen-topic set with what the full-proposal-specific
  // checks already covered. Also dedupe within fullProposalBlockers itself
  // (defensive — handles the case where two local checks happened to fire
  // for the same topic with slightly different wording).
  const seenTopics = new Set<string>();
  const dedupedLocal: GenerationReadinessItem[] = [];
  for (const item of fullProposalBlockers) {
    const topic = topicOf(item.code);
    if (seenTopics.has(topic)) continue;
    seenTopics.add(topic);
    dedupedLocal.push(item);
  }
  fullProposalBlockers.length = 0;
  fullProposalBlockers.push(...dedupedLocal);

  // Second pass: inherit support-package blockers by topic only when the
  // full-proposal section hasn't already covered that topic.
  for (const b of blockers) {
    const topic = topicOf(b.code);
    if (seenTopics.has(topic)) continue;
    seenTopics.add(topic);
    fullProposalBlockers.push(b);
  }

  const supportPackageReady = blockers.length === 0;
  const fullProposalReady = fullProposalBlockers.length === 0;
  const readyForAnySafeGeneration = supportPackageReady || fullProposalReady;
  const matchingComplete = matchingQuality.state === "MATCHES_REVIEWED";
  const readyForFinalExport = fullProposalReady;

  return {
    // Legacy flag mapped to full-proposal gate to avoid false-green interpretations.
    ready: fullProposalReady,
    supportPackageReady,
    fullProposalReady,
    readyForAnySafeGeneration,
    readyForFinalExport,
    matchingComplete,
    fullProposalBlockers,
    tenderId,
    blockers,
    warnings,
    counts: {
      requirements: tender.requirements.length,
      unresolvedCriticalGaps: tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL").length,
      hardBlockers: hardBlocks.length,
      expertMatches: tender.expertMatches.length,
      reviewedExpertMatches: reviewedExpertMatches.length,
      selectedExperts: selectedExperts.length,
      reviewedSelectedExperts: reviewedSelectedExperts.length,
      projectMatches: tender.projectMatches.length,
      reviewedProjectMatches: reviewedProjectMatches.length,
      selectedProjects: selectedProjects.length,
      reviewedSelectedProjects: reviewedSelectedProjects.length,
      activeGeneratedDocuments: generatedDocuments.length,
      requiredPlannedFiles: submissionPlan.files?.length ?? 0,
      missingPlannedFiles: missingPlanFiles.length,
      extraGeneratedFiles: extraGeneratedFiles.length,
    },
    companyReadiness,
    analysisQuality,
    matchingQuality,
    generatedAt: new Date().toISOString(),
  };
}

import type { PrismaClient } from "@prisma/client";
import { ensureCompanyForUser } from "./company-workspace";
import { getCompanyIngestionReadiness, type CompanyIngestionReadiness } from "./company-ingestion-readiness";
import { assessTenderAnalysisQuality, type AnalysisQualityReport } from "./analysis-quality";
import { assessMatchingQuality, type MatchingQualityReport } from "./matching-quality";
import { isValidClientName, getClientNameStatus } from "./engine/metadata-validators";
import { assertAnalysisReadyForFinalGeneration, detectAnalysisSourceWithApproval } from "./engine/analysis-source";
import { assessTenderMetadataCompleteness } from "./engine/tender-metadata-completeness";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT, type ReviewRecordState } from "./vault-review-provenance";
// Same base-name rule the finalize-pdf route uses to find a source, so this
// warning and that route can never disagree about what is finalizable.
import { normalizeFileBaseName } from "./engine/workflow/pdf-finalizer";
// Round follow-up to PR #424/#425 — surface PDF-required + branding/
// signature/stamp policy in the readiness panel BEFORE the user
// clicks Download. Operators see the conflict early and fix it
// (toggle AppSettings, upload PDF, etc.) instead of hitting a 422
// at export time.
import {
  detectBrandingPolicy,
  detectTenderFormatPolicy,
  resolveExportAssetStatus,
  type BrandingPolicy,
  type ExportAssetStatus,
  type TenderFormatPolicy,
} from "./engine/export-format-policy";

export type GenerationReadinessItem = {
  code: string;
  message: string;
  nextAction?: string;
};

export type TenderGenerationReadiness = {
  /**
   * Numeric readiness score 0-100 computed as:
   *   (gates_passed / total_gates) * 100
   * Total gates = blockers + fullProposalBlockers + warnings (each warning
   * counts as half a failed gate). Rounded to nearest integer.
   * 0-39 = NOT READY, 40-69 = PARTIAL, 70-89 = READY, 90-100 = FULLY READY.
   */
  score: number;
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
  };
  companyReadiness: CompanyIngestionReadiness;
  analysisQuality: AnalysisQualityReport;
  matchingQuality: MatchingQualityReport;
  /**
   * Export-format policy detected from the tender's exactFileNaming /
   * exactFileOrder / per-requirement exactFileName. UI uses this to
   * show "tender requires PDF" labels in the readiness panel.
   */
  formatPolicy: TenderFormatPolicy;
  /**
   * Branding / signature / stamp policy combining tender-side
   * restriction scan with firm-side AppSettings toggles. UI uses
   * this to show brandingApplied / signatureApplied / stampApplied
   * badges in the readiness panel BEFORE the user clicks Download
   * (the actual policy enforcement still happens in the download
   * route — this is the early-warning surface).
   */
  exportAssetStatus: ExportAssetStatus;
  generatedAt: string;
  metadataReport: import("./engine/tender-metadata-completeness").MetadataCompletenessReport;
};

/**
 * Parse numeric weights from evaluationCriteriaSourceJson.
 * Handles "30%", "30 points", "30 marks", "30", "Technical 30%" etc.
 * Returns { sum, covered, total } where covered = entries with a parseable weight.
 */
function parseEvalWeights(json: string | null | undefined): { sum: number; covered: number; total: number } | null {
  if (!json) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  let sum = 0;
  let covered = 0;
  for (const entry of parsed) {
    const raw = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>).weight : null;
    const str = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : null;
    if (!str) continue;
    const match = str.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      sum += parseFloat(match[1]);
      covered++;
    }
  }
  return { sum, covered, total: parsed.length };
}

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

  if (matchingQuality.severity === "POOR") {
    const message = `Matching quality is poor (${matchingQuality.score}/100). Review expert/project matches before final proposal generation.`;
    if (vaultFallbackAvailable) {
      warnings.push({ code: "MATCHING_QUALITY_POOR_VAULT_FALLBACK", message: `${message} Vault fallback evidence is available, so support-file generation is allowed but senior review is required.`, nextAction: "OPEN_MATCHING_QUALITY" });
    } else {
      blockers.push({ code: "MATCHING_QUALITY_POOR", message, nextAction: "OPEN_MATCHING_QUALITY" });
    }
  } else if (matchingQuality.severity === "WARNING") {
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
        complianceGaps: { where: { isResolved: false }, select: { title: true, description: true, mitigationPlan: true, severity: true } },
        expertMatches: { include: { expert: { select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT } } },
        projectMatches: { include: { project: { select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT } } },
      },
    }),
  ]);

  if (!tender) return null;

  const overrideModel = (client as unknown as { tenderMetadataOverride?: { findMany: (q: unknown) => Promise<Array<{ field: string; fieldState: string }>> } }).tenderMetadataOverride;
  const metadataOverrides = overrideModel
    ? await overrideModel.findMany({ where: { tenderId } }).catch(() => [] as Array<{ field: string; fieldState: string }>)
    : [];
  const overrideByField = new Map(metadataOverrides.map(o => [o.field, o]));

  // $queryRaw MUST be invoked on the client, not detached from it.
  //
  // This previously read `const queryRaw = (client as …).$queryRaw` and then
  // called `queryRaw\`SELECT …\``. Prisma's $queryRaw needs its receiver — it
  // dereferences `this._createPrismaPromise` — so calling the detached
  // reference threw
  //
  //     TypeError: Cannot read properties of undefined (reading '_createPrismaPromise')
  //
  // and the `.catch()` beside it could not help, because the throw happens
  // synchronously while evaluating the tagged template, before any promise
  // exists. The guard was written to tolerate test mocks that omit $queryRaw,
  // and it did exactly that — while breaking the real client. Every caller
  // reaching this line in production crashed, including
  // app/api/tenders/[id]/download/route.ts:106, which sits on the ZIP path
  // unconditionally: the final submission package could not be downloaded at
  // all.
  //
  // Kept mock-tolerant, but the capability check is now separate from the call
  // and the call goes through `client` so the receiver survives. try/catch,
  // not .catch(), because a synchronous throw is the failure mode that got us
  // here.
  const supportsQueryRaw =
    typeof (client as unknown as { $queryRaw?: unknown }).$queryRaw === "function";
  let extractedTextLength = 0;
  let totalPageCount = 0;
  if (supportsQueryRaw) {
    try {
      const rows = await client.$queryRaw<Array<{ extractedTextLength: number; totalPageCount: number }>>`
        SELECT
          COALESCE(SUM(char_length("extractedText")), 0)::int AS "extractedTextLength",
          COALESCE(SUM(COALESCE("totalPages", 0)), 0)::int AS "totalPageCount"
        FROM "TenderFile"
        WHERE "tenderId" = ${tenderId}
      `;
      extractedTextLength = rows[0]?.extractedTextLength ?? 0;
      totalPageCount = rows[0]?.totalPageCount ?? 0;
    } catch {
      extractedTextLength = 0;
      totalPageCount = 0;
    }
  }

  // Check derived-draft plan state (generatedDocuments not in main query).
  // Defensive: test mocks may not implement generatedDocument — default to 0 on any error.
  const genDocModel = (client as unknown as Record<string, unknown>).generatedDocument as undefined | { count: (q: unknown) => Promise<number> };
  const derivedDraftCount = genDocModel ? await genDocModel.count({
    where: {
      tenderId,
      generationStatus: { not: "SUPERSEDED" },
      reviewStatus: { in: ["PLANNED", "PENDING", "APPROVED", "CONFIRMED", "READY_FOR_EXPORT", "REPLACE_WITH_ORIGINAL"] },
      contentSummary: { contains: "DERIVED_DRAFT_UNCONFIRMED" },
    },
  }).catch(() => 0) : 0;
  const totalPlannedCount = genDocModel ? await genDocModel.count({
    where: {
      tenderId,
      generationStatus: { not: "SUPERSEDED" },
      reviewStatus: { in: ["PLANNED", "PENDING", "APPROVED", "CONFIRMED", "READY_FOR_EXPORT", "REPLACE_WITH_ORIGINAL"] },
    },
  }).catch(() => 0) : 0;

  const companyReadiness = await getCompanyIngestionReadiness(company.id, {}, client);
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
  const resolvedAnalysisSource = await detectAnalysisSourceWithApproval(client, tenderId, tender).catch(() => "UNKNOWN" as const);

  const analysisQuality = assessTenderAnalysisQuality({
    requirements: tender.requirements,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: tender.evaluationMethodology,
    submissionNotes: [tender.notes, tender.intakeSummary].filter(Boolean).join("\n\n"),
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    // Gap 4 fix — pass metadata + matching state so the score reflects reality.
    // Use procuringEntityName / legalClientName / donorAgency / implementingAgency as
    // fallback when clientName is null (AI Analyze tenders or donor-funded projects).
    clientName: tender.clientName || tender.procuringEntityName || tender.legalClientName || tender.donorAgency || tender.implementingAgency,
    referenceNumber: tender.reference,
    country: tender.country,
    clientContactName: tender.clientContactName,
    matchingScore: matchingQuality.score,
    extractedTextLength,
    totalPageCount,
    deadline: tender.deadline,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    analysisExtractionStatus: tender.analysisExtractionStatus,
    selectedReviewedExperts: tender.expertMatches.filter((m) => m.isSelected && canUseVaultRecord(m.expert as ReviewRecordState, "GENERATION")).length,
    selectedReviewedProjects: tender.projectMatches.filter((m) => m.isSelected && canUseVaultRecord(m.project as ReviewRecordState, "GENERATION")).length,
    analysisSource: resolvedAnalysisSource,
  });

  const blockers: GenerationReadinessItem[] = companyReadiness.blockers.map((message) => ({ code: "COMPANY_INGESTION_NOT_READY", message, nextAction: "OPEN_COMPANY_READINESS" }));
  const warnings: GenerationReadinessItem[] = companyReadiness.warnings.map((message) => ({ code: "COMPANY_INGESTION_WARNING", message, nextAction: "OPEN_COMPANY_READINESS" }));

  // Gap 12/13 fix — distinguish empty vs garbage client name. UI panels
  // need to render different messages: "Client name not set" is fixable
  // by EDIT_TENDER; "Invalid client name extracted" usually means OCR
  // captured a TOC entry and the tender needs re-extraction.
  const effectiveClientNameForReadiness = tender.clientName
    || tender.procuringEntityName
    || tender.legalClientName
    || tender.donorAgency
    || tender.implementingAgency;
  const clientNameStatus = getClientNameStatus(effectiveClientNameForReadiness);
  // METADATA IS NO LONGER A BLOCKER OR WARNING (unified runtime model).

  if (analysisQuality.severity === "POOR" || analysisQuality.severity === "UNSAFE") {
    blockers.push({ code: "ANALYSIS_QUALITY_POOR", message: `Tender analysis quality is poor (${analysisQuality.score}/100). Verify or improve the extracted source, then re-run AI Analyze. Run Engine only after the current analysis is trustworthy; it starts matching and Build Plan/downstream processing, not source verification.`, nextAction: "OPEN_ANALYSIS_QUALITY" });
  } else if (analysisQuality.severity === "WARNING") {
    warnings.push({ code: "ANALYSIS_QUALITY_WARNING", message: `Tender analysis quality has warnings (${analysisQuality.score}/100). Review before final generation/export.`, nextAction: "OPEN_ANALYSIS_QUALITY" });
  }

  addMatchingQualityReadiness({ blockers, warnings, matchingQuality, reviewedVaultExperts: companyReadiness.totals.reviewedExperts, reviewedVaultProjects: companyReadiness.totals.reviewedProjects });

  if (tender.status === "NO_BID") {
    blockers.push({ code: "NO_BID_BLOCK", message: "Tender is marked NO_BID. Apply a BID or BID_WITH_CONDITIONS decision before generation." });
  }
  // Gap 1: NO_REQUIREMENTS is no longer a blocker. Readable, integrity-
  // verified extracted tender text must proceed even when there are no
  // structured requirements. Source-text-only generation uses the extracted
  // scope, tender type, requested services, deliverables, forms and
  // submission instructions. Genuinely absent information is stored as
  // NOT_STATED — never invented.

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
  const reviewedExpertMatches = tender.expertMatches.filter((match) => canUseVaultRecord(match.expert as ReviewRecordState, "GENERATION"));
  const reviewedProjectMatches = tender.projectMatches.filter((match) => canUseVaultRecord(match.project as ReviewRecordState, "GENERATION"));
  const reviewedSelectedExperts = selectedExperts.filter((match) => canUseVaultRecord(match.expert as ReviewRecordState, "GENERATION"));
  const reviewedSelectedProjects = selectedProjects.filter((match) => canUseVaultRecord(match.project as ReviewRecordState, "GENERATION"));

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

  if (expertRequirementExists && tender.expertMatches.length === 0) {
    if (companyReadiness.totals.reviewedExperts === 0) {
      blockers.push({ code: "NO_EXPERT_MATCHES_FOUND", message: "Tender requires experts but no expert matches exist and the company vault has no reviewed experts. Run Engine or review expert records first.", nextAction: "RUN_ENGINE" });
    } else {
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
    } else {
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
    fullProposalBlockers.push({
      code: "FULL_PROPOSAL_ENGINE_NOT_RUN",
      // State only what is actually known here. VAULT_AWAITS_ENGINE means "the
      // vault holds reviewed evidence but no tender-specific matches exist yet".
      // It does NOT mean the user never pressed Run Engine: this function has no
      // knowledge of job state, and the condition stays true for the whole time
      // an Engine job is running. The previous wording asserted "Run Engine has
      // not been triggered for this tender", which contradicted the evidence
      // panel ("An Engine job is already running for this revision") and the
      // release banner ("Processing automatically") on the same screen.
      message: `Full proposal generation is blocked: no tender-specific evidence matches exist yet (vault has ${matchingQuality.vaultReviewedExperts} reviewed expert(s) and ${matchingQuality.vaultReviewedProjects} reviewed project(s) ready). Run Engine if it has not been started; if it is already running, matching will populate automatically.`,
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
  // METADATA IS NO LONGER A BLOCKER — clientNameStatus does NOT block full proposal generation.
  if (analysisQuality.severity === "POOR" || analysisQuality.severity === "UNSAFE") {
    fullProposalBlockers.push({
      code: "FULL_PROPOSAL_ANALYSIS_POOR",
      message: `Full proposal generation is blocked: analysis quality is poor (${analysisQuality.score}/100).`,
      nextAction: "OPEN_ANALYSIS_QUALITY",
    });
  }
  // Block when extraction was detected as corrupted/unreadable — distinct from
  // ANALYSIS_POOR so operators know the root cause is PDF extraction, not AI quality.
  if (tender.analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED") {
    fullProposalBlockers.push({
      code: "FULL_PROPOSAL_EXTRACTION_CORRUPTED",
      message: "Full proposal generation is blocked: the tender document extraction was corrupted or unreadable and AI analysis was skipped. Re-upload the document or upload a clearer scan before generating.",
      nextAction: "RE_UPLOAD_TENDER",
    });
  }
  // Mirror the server-side generate-route gate so the panel can never show
  // "Full proposal generation gate: passes" / a green button while the
  // analysis came from an unapproved regex/deterministic fallback. The
  // generate route returns 409 in that state; the UI must reflect the same
  // truth instead of contradicting it. FAIL-CLOSED: if the gate throws, we
  // MUST NOT default to ok:true — that would silently authorize generation
  // when the gate could not be evaluated. The previous `.catch(() => ({ ok:
  // true }))` was fail-open and contradicted the release-safety principle.
  let analysisGate: { ok: true } | { ok: false; code: string; message: string; nextAction: string };
  try {
    analysisGate = await assertAnalysisReadyForFinalGeneration(client, tenderId, tender);
  } catch {
    analysisGate = {
      ok: false,
      code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
      message: "Analysis readiness gate could not be evaluated (database or resolver error). Generation is blocked until the gate can run successfully.",
      nextAction: "RERUN_AI_ANALYZE",
    };
  }
  if (!analysisGate.ok) {
    fullProposalBlockers.push({
      code: analysisGate.code,
      message: `Full proposal generation is blocked: ${analysisGate.message}`,
      nextAction: analysisGate.nextAction,
    });
  }

  // Mirror the POST /generate metadata-completeness gate so the panel can
  // never show "Full proposal generation gate: passes" while the same POST
  // would return 422 with METADATA_INCOMPLETE_FOR_GENERATION. The two paths
  // call the same helper with the same inputs so they agree byte-for-byte.
  const effectiveClientName = tender.clientName
    || tender.procuringEntityName
    || tender.legalClientName
    || tender.donorAgency
    || tender.implementingAgency;
  const metadataReport = assessTenderMetadataCompleteness({
    clientName: effectiveClientName,
    procuringEntityName: tender.procuringEntityName,
    title: tender.title,
    reference: tender.reference ?? null,
    country: tender.country ?? null,
    submissionMethod: tender.submissionMethod ?? null,
    submissionAddress: tender.submissionAddress ?? null,
    submissionEmails: tender.submissionEmails ?? null,
    deadline: tender.deadline ?? null,
    clientContactName: tender.clientContactName ?? null,
    clientContactEmail: tender.clientContactEmail ?? null,
    clientContactPhone: tender.clientContactPhone ?? null,
    pageLimit: tender.pageLimit ?? null,
    budget: tender.budget ?? null,
    currency: tender.currency ?? null,
    validityDays: tender.validityDays ?? null,
    bidBondAmount: tender.bidBondAmount ?? null,
    bidBondCurrency: tender.bidBondCurrency ?? null,
    mandatorySiteVisit: tender.mandatorySiteVisit ?? null,
    numberOfCopiesRequired: tender.numberOfCopiesRequired ?? null,
    preBidMeetingDate: tender.preBidMeetingDate ?? null,
    preBidMeetingLocation: tender.preBidMeetingLocation ?? null,
    clientCity: tender.clientCity ?? null,
    clientAddress: tender.clientAddress ?? null,
    clientWebsite: tender.clientWebsite ?? null,
    submissionEmailSubject: tender.submissionEmailSubject ?? null,
    preBidChannel: tender.preBidChannel ?? null,
    clientRepresentative: tender.clientRepresentative ?? null,
    legalClientName: tender.legalClientName ?? null,
    donorAgency: tender.donorAgency ?? null,
    implementingAgency: tender.implementingAgency ?? null,
    requirementCount: tender.requirements.length,
    hasEvaluationMethodology: Boolean((tender.evaluationMethodology ?? "").trim()),
    hasSubmissionRules: Boolean(tender.submissionMethod || tender.submissionEmails || tender.submissionAddress),
  });
  // Metadata completeness is NOT a blocker for draft work. It is an
  // informational report only. Only Final Submission Check blocks on
  // incomplete metadata (via blockingForExport).
  // (Previously: FULL_PROPOSAL_METADATA_INCOMPLETE blocker removed per metadata-optional policy)
  // METADATA COMPLETENESS IS NO LONGER A WARNING OR BLOCKER (unified runtime model).

  // Block when all planned docs are unconfirmed derived-draft heuristics.
  if (derivedDraftCount > 0 && derivedDraftCount === totalPlannedCount && totalPlannedCount > 0) {
    fullProposalBlockers.push({
      code: "FULL_PROPOSAL_DERIVED_PLAN_UNCONFIRMED",
      message: "Full proposal generation is blocked: the submission plan was automatically derived from requirement keywords and has not been confirmed against the actual tender document. Review the plan, verify each required document, and confirm before generating.",
      nextAction: "CONFIRM_SUBMISSION_PLAN",
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
    // Extraction quality / corruption
    FULL_PROPOSAL_EXTRACTION_CORRUPTED: "EXTRACTION",
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
    // Metadata completeness
    FULL_PROPOSAL_METADATA_INCOMPLETE: "METADATA",
    DERIVED_PLAN_UNCONFIRMED: "SUBMISSION_PLAN",
    FULL_PROPOSAL_DERIVED_PLAN_UNCONFIRMED: "SUBMISSION_PLAN",
    // Expert match availability
    NO_EXPERT_MATCHES_FOUND: "EXPERT_MATCHES",
    NO_REVIEWED_EXPERT_MATCHES: "EXPERT_MATCHES",
    ALL_EXPERTS_UNREVIEWED: "EXPERT_MATCHES",
    FULL_PROPOSAL_NO_REVIEWED_EXPERTS: "EXPERT_MATCHES",
    // Project match availability
    NO_PROJECT_MATCHES_FOUND: "PROJECT_MATCHES",
    NO_REVIEWED_PROJECT_MATCHES: "PROJECT_MATCHES",
    // Evaluation weights
    EVAL_WEIGHTS_INCOMPLETE: "EVAL_WEIGHTS",
    EVAL_WEIGHTS_MISSING: "EVAL_WEIGHTS",
    // Compliance matrix / evidence coverage
    MANDATORY_EVIDENCE_NOT_ASSESSED: "EVIDENCE_COVERAGE",
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

  // ─── Export-format + branding policy surfacing (PR follow-up to #424/#425) ──
  // Detect what the tender's submission plan requires (.pdf vs .docx)
  // and what it prohibits (branding / signature / stamp / anonymous).
  // Compose with the firm's AppSettings to produce the structured
  // status objects the UI shows in the readiness panel. Surface
  // matching warnings here so operators see issues BEFORE clicking
  // Download (the route still enforces; this is the early-warning).
  const formatPolicy = detectTenderFormatPolicy({
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    requirements: tender.requirements.map((r) => ({ exactFileName: r.exactFileName ?? null })),
  });

  const tenderText = [
    tender.title ?? "",
    tender.description ?? "",
    tender.intakeSummary ?? "",
    tender.analysisSummary ?? "",
    tender.evaluationMethodology ?? "",
    tender.notes ?? "",
    ...tender.requirements.map((r) => `${r.title ?? ""} ${r.description ?? ""} ${r.restrictions ?? ""}`),
  ].join("\n\n");
  const brandingPolicy: BrandingPolicy = detectBrandingPolicy(tenderText);

  // Defensive: tests use lightweight fake Prisma clients that may
  // omit appSettings. Synchronous undefined access would throw
  // before .catch() runs, so we guard with optional chaining.
  // Production Prisma always exposes appSettings; defaulting to
  // null here means "no firm preference" → assets default to
  // allowed (matching pre-PR behaviour).
  const appSettingsRow = await (async () => {
    try {
      const result = await client.appSettings?.findFirst?.({
        where: { companyId: company.id },
        select: { allowBrandingDefault: true, allowSignatureDefault: true, allowStampDefault: true },
      });
      return result ?? null;
    } catch {
      return null;
    }
  })();
  const exportAssetStatus = resolveExportAssetStatus(brandingPolicy, {
    allowBrandingDefault: appSettingsRow?.allowBrandingDefault ?? true,
    allowSignatureDefault: appSettingsRow?.allowSignatureDefault ?? true,
    allowStampDefault: appSettingsRow?.allowStampDefault ?? true,
  });

  // Emit warnings (not blockers) for export-policy issues. They're
  // warnings because:
  //   - PDF-required is only a problem at EXPORT time; the user can
  //     still generate DOCX and decide later (the download route's
  //     422 PDF_REQUIRED_CONVERSION_UNAVAILABLE is the hard gate).
  //   - Branding conflict: the user might still toggle AppSettings
  //     OFF or re-generate without the asset; the download route's
  //     409 BRANDING_POLICY_CONFLICT is the hard gate.
  if (formatPolicy.requiresPdf) {
    // Truthful warning: once every required PDF filename has an active
    // GENERATED document with real bytes, the warning must clear — otherwise
    // operators keep seeing "final export will block" after they have already
    // finalized or uploaded the PDF. Defensive genDocModel access mirrors the
    // derived-draft counts above so lightweight test mocks stay supported
    // (a mock without generatedDocument keeps the warning, fail-closed).
    const requiredPdfNames = formatPolicy.perFile.filter((p) => p.format === "pdf").map((p) => p.exactFileName);
    const pdfDocModel = (client as unknown as Record<string, unknown>).generatedDocument as
      | undefined
      | { findMany: (q: unknown) => Promise<Array<{ exactFileName: string | null }>> };
    const activePdfRows = pdfDocModel?.findMany
      ? await pdfDocModel
          .findMany({
            where: {
              tenderId,
              generationStatus: "GENERATED",
              OR: [{ fileContent: { not: null } }, { storagePath: { not: null } }],
            },
            select: { exactFileName: true },
          })
          .catch(() => [] as Array<{ exactFileName: string | null }>)
      : [];
    const coveredPdfNames = new Set(
      (activePdfRows ?? []).map((row) => (row.exactFileName ?? "").trim().toLowerCase()).filter(Boolean),
    );
    const missingPdfNames = requiredPdfNames.filter((name) => !coveredPdfNames.has(name.trim().toLowerCase()));
    if (missingPdfNames.length > 0) {
      // Offering "Finalize PDF" only makes sense when there is something to
      // finalize FROM. app/api/tenders/[id]/finalize-pdf/route.ts converts a
      // GENERATED .docx whose base name matches the required PDF; with no such
      // source it answers PDF_REQUIRED_CONVERSION_UNAVAILABLE. Previously this
      // warning always carried nextAction FINALIZE_REQUIRED_PDF, so the panel
      // rendered an enabled Finalize button whose only possible outcome was
      // that rejection — click, error, nothing changes, click again. Decide
      // here, where the source documents are already in hand, and name the
      // real prerequisite when it is missing.
      const docxSourceModel = (client as unknown as Record<string, unknown>).generatedDocument as
        | undefined
        | { findMany: (q: unknown) => Promise<Array<{ exactFileName: string | null; name?: string | null }>> };
      const docxRows = docxSourceModel?.findMany
        ? await docxSourceModel
            .findMany({ where: { tenderId, generationStatus: "GENERATED" }, select: { exactFileName: true, name: true } })
            .catch(() => [] as Array<{ exactFileName: string | null; name?: string | null }>)
        : [];
      const docxBaseNames = new Set(
        (docxRows ?? [])
          .map((row) => (row.exactFileName ?? row.name ?? "").trim())
          .filter((value) => value.toLowerCase().endsWith(".docx"))
          .map((value) => normalizeFileBaseName(value)),
      );
      const finalizable = missingPdfNames.filter((name) => docxBaseNames.has(normalizeFileBaseName(name)));
      const notFinalizable = missingPdfNames.filter((name) => !docxBaseNames.has(normalizeFileBaseName(name)));

      if (finalizable.length > 0) {
        warnings.push({
          code: "TENDER_REQUIRES_PDF",
          message: `Tender submission plan requires PDF output (${finalizable.join(", ")}). A matching approved source document exists, so the required PDF can be finalized now; final export blocks with PDF_REQUIRED_CONVERSION_UNAVAILABLE until it is.`,
          nextAction: "FINALIZE_REQUIRED_PDF",
        });
      }
      if (notFinalizable.length > 0) {
        warnings.push({
          code: "TENDER_REQUIRES_PDF_SOURCE_MISSING",
          message: `Tender submission plan requires PDF output (${notFinalizable.join(", ")}), and no generated source document matches ${notFinalizable.length === 1 ? "it" : "them"}. Finalizing is not possible yet: generate the matching document first, or upload the tender-issued PDF.`,
          nextAction: "OPEN_TENDER_DETAIL",
        });
      }
    }
  }
  if (!exportAssetStatus.brandingAllowed && exportAssetStatus.brandingApplied === false && (appSettingsRow?.allowBrandingDefault ?? true)) {
    // Tender prohibits branding AND firm setting would apply it (the
    // resolve function already reconciled, so brandingApplied=false
    // means the conflict is real). Surface as a warning.
    warnings.push({
      code: "TENDER_PROHIBITS_BRANDING",
      message: `Tender prohibits branding/letterhead but the firm's AppSettings default is ON. Final export will block with BRANDING_POLICY_CONFLICT. Toggle Branding OFF in Settings, OR remove branding from generated documents.`,
      nextAction: "OPEN_SETTINGS",
    });
  }
  if (!exportAssetStatus.signatureAllowed && (appSettingsRow?.allowSignatureDefault ?? true)) {
    warnings.push({
      code: "TENDER_PROHIBITS_SIGNATURE",
      message: `Tender prohibits signatures (likely "unsigned submission required" or "anonymous submission"). Final export will block with BRANDING_POLICY_CONFLICT. Toggle Signature OFF in Settings.`,
      nextAction: "OPEN_SETTINGS",
    });
  }
  if (!exportAssetStatus.stampAllowed && (appSettingsRow?.allowStampDefault ?? true)) {
    warnings.push({
      code: "TENDER_PROHIBITS_STAMP",
      message: `Tender prohibits stamps/seals. Final export will block with BRANDING_POLICY_CONFLICT. Toggle Stamp OFF in Settings.`,
      nextAction: "OPEN_SETTINGS",
    });
  }

  // ── Evaluation scoring weights validation ───────────────────────────────
  // When evaluation criteria have been extracted with weights, verify they
  // sum to approximately 100%. A sum far outside 80-120 usually means some
  // criteria were missed or weights are in different units (points vs %).
  // We only warn — the user may need to run AI Analyze again to get complete
  // criteria, or the tender may express weights in a non-standard format.
  const evalWeights = parseEvalWeights(tender.evaluationCriteriaSourceJson);
  if (evalWeights && evalWeights.covered > 0) {
    if (evalWeights.sum < 80 || evalWeights.sum > 120) {
      warnings.push({
        code: "EVAL_WEIGHTS_INCOMPLETE",
        message: `Evaluation scoring weights extracted from the tender sum to ${Math.round(evalWeights.sum)}% (${evalWeights.covered} of ${evalWeights.total} criteria have weights). The proposal may not be correctly weighted — re-run AI Analyze to extract missing criteria weights before generating the technical proposal.`,
        nextAction: "RETRY_AI_ANALYZE",
      });
    }
  } else if (tender.evaluationMethodology && !(evalWeights && evalWeights.total > 0)) {
    warnings.push({
      code: "EVAL_WEIGHTS_MISSING",
      message: "Evaluation methodology was extracted but individual scoring weights were not captured. Re-run AI Analyze to extract per-criterion weights so the technical proposal can be correctly weighted against each evaluation dimension.",
      nextAction: "RETRY_AI_ANALYZE",
    });
  }

  // ── Compliance matrix coverage at generation time ────────────────────────
  // The export gate already hard-blocks when compliance coverage is <50%,
  // but by that point the user has already generated documents. Surface the
  // warning here (generation readiness) so the team knows to run Engine
  // before generating — not after.
  const mandatoryReqIds = tender.requirements.filter((r) => String(r.priority ?? "").toUpperCase() === "MANDATORY").map((r) => r.id);
  if (mandatoryReqIds.length > 0) {
    const cmModel = (client as unknown as Record<string, unknown>).complianceMatrix as undefined | { count: (q: unknown) => Promise<number> };
    const complianceCount = cmModel
      ? await cmModel.count({ where: { tenderId, requirementId: { in: mandatoryReqIds } } }).catch(() => -1)
      : -1;
    if (complianceCount === 0) {
      warnings.push({
        code: "MANDATORY_EVIDENCE_NOT_ASSESSED",
        message: `${mandatoryReqIds.length} mandatory requirement(s) have no compliance matrix rows — evidence has not been linked. Run Engine to assess evidence coverage before generating documents.`,
        nextAction: "RUN_ENGINE",
      });
    }
  }

  const supportPackageReady = blockers.length === 0;
  const fullProposalReady = fullProposalBlockers.length === 0;

  // Numeric readiness score: start at 100 and deduct for each failed gate.
  // Each unique blocker (support + full-proposal, deduplicated by message)
  // deducts 20 points. Each warning deducts 5 points. Floor at 0.
  const allBlockerMessages = new Set([
    ...blockers.map((b) => b.code),
    ...fullProposalBlockers.map((b) => b.code),
  ]);
  const rawScore = Math.max(
    0,
    100 - allBlockerMessages.size * 20 - warnings.length * 5,
  );
  const score = Math.round(Math.min(100, rawScore));

  return {
    score,
    ready: supportPackageReady,
    supportPackageReady,
    fullProposalReady,
    fullProposalBlockers,
    tenderId,
    blockers,
    metadataReport,
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
    },
    companyReadiness,
    analysisQuality,
    matchingQuality,
    formatPolicy,
    exportAssetStatus,
    generatedAt: new Date().toISOString(),
  };
}

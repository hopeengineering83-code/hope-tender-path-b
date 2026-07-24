// lib/engine/runtime-readiness-facts.ts
//
// Unified runtime-readiness facts authority.
//
// This module is the SINGLE authority for what the app considers "ready"
// at runtime. It wraps:
//   - getEffectiveTenderFacts() (ledger → parser → scalar fallback)
//   - TenderFactsLedger snapshot
//   - parseTenderDocumentIntelligence() from full extracted text
//   - active TenderFile extractedText
//   - tender.description / intakeSummary / analysisSummary
//   - manual overrides
//   - build plan state
//   - analysis state (content hash, stale jobs)
//   - final package readiness model
//
// Authority precedence (highest first):
//   1. SOURCE_GROUNDED_CONFIRMED ledger fact
//   2. USER_CONFIRMED / USER_EDITED ledger fact with audit basis
//   3. NOT_APPLICABLE ledger fact
//   4. parser fact from active TenderFile extractedText with source quote
//   5. parser fact from description / intakeSummary / analysisSummary
//   6. clean scalar fallback
//   7. missing
//
// Non-negotiable rule:
//   If a fact is visible in Tender Detail, no other panel may say the
//   same fact is missing, invalid, or blocking.
//
// Metadata never hard-blocks:
//   dashboard load, analysis quality, draft generation, support package
//   generation, document generation, evidence matching, build plan creation,
//   recovery command center loading, executive snapshot loading, bid control
//   panel loading.
//
// Final export may block only for real final-package defects after effective
// facts are checked.

import type { PrismaClient } from "@prisma/client";
import { logger } from "../observability";
import { getEffectiveTenderFacts, type EffectiveTenderFactsResult } from "./effective-tender-facts";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "./tender-analysis-content";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RuntimeFactSource =
  | "ledger"
  | "active_tender_file"
  | "description"
  | "intake_summary"
  | "analysis_summary"
  | "manual_override"
  | "scalar_fallback"
  | "not_applicable"
  | "none";

export type RuntimeFactEvidenceStatus =
  | "active_file_quote"
  | "fallback_text_quote"
  | "user_confirmed"
  | "not_required"
  | "missing";

export type RuntimeFactFinalStatus =
  | "satisfied"
  | "review_required"
  | "missing"
  | "not_required";

export type RuntimeFact = {
  key: string;
  value: string | string[] | boolean | null;
  resolved: boolean;
  source: RuntimeFactSource;
  sourceEvidenceStatus: RuntimeFactEvidenceStatus;
  finalStatus: RuntimeFactFinalStatus;
  draftBlocker: false; // Metadata NEVER blocks draft
  finalBlocker: boolean;
  reason: string | null;
};

export type RuntimeContradiction = {
  field: string;
  displayedValue: string | null;
  blockingPanel: string;
  blockerText: string;
  fixRequired: string;
};

export type RuntimeReadinessFacts = {
  tenderId: string;
  metadata: {
    deadline: RuntimeFact;
    submissionMethod: RuntimeFact;
    submissionEmails: RuntimeFact;
    emailSubject: RuntimeFact;
    submissionAddress: RuntimeFact;
    clientName: RuntimeFact;
    projectTitle: RuntimeFact;
    referenceNumber: RuntimeFact;
    country: RuntimeFact;
    financialProposalRequired: RuntimeFact;
  };
  analysis: {
    currentSourceHash: string | null;
    latestGoodAnalysisHash: string | null;
    hasGoodAnalysisForCurrentSource: boolean;
    hasOnlyStalePartialJobs: boolean;
    stalePartialJobs: string[];
    contentChangedHardBlock: boolean;
    contentChangedWarningOnly: boolean;
  };
  buildPlan: {
    buildPlanExists: boolean;
    derivedPlanExists: boolean;
    canCreateBuildPlanFromDerivedPlan: boolean;
    exportReadyAllowed: boolean;
  };
  finalPackage: {
    /** True when the final-submission-readiness module loaded successfully.
     *  Does NOT mean export is ready — the caller MUST call
     *  getFinalSubmissionReadiness() for the actual readiness verdict. */
    modelAvailable: boolean;
    /** Always false here — the actual export-ready verdict requires calling
     *  getFinalSubmissionReadiness() with full tender data. Kept in the shape
     *  for backwards compatibility but consumers should NOT trust this field. */
    exportReady: boolean;
    /** Always empty here — actual blockers come from
     *  getFinalSubmissionReadiness(). Kept for backwards compatibility. */
    blockers: string[];
  };
  contradictions: RuntimeContradiction[];
};

// ─── Main resolver ───────────────────────────────────────────────────────────

/**
 * Get the unified runtime-readiness facts for a tender.
 * This is the SINGLE authority consumed by all panels and gates.
 */
export async function getRuntimeReadinessFacts(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<RuntimeReadinessFacts> {
  // Get effective tender facts (ledger → parser → scalar)
  const effective = await getEffectiveTenderFacts(prisma, tenderId, userId).catch(() => null);

  // Load tender for analysis/build-plan state. The select MUST mirror the
  // field set used by generation-readiness-gate.ts so the canonical content
  // hash computed here matches the gate's hash. Previously this select omitted
  // title/description/intakeSummary and per-file originalFileName/classification/
  // createdAt, which made buildTenderAnalysisContent resolve them to undefined
  // and produce a structurally different hash — hasGoodAnalysisForCurrentSource
  // was always false and every consuming panel saw stale-analysis state.
  const tender = await (prisma as any).tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true,
      title: true,
      description: true,
      intakeSummary: true,
      analysisExtractionStatus: true,
      analysisInputHash: true,
      status: true,
      files: {
        where: { deletionStatus: "ACTIVE" },
        select: { id: true, originalFileName: true, classification: true, createdAt: true, extractedText: true, contentHash: true, deletionStatus: true },
      },
    },
  });

  // Company vault digest participates in the canonical content hash. It MUST be
  // included (UNBOUNDED, unordered) so currentSourceHash below reproduces the
  // stored analysisInputHash — the route/createAnalysisJob and the snapshot/gate
  // all fold the full vault set into the hash. Omitting it made
  // hasGoodAnalysisForCurrentSource always false for any tender with vault docs.
  const companyForHash = await (prisma as any).company.findUnique({
    where: { userId },
    select: { documents: { select: { originalFileName: true, category: true, extractedText: true } } },
  }).catch(() => null);

  // Build metadata facts from effective facts
  const metadata = buildMetadataFacts(effective);

  // Build analysis state
  const analysis = await buildAnalysisState(prisma, tenderId, tender, companyForHash);

  // Build build-plan state
  const buildPlan = await buildBuildPlanState(prisma, tenderId, userId);

  // Build final package state
  const finalPackage = await buildFinalPackageState(prisma, tenderId);

  // Detect contradictions
  const contradictions = detectContradictions(metadata, analysis, buildPlan, effective);

  return {
    tenderId,
    metadata,
    analysis,
    buildPlan,
    finalPackage,
    contradictions,
  };
}

// ─── Metadata fact builder ───────────────────────────────────────────────────

function buildMetadataFacts(effective: EffectiveTenderFactsResult | null): RuntimeReadinessFacts["metadata"] {
  const makeFact = (
    key: string,
    value: string | string[] | boolean | null,
    resolved: boolean,
    source: RuntimeFactSource,
    evidenceStatus: RuntimeFactEvidenceStatus,
    finalStatus: RuntimeFactFinalStatus,
    finalBlocker: boolean,
    reason: string | null = null,
  ): RuntimeFact => ({
    key, value, resolved, source, sourceEvidenceStatus: evidenceStatus,
    finalStatus, draftBlocker: false, finalBlocker, reason,
  });

  if (!effective) {
    // All facts missing
    const missingFact = (key: string): RuntimeFact =>
      makeFact(key, null, false, "none", "missing", "missing", false, "No effective facts available");
    return {
      deadline: missingFact("deadline"),
      submissionMethod: missingFact("submissionMethod"),
      submissionEmails: missingFact("submissionEmails"),
      emailSubject: missingFact("emailSubject"),
      submissionAddress: missingFact("submissionAddress"),
      clientName: missingFact("clientName"),
      projectTitle: missingFact("projectTitle"),
      referenceNumber: missingFact("referenceNumber"),
      country: missingFact("country"),
      financialProposalRequired: makeFact("financialProposalRequired", true, false, "none", "missing", "missing", false),
    };
  }

  // Map effective facts to runtime facts
  const factMap = new Map(effective.facts.map((f) => [f.key, f]));

  const resolveFact = (
    key: string,
    value: string | string[] | boolean | null,
    resolved: boolean,
  ): RuntimeFact => {
    const ef = factMap.get(key);
    const source: RuntimeFactSource = ef?.source === "ledger" ? "ledger"
      : ef?.source === "parser" ? "active_tender_file"
      : ef?.source === "scalar" ? "scalar_fallback"
      : ef?.source === "manual" ? "manual_override"
      : "none";

    const evidenceStatus: RuntimeFactEvidenceStatus = ef?.status === "resolved_from_ledger" ? "active_file_quote"
      : ef?.status === "resolved_from_source_text" ? "fallback_text_quote"
      : ef?.status === "resolved_from_manual_override" ? "user_confirmed"
      : ef?.status === "not_applicable" ? "not_required"
      : "missing";

    // Final status: satisfied if resolved, review_required if from parser
    // without active file quote, missing if not resolved
    const finalStatus: RuntimeFactFinalStatus = !resolved ? "missing"
      : source === "ledger" ? "satisfied"
      : source === "active_tender_file" ? "review_required"
      : source === "scalar_fallback" ? "review_required"
      : "satisfied";

    // Final blocker only for truly missing critical fields (not for parser-resolved)
    const isCritical = key === "deadline" || key === "submissionMethod" || key === "clientName" || key === "projectTitle";
    const finalBlocker = !resolved && isCritical;

    return makeFact(key, value, resolved, source, evidenceStatus, finalStatus, finalBlocker,
      !resolved ? `${key} not resolved from any source` : null);
  };

  return {
    deadline: resolveFact("deadline", effective.deadlineDisplay, !!effective.deadlineDisplay),
    submissionMethod: resolveFact("submissionMethod", effective.submissionMethod, effective.submissionMethod !== "Unknown"),
    submissionEmails: resolveFact("submissionEmails", effective.submissionEmails, effective.submissionEmails.length > 0),
    emailSubject: resolveFact("submissionEmailSubject", effective.submissionEmailSubject, !!effective.submissionEmailSubject),
    submissionAddress: resolveFact("submissionAddress", effective.submissionAddress, !!effective.submissionAddress),
    clientName: resolveFact("clientName", effective.clientOrProcuringEntity, !!effective.clientOrProcuringEntity),
    projectTitle: resolveFact("projectTitle", effective.projectTitle, !!effective.projectTitle),
    referenceNumber: resolveFact("reference", effective.referenceNumber, !!effective.referenceNumber),
    country: resolveFact("country", effective.country, !!effective.country),
    financialProposalRequired: makeFact(
      "financialProposalRequired",
      effective.financialProposalRequired,
      true, // Always resolved (default: true)
      effective.facts.find((f) => f.key === "financialProposalRequired")?.source === "parser" ? "active_tender_file" : "scalar_fallback",
      "fallback_text_quote",
      "satisfied",
      false, // Never a blocker
    ),
  };
}

// ─── Analysis state builder ──────────────────────────────────────────────────

async function buildAnalysisState(
  prisma: PrismaClient,
  tenderId: string,
  tender: any,
  companyForHash: { documents?: Array<{ originalFileName: string; category: string; extractedText: string | null }> } | null,
): Promise<RuntimeReadinessFacts["analysis"]> {
  // BUG FIX: Previously currentSourceHash used a completely different algorithm
  // (|`-joined contentHash || extractedText.length per file) that could NEVER
  // match the canonical analysisInputHash (16-char sha256 hex). This caused
  // hasGoodAnalysisForCurrentSource to always be false and contentChangedWarningOnly
  // to always be true, even for fresh analyses. Now we use the canonical
  // computeAnalysisContentHash(buildTenderAnalysisContent(...)) — the SAME
  // function used by generation-readiness-gate.ts and the ai-analyze route.
  let currentSourceHash: string | null = null;
  if (tender?.files?.length) {
    try {
      const analysisContent = buildTenderAnalysisContent({
        title: tender.title ?? "",
        description: tender.description ?? null,
        intakeSummary: tender.intakeSummary ?? null,
        files: tender.files
          .filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
          .map((f: any) => ({
            id: f.id,
            originalFileName: f.originalFileName ?? f.fileName ?? "",
            extractedText: f.extractedText ?? null,
            // classification is part of the canonical hash input —
            // buildTenderAnalysisContent uses it as a fallback when
            // extractedText is falsy. Omitting it here made the runtime-facts
            // hash diverge from the gate's hash for files with empty text.
            classification: f.classification ?? null,
            createdAt: f.createdAt,
          })),
      }, companyForHash ?? undefined);
      currentSourceHash = computeAnalysisContentHash(analysisContent);
    } catch {
      // If hash computation fails, fall back to null (same as no files)
      currentSourceHash = null;
    }
  }

  // Check for latest good analysis
  const latestJob = await (prisma as any).aiJob.findFirst({
    where: { tenderId, jobType: "AI_ANALYZE", status: "SUCCEEDED" },
    orderBy: { finishedAt: "desc" },
    select: { id: true, output: true, analysisInputHash: true, finishedAt: true },
  }).catch(() => null);

  const latestGoodAnalysisHash = latestJob?.analysisInputHash ?? null;
  const hasGoodAnalysisForCurrentSource = !!(latestJob && currentSourceHash && latestJob.analysisInputHash === currentSourceHash);

  // Check for stale partial jobs
  const partialJobs = await (prisma as any).aiJob.findMany({
    where: { tenderId, jobType: "AI_ANALYZE", status: "RUNNING" },
    select: { id: true, startedAt: true },
    orderBy: { startedAt: "desc" },
    take: 10,
  }).catch(() => []);

  const staleThreshold = new Date(Date.now() - 30 * 60 * 1000); // 30 min
  const stalePartialJobs = (partialJobs || [])
    .filter((j: any) => j.startedAt && j.startedAt < staleThreshold)
    .map((j: any) => j.id);

  const hasOnlyStalePartialJobs = stalePartialJobs.length > 0 && !hasGoodAnalysisForCurrentSource;

  // ── Supersede stale partial AI jobs when a newer good analysis exists ──
  // The spec requires: "Supersede stale partial AiAnalyzeJob/AiAnalyzeChunk
  // records when a newer FULL_EXTRACTION_AI_ANALYZED or GOOD analysis exists
  // for current source."
  //
  // This is a REAL runtime mutation — not just detection. When a good
  // analysis exists for the current source, stale RUNNING jobs are marked
  // SUPERSEDED so they no longer block generation or appear as "partial
  // analysis awaiting completion" in the UI.
  if (hasGoodAnalysisForCurrentSource && stalePartialJobs.length > 0) {
    try {
      await (prisma as any).aiJob.updateMany({
        where: { id: { in: stalePartialJobs }, status: "RUNNING" },
        data: {
          status: "SUPERSEDED",
          errorMessage: "Superseded by newer good analysis for current source",
          finishedAt: new Date(),
        },
      });
      // Also supersede their chunks
      await (prisma as any).aiAnalyzeChunk.updateMany({
        where: { jobId: { in: stalePartialJobs }, status: { in: ["RUNNING", "QUEUED"] } },
        data: {
          status: "SKIPPED",
          errorMessage: "Superseded by newer good analysis",
          finishedAt: new Date(),
        },
      });
    } catch {
      // Best-effort — if the update fails, the stale jobs remain RUNNING
      // but the runtime facts still report them as stale.
    }
  }

  // Content changed: hard-block only when source hash changed AND no completed
  // analysis exists for current source AND deterministic parser cannot provide
  // required context. Otherwise it's a warning.
  const hashMismatch = !!(currentSourceHash && latestGoodAnalysisHash && currentSourceHash !== latestGoodAnalysisHash);
  // contentChangedHardBlock: content changed since the last good analysis
  // AND no good analysis exists for the CURRENT source hash. The previous
  // expression included `&& !latestJob` which is structurally impossible
  // when hashMismatch is true (hashMismatch requires latestGoodAnalysisHash
  // to be truthy, which requires latestJob to exist). The `!latestJob`
  // conjunct made contentChangedHardBlock always false — the bid-control
  // panel could never hard-block on a content change.
  const contentChangedHardBlock = hashMismatch && !hasGoodAnalysisForCurrentSource;
  const contentChangedWarningOnly = hashMismatch && hasGoodAnalysisForCurrentSource;

  return {
    currentSourceHash,
    latestGoodAnalysisHash,
    hasGoodAnalysisForCurrentSource,
    hasOnlyStalePartialJobs,
    stalePartialJobs,
    contentChangedHardBlock,
    contentChangedWarningOnly,
  };
}

// ─── Build plan state builder ────────────────────────────────────────────────

async function buildBuildPlanState(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<RuntimeReadinessFacts["buildPlan"]> {
  let buildPlanExists = false;
  let derivedPlanExists = false;

  try {
    const { getCurrentConfirmedBuildPlan } = await import("./build-plan");
    const confirmed = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId);
    buildPlanExists = confirmed.ok && confirmed.items.length > 0;

    // Check for derived plan (submission plan from requirements)
    const { buildSubmissionPlan } = await import("./submission-plan");
    const tender = await (prisma as any).tender.findFirst({
      where: { id: tenderId },
      select: { id: true, title: true, exactFileNaming: true, exactFileOrder: true, pageLimit: true, requirements: { select: { id: true, title: true, description: true, requirementType: true, priority: true } } },
    });
    if (tender) {
      const plan = buildSubmissionPlan(tender as any);
      derivedPlanExists = plan.files.length > 0;
    }
  } catch (e) {
    // Safe fallback — previously bare `catch {}` with just a "Safe fallback"
    // comment. Surface the failure so readiness-fact degradation is observable
    // (e.g. a derived-plan computation failure could silently let "export
    // ready" pass when it shouldn't).
    //
    // Note: `tender` is declared with `const tender = ...` inside the try block
    // above, so it is out of scope here. Use the in-scope `tenderId` parameter.
    logger.warn("[runtime-readiness-facts] derived plan computation failed — using safe fallback", {
      detail: e,
      tenderId,
    });
  }

  return {
    buildPlanExists,
    derivedPlanExists,
    canCreateBuildPlanFromDerivedPlan: !buildPlanExists && derivedPlanExists,
    exportReadyAllowed: buildPlanExists, // Cannot say "export ready" if no build plan
  };
}

// ─── Final package state builder ─────────────────────────────────────────────

async function buildFinalPackageState(
  prisma: PrismaClient,
  tenderId: string,
): Promise<RuntimeReadinessFacts["finalPackage"]> {
  // Check if final package readiness model is available
  let modelAvailable = false;
  let exportReady = false;
  const blockers: string[] = [];

  try {
    const { getFinalSubmissionReadiness } = await import("./final-submission-readiness");
    // Note: we don't call getFinalSubmissionReadiness here because it's
    // expensive and requires full tender data. The caller should use
    // runtime facts to decide whether to call it.
    modelAvailable = true;
  } catch {
    modelAvailable = false;
  }

  return { modelAvailable, exportReady, blockers };
}

// ─── Contradiction detection ─────────────────────────────────────────────────

function detectContradictions(
  metadata: RuntimeReadinessFacts["metadata"],
  analysis: RuntimeReadinessFacts["analysis"],
  buildPlan: RuntimeReadinessFacts["buildPlan"],
  effective: EffectiveTenderFactsResult | null,
): RuntimeContradiction[] {
  const contradictions: RuntimeContradiction[] = [];

  // Deadline contradiction: displayed but blocking
  if (metadata.deadline.resolved && metadata.deadline.finalBlocker) {
    contradictions.push({
      field: "deadline",
      displayedValue: metadata.deadline.value as string,
      blockingPanel: "Tender Details / Canonical Readiness",
      blockerText: "deadline missing",
      fixRequired: "Use effective deadline from parser/ledger — do not check scalar null",
    });
  }

  // Submission emails contradiction: displayed but blocking
  if (metadata.submissionEmails.resolved && metadata.submissionEmails.finalBlocker) {
    contradictions.push({
      field: "submissionEmails",
      displayedValue: Array.isArray(metadata.submissionEmails.value) ? (metadata.submissionEmails.value as string[]).join(", ") : String(metadata.submissionEmails.value),
      blockingPanel: "Tender Details",
      blockerText: "submissionEmails has no active TenderFile source evidence",
      fixRequired: "Use review_required, not hard-block, when emails are resolved from parser",
    });
  }

  // Build plan contradiction: export ready but no build plan
  if (!buildPlan.buildPlanExists && buildPlan.exportReadyAllowed) {
    contradictions.push({
      field: "buildPlan",
      displayedValue: null,
      blockingPanel: "Executive Snapshot / Final Submission",
      blockerText: "Export ready shown but no Build Plan exists",
      fixRequired: "Do not show Export Ready when Build Plan is missing",
    });
  }

  // Content changed contradiction: analysis good but content-changed blocks
  if (analysis.hasGoodAnalysisForCurrentSource && analysis.contentChangedHardBlock) {
    contradictions.push({
      field: "analysis",
      displayedValue: "Analysis Quality: GOOD",
      blockingPanel: "Generate Documents / Export ZIP",
      blockerText: "content changed since last analysis",
      fixRequired: "Content-changed is advisory when good analysis exists for current source",
    });
  }

  return contradictions;
}

// ─── Safe error helper ───────────────────────────────────────────────────────

/**
 * Create a safe error response for UI panels.
 * Never exposes raw Prisma error text, stack traces, or internal details.
 * Returns a user-safe message with a diagnostic ID for server logs.
 */
export function safePanelError(panelName: string, error: unknown): {
  message: string;
  diagnosticId: string;
} {
  const diagnosticId = `panel_${panelName}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    message: "Readiness check failed. Retry or contact admin.",
    diagnosticId,
  };
}

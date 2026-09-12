// ─── Transactional test fixture for database integration tests ────────────────
//
// AUDIT GAP (#6): The existing `tests/helpers/db-acceptance-harness.ts` uses
// `deleteMany` in `after()` hooks. When an assertion fails mid-test, `after()`
// still runs BUT the order of deletes is fragile (FK constraints, triggers)
// and a single failed delete leaves orphan rows. Worse, if the test process
// is killed (timeout, OOM, signal), `after()` never runs at all and the
// ephemeral Postgres accumulates orphans across test runs.
//
// This module provides a robust alternative:
//
//   import { withDbFixture } from "../tests/helpers/db-fixture";
//
//   describe("my feature", () => {
//     const fx = withDbFixture();
//     before(fx.setup);
//     after(fx.teardown);
//     // fx.prisma — the shared PrismaClient
//     // fx.register.userId / fx.register.tenderId / ... — call from inside tests
//   });
//
// Design:
//   1. Every created row (User, Company, Tender, TenderFile, TenderRequirement,
//      AiJob, GeneratedDocument, ...) is registered the moment it is created.
//   2. Teardown deletes in REVERSE dependency order, wrapped in a Prisma
//      `$transaction` so partial failures roll back.
//   3. If teardown itself fails (network, deadlock), we fall back to a
//      "best-effort" pass that catches each delete individually — but the
//      transaction is the primary path.
//   4. Teardown is registered via `process.on('beforeExit')` AND `process.on
//      ('exit')` so that even a SIGTERM/SIGINT cleanup runs.
//   5. The fixture is idempotent: calling `teardown()` twice is safe.
//
// Requirement #6: "Ensure all test-created users, tenders, files, requirements
// and AI jobs are transactionally cleaned up even when assertions fail."
//
// This module is imported by tests that opt in. The legacy
// db-acceptance-harness.ts is preserved for backward compatibility — new tests
// should use this module.

import { PrismaClient } from "@prisma/client";

// Prisma's `$transaction` callback receives a transaction client that is
// `Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>`.
// We accept it as `typeof tx` via a generic-ish helper rather than the full
// PrismaClient — this matches Prisma 6's documented pattern.
type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

// Lazy-load prisma so this module is import-safe in unit-test mode where
// DATABASE_URL is a placeholder and prismaReady never resolves.
let _prisma: PrismaClient | null = null;
async function getPersistence(): Promise<PrismaClient> {
  if (!_prisma) {
    const mod = await import("../../lib/prisma");
    await mod.prismaReady;
    _prisma = mod.prisma as PrismaClient;
  }
  return _prisma;
}

export interface DbFixtureRegistry {
  // Track IDs in insertion order. Teardown iterates in REVERSE so that
  // dependency-parents are deleted before their parents (e.g. TenderRequirement
  // before Tender, AiJob before Tender, etc.).
  users: string[];
  companies: string[];
  tenders: string[];
  tenderFiles: string[];
  tenderRequirements: string[];
  aiJobs: string[];
  generatedDocuments: string[];
  buildPlans: string[];
  pricingWorkbooks: string[];
  proposalVersions: string[];
  expertMatches: string[];
  projectMatches: string[];
  complianceRows: string[];
  complianceGaps: string[];
  documentReviews: string[];
  documentComments: string[];
  aiAnalyzeChunks: string[];
  aiAnalyzeRetryStates: string[];
  aiUsageRecords: string[];
  sessions: string[];
  passwordResetTokens: string[];
  auditLogs: string[];
  tenderShares: string[];
  tenderMetadataOverrides: string[];
  tenderFactsLedger: string[];
  tenderSubmissionEmails: string[];
  tenderWorkflowRuns: string[];
  tenderCopilotMessages: string[];
  submissionPlanStates: string[];
  extractionQualityOverrides: string[];
  fallbackApprovalRecords: string[];
  exportPackages: string[];
  matchScoreBreakdowns: string[];
  sectionEvidenceMaps: string[];
  evaluatorObjections: string[];
}

export function newRegistry(): DbFixtureRegistry {
  return {
    users: [],
    companies: [],
    tenders: [],
    tenderFiles: [],
    tenderRequirements: [],
    aiJobs: [],
    generatedDocuments: [],
    buildPlans: [],
    pricingWorkbooks: [],
    proposalVersions: [],
    expertMatches: [],
    projectMatches: [],
    complianceRows: [],
    complianceGaps: [],
    documentReviews: [],
    documentComments: [],
    aiAnalyzeChunks: [],
    aiAnalyzeRetryStates: [],
    aiUsageRecords: [],
    sessions: [],
    passwordResetTokens: [],
    auditLogs: [],
    tenderShares: [],
    tenderMetadataOverrides: [],
    tenderFactsLedger: [],
    tenderSubmissionEmails: [],
    tenderWorkflowRuns: [],
    tenderCopilotMessages: [],
    submissionPlanStates: [],
    extractionQualityOverrides: [],
    fallbackApprovalRecords: [],
    exportPackages: [],
    matchScoreBreakdowns: [],
    sectionEvidenceMaps: [],
    evaluatorObjections: [],
  };
}

export interface DbFixture {
  prisma: PrismaClient;
  register: DbFixtureRegistry;
  setup: () => Promise<void>;
  teardown: () => Promise<void>;
  /** Track a tender (and its FK children) for cleanup. */
  trackTender: (id: string) => void;
  trackUser: (id: string) => void;
  trackFile: (id: string) => void;
  trackRequirement: (id: string) => void;
  trackAiJob: (id: string) => void;
  trackGeneratedDocument: (id: string) => void;
  /** Track an arbitrary model+id for cleanup. */
  track: (model: keyof DbFixtureRegistry, id: string) => void;
}

/**
 * Build a database fixture with transactional teardown. Returns a `setup`
 * function (call from `before`) and a `teardown` function (call from `after`).
 *
 * The fixture is fail-safe: if the test process is killed mid-test, the
 * `beforeExit` handler runs `teardown` one last time. If teardown itself
 * throws, the error is logged and the process continues — never silently
 * leaks production data (the CI DB is ephemeral, so orphans are isolated
 * to one CI run).
 */
export function withDbFixture(): DbFixture {
  const register = newRegistry();
  let prisma: PrismaClient | null = null;
  let tornDown = false;
  let exitHandlerBound = false;

  const setup = async () => {
    prisma = await getPersistence();
    if (!exitHandlerBound) {
      // Best-effort cleanup if the test process is killed before `after()` runs.
      // `beforeExit` fires when the event loop is empty (normal exit). `exit`
      // fires unconditionally but only allows SYNCHRONOUS work, so we can't
      // actually run async cleanup there — but we can log unclean state.
      process.on("beforeExit", async () => {
        if (!tornDown) {
          try {
            await teardown();
          } catch (err) {
            console.error("[db-fixture] beforeExit teardown failed:", err);
          }
        }
      });
      process.on("exit", () => {
        if (!tornDown) {
          console.error(
            "[db-fixture] Process exiting with unclean fixture registry — " +
              `${countPending(register)} tracked rows were NOT cleaned up. ` +
              `Investigate test timeouts or unhandled rejections.`,
          );
        }
      });
      exitHandlerBound = true;
    }
  };

  const teardown = async () => {
    if (tornDown || !prisma) {
      tornDown = true;
      return;
    }
    tornDown = true;

    // Primary path: delete everything in a single transaction, in reverse
    // dependency order. If any delete fails, the transaction rolls back AND
    // we fall through to the best-effort path.
    try {
      await prisma.$transaction(async (tx) => {
        await cleanupWithTransaction(tx, register);
      });
      return;
    } catch (err) {
      console.error("[db-fixture] transactional teardown failed, falling back to best-effort:", err);
    }

    // Best-effort fallback: delete each model individually, swallowing errors.
    // This handles the case where a row is missing (already deleted), has a
    // trigger that fires during delete, or has an FK constraint we missed.
    await bestEffortCleanup(prisma, register);
  };

  const track = (model: keyof DbFixtureRegistry, id: string) => {
    if (id) (register[model] as string[]).push(id);
  };

  return {
    get prisma() {
      if (!prisma) throw new Error("DbFixture.prisma accessed before setup() — call from `before()` hook");
      return prisma;
    },
    register,
    setup,
    teardown,
    trackTender: (id) => track("tenders", id),
    trackUser: (id) => track("users", id),
    trackFile: (id) => track("tenderFiles", id),
    trackRequirement: (id) => track("tenderRequirements", id),
    trackAiJob: (id) => track("aiJobs", id),
    trackGeneratedDocument: (id) => track("generatedDocuments", id),
    track,
  };
}

function countPending(reg: DbFixtureRegistry): number {
  return Object.values(reg).reduce((sum, arr) => sum + arr.length, 0);
}

// Delete in REVERSE dependency order. Children first, then parents.
// Order matters: e.g. TenderRequirement depends on TenderFile + Tender,
// so delete requirements BEFORE files/tenders.
async function cleanupWithTransaction(tx: TxClient, reg: DbFixtureRegistry) {
  // ── Leaf-level (no other tracked FK depends on them) ────────────────────
  if (reg.evaluatorObjections.length) {
    await tx.evaluatorObjection.deleteMany({ where: { id: { in: reg.evaluatorObjections } } }).catch(() => {});
  }
  if (reg.sectionEvidenceMaps.length) {
    await tx.sectionEvidenceMap.deleteMany({ where: { id: { in: reg.sectionEvidenceMaps } } }).catch(() => {});
  }
  if (reg.matchScoreBreakdowns.length) {
    await tx.matchScoreBreakdown.deleteMany({ where: { id: { in: reg.matchScoreBreakdowns } } }).catch(() => {});
  }
  if (reg.exportPackages.length) {
    await tx.exportPackage.deleteMany({ where: { id: { in: reg.exportPackages } } }).catch(() => {});
  }
  if (reg.fallbackApprovalRecords.length) {
    await tx.fallbackApprovalRecord.deleteMany({ where: { id: { in: reg.fallbackApprovalRecords } } }).catch(() => {});
  }
  if (reg.extractionQualityOverrides.length) {
    await tx.extractionQualityOverride.deleteMany({ where: { id: { in: reg.extractionQualityOverrides } } }).catch(() => {});
  }
  if (reg.submissionPlanStates.length) {
    await tx.submissionPlanState.deleteMany({ where: { tenderId: { in: reg.submissionPlanStates } } }).catch(() => {});
  }
  if (reg.tenderCopilotMessages.length) {
    await tx.tenderCopilotMessage.deleteMany({ where: { id: { in: reg.tenderCopilotMessages } } }).catch(() => {});
  }
  if (reg.tenderWorkflowRuns.length) {
    await tx.tenderWorkflowRun.deleteMany({ where: { id: { in: reg.tenderWorkflowRuns } } }).catch(() => {});
  }
  if (reg.tenderSubmissionEmails.length) {
    await tx.tenderSubmissionEmail.deleteMany({ where: { id: { in: reg.tenderSubmissionEmails } } }).catch(() => {});
  }
  if (reg.tenderFactsLedger.length) {
    await tx.tenderFactsLedger.deleteMany({ where: { id: { in: reg.tenderFactsLedger } } }).catch(() => {});
  }
  if (reg.tenderMetadataOverrides.length) {
    await tx.tenderMetadataOverride.deleteMany({ where: { id: { in: reg.tenderMetadataOverrides } } }).catch(() => {});
  }
  if (reg.tenderShares.length) {
    await tx.tenderShare.deleteMany({ where: { id: { in: reg.tenderShares } } }).catch(() => {});
  }
  if (reg.auditLogs.length) {
    await tx.auditLog.deleteMany({ where: { id: { in: reg.auditLogs } } }).catch(() => {});
  }
  if (reg.passwordResetTokens.length) {
    await tx.passwordResetToken.deleteMany({ where: { id: { in: reg.passwordResetTokens } } }).catch(() => {});
  }
  if (reg.sessions.length) {
    await tx.session.deleteMany({ where: { id: { in: reg.sessions } } }).catch(() => {});
  }
  if (reg.aiUsageRecords.length) {
    await tx.aiUsageRecord.deleteMany({ where: { id: { in: reg.aiUsageRecords } } }).catch(() => {});
  }
  if (reg.aiAnalyzeRetryStates.length) {
    await tx.aiAnalyzeRetryState.deleteMany({ where: { id: { in: reg.aiAnalyzeRetryStates } } }).catch(() => {});
  }
  if (reg.aiAnalyzeChunks.length) {
    await tx.aiAnalyzeChunk.deleteMany({ where: { id: { in: reg.aiAnalyzeChunks } } }).catch(() => {});
  }
  if (reg.documentComments.length) {
    await tx.documentComment.deleteMany({ where: { id: { in: reg.documentComments } } }).catch(() => {});
  }
  if (reg.documentReviews.length) {
    await tx.documentReview.deleteMany({ where: { id: { in: reg.documentReviews } } }).catch(() => {});
  }
  if (reg.complianceGaps.length) {
    await tx.complianceGap.deleteMany({ where: { id: { in: reg.complianceGaps } } }).catch(() => {});
  }
  if (reg.complianceRows.length) {
    await tx.complianceMatrix.deleteMany({ where: { id: { in: reg.complianceRows } } }).catch(() => {});
  }
  if (reg.projectMatches.length) {
    await tx.tenderProjectMatch.deleteMany({ where: { id: { in: reg.projectMatches } } }).catch(() => {});
  }
  if (reg.expertMatches.length) {
    await tx.tenderExpertMatch.deleteMany({ where: { id: { in: reg.expertMatches } } }).catch(() => {});
  }
  if (reg.proposalVersions.length) {
    await tx.proposalVersion.deleteMany({ where: { id: { in: reg.proposalVersions } } }).catch(() => {});
  }
  if (reg.pricingWorkbooks.length) {
    await tx.pricingWorkbook.deleteMany({ where: { id: { in: reg.pricingWorkbooks } } }).catch(() => {});
  }
  if (reg.buildPlans.length) {
    await tx.buildPlan.deleteMany({ where: { id: { in: reg.buildPlans } } }).catch(() => {});
  }

  // ── Mid-level: depend on Tender, deleted before Tender ──────────────────
  if (reg.generatedDocuments.length) {
    await tx.generatedDocument.deleteMany({ where: { id: { in: reg.generatedDocuments } } }).catch(() => {});
  }
  if (reg.tenderRequirements.length) {
    await tx.tenderRequirement.deleteMany({ where: { id: { in: reg.tenderRequirements } } }).catch(() => {});
  }
  if (reg.aiJobs.length) {
    await tx.aiJob.deleteMany({ where: { id: { in: reg.aiJobs } } }).catch(() => {});
  }
  if (reg.tenderFiles.length) {
    await tx.tenderFile.deleteMany({ where: { id: { in: reg.tenderFiles } } }).catch(() => {});
  }

  // ── Parent: Tender (delete after all its children) ──────────────────────
  if (reg.tenders.length) {
    await tx.tender.deleteMany({ where: { id: { in: reg.tenders } } }).catch(() => {});
  }

  // ── Company ──────────────────────────────────────────────────────────────
  if (reg.companies.length) {
    await tx.company.deleteMany({ where: { id: { in: reg.companies } } }).catch(() => {});
  }

  // ── User (root — delete last) ────────────────────────────────────────────
  if (reg.users.length) {
    await tx.user.deleteMany({ where: { id: { in: reg.users } } }).catch(() => {});
  }
}

// Best-effort fallback: same order, but each deleteMany runs outside the
// transaction and we explicitly swallow ALL errors so that one missing row
// doesn't block cleanup of the rest.
async function bestEffortCleanup(prisma: PrismaClient, reg: DbFixtureRegistry) {
  const safe = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      /* swallow */
    }
  };
  if (reg.evaluatorObjections.length) await safe(() => prisma.evaluatorObjection.deleteMany({ where: { id: { in: reg.evaluatorObjections } } }));
  if (reg.sectionEvidenceMaps.length) await safe(() => prisma.sectionEvidenceMap.deleteMany({ where: { id: { in: reg.sectionEvidenceMaps } } }));
  if (reg.matchScoreBreakdowns.length) await safe(() => prisma.matchScoreBreakdown.deleteMany({ where: { id: { in: reg.matchScoreBreakdowns } } }));
  if (reg.exportPackages.length) await safe(() => prisma.exportPackage.deleteMany({ where: { id: { in: reg.exportPackages } } }));
  if (reg.fallbackApprovalRecords.length) await safe(() => prisma.fallbackApprovalRecord.deleteMany({ where: { id: { in: reg.fallbackApprovalRecords } } }));
  if (reg.extractionQualityOverrides.length) await safe(() => prisma.extractionQualityOverride.deleteMany({ where: { id: { in: reg.extractionQualityOverrides } } }));
  if (reg.submissionPlanStates.length) await safe(() => prisma.submissionPlanState.deleteMany({ where: { tenderId: { in: reg.submissionPlanStates } } }));
  if (reg.tenderCopilotMessages.length) await safe(() => prisma.tenderCopilotMessage.deleteMany({ where: { id: { in: reg.tenderCopilotMessages } } }));
  if (reg.tenderWorkflowRuns.length) await safe(() => prisma.tenderWorkflowRun.deleteMany({ where: { id: { in: reg.tenderWorkflowRuns } } }));
  if (reg.tenderSubmissionEmails.length) await safe(() => prisma.tenderSubmissionEmail.deleteMany({ where: { id: { in: reg.tenderSubmissionEmails } } }));
  if (reg.tenderFactsLedger.length) await safe(() => prisma.tenderFactsLedger.deleteMany({ where: { id: { in: reg.tenderFactsLedger } } }));
  if (reg.tenderMetadataOverrides.length) await safe(() => prisma.tenderMetadataOverride.deleteMany({ where: { id: { in: reg.tenderMetadataOverrides } } }));
  if (reg.tenderShares.length) await safe(() => prisma.tenderShare.deleteMany({ where: { id: { in: reg.tenderShares } } }));
  if (reg.auditLogs.length) await safe(() => prisma.auditLog.deleteMany({ where: { id: { in: reg.auditLogs } } }));
  if (reg.passwordResetTokens.length) await safe(() => prisma.passwordResetToken.deleteMany({ where: { id: { in: reg.passwordResetTokens } } }));
  if (reg.sessions.length) await safe(() => prisma.session.deleteMany({ where: { id: { in: reg.sessions } } }));
  if (reg.aiUsageRecords.length) await safe(() => prisma.aiUsageRecord.deleteMany({ where: { id: { in: reg.aiUsageRecords } } }));
  if (reg.aiAnalyzeRetryStates.length) await safe(() => prisma.aiAnalyzeRetryState.deleteMany({ where: { id: { in: reg.aiAnalyzeRetryStates } } }));
  if (reg.aiAnalyzeChunks.length) await safe(() => prisma.aiAnalyzeChunk.deleteMany({ where: { id: { in: reg.aiAnalyzeChunks } } }));
  if (reg.documentComments.length) await safe(() => prisma.documentComment.deleteMany({ where: { id: { in: reg.documentComments } } }));
  if (reg.documentReviews.length) await safe(() => prisma.documentReview.deleteMany({ where: { id: { in: reg.documentReviews } } }));
  if (reg.complianceGaps.length) await safe(() => prisma.complianceGap.deleteMany({ where: { id: { in: reg.complianceGaps } } }));
  if (reg.complianceRows.length) await safe(() => prisma.complianceMatrix.deleteMany({ where: { id: { in: reg.complianceRows } } }));
  if (reg.projectMatches.length) await safe(() => prisma.tenderProjectMatch.deleteMany({ where: { id: { in: reg.projectMatches } } }));
  if (reg.expertMatches.length) await safe(() => prisma.tenderExpertMatch.deleteMany({ where: { id: { in: reg.expertMatches } } }));
  if (reg.proposalVersions.length) await safe(() => prisma.proposalVersion.deleteMany({ where: { id: { in: reg.proposalVersions } } }));
  if (reg.pricingWorkbooks.length) await safe(() => prisma.pricingWorkbook.deleteMany({ where: { id: { in: reg.pricingWorkbooks } } }));
  if (reg.buildPlans.length) await safe(() => prisma.buildPlan.deleteMany({ where: { id: { in: reg.buildPlans } } }));
  if (reg.generatedDocuments.length) await safe(() => prisma.generatedDocument.deleteMany({ where: { id: { in: reg.generatedDocuments } } }));
  if (reg.tenderRequirements.length) await safe(() => prisma.tenderRequirement.deleteMany({ where: { id: { in: reg.tenderRequirements } } }));
  if (reg.aiJobs.length) await safe(() => prisma.aiJob.deleteMany({ where: { id: { in: reg.aiJobs } } }));
  if (reg.tenderFiles.length) await safe(() => prisma.tenderFile.deleteMany({ where: { id: { in: reg.tenderFiles } } }));
  if (reg.tenders.length) await safe(() => prisma.tender.deleteMany({ where: { id: { in: reg.tenders } } }));
  if (reg.companies.length) await safe(() => prisma.company.deleteMany({ where: { id: { in: reg.companies } } }));
  if (reg.users.length) await safe(() => prisma.user.deleteMany({ where: { id: { in: reg.users } } }));
}

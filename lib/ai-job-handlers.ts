// Canonical AI job-handler registry.
//
// The historical handler set remains in ai-job-handlers-legacy.ts for the
// non-extraction workflows. EXTRACT_TEXT is deliberately owned by the
// revision-bound background extraction service so upload requests never run
// extraction/OCR and a stale or cross-tenant source cannot be processed.

export * from "./ai-job-handlers-legacy";

import { recordStep, type JobType } from "./ai-jobs";
import {
  getHandler as getLegacyHandler,
  type JobHandler,
} from "./ai-job-handlers-legacy";
import { runTenderFileExtractionJob } from "./ai-jobs/tender-extraction-service";
import { prepareCompanyVaultForEngine } from "./engine/prepare-company-vault";
import { buildAndVerifyBuildPlan } from "./engine/automatic-build-plan";
import { reconcileAutomaticRequirementCoverage } from "./engine/automatic-requirement-coverage";
import { prisma } from "./prisma";

export function getHandler(jobType: JobType): JobHandler | null {
  if (jobType === "EXTRACT_TEXT") {
    return runTenderFileExtractionJob as JobHandler;
  }

  const legacyHandler = getLegacyHandler(jobType);
  if (jobType === "ENGINE_RUN" && legacyHandler) {
    return async (ctx) => {
      // Preserve canonical input validation first. A malformed job must fail
      // for its missing tender identifier rather than being masked by a Vault
      // lookup error in test, retry, or operational diagnostics.
      if (!ctx.tenderId) return legacyHandler(ctx);

      // The queue may start well after the HTTP request that created the job.
      // Refresh authority again at execution time so newly repaired records are
      // promoted automatically and records changed after enqueue remain
      // fail-closed rather than using stale verification.
      const preflight = await prepareCompanyVaultForEngine(ctx.userId);
      if (!preflight) throw new Error("Company Vault profile required before Engine execution");

      const result = await legacyHandler(ctx);

      // Requirement source repair and Vault evidence linking are part of the
      // Engine transaction chain. No confirmation panel or second Run Engine
      // action is allowed between canonical matching and persisted coverage.
      await recordStep(ctx.jobId, {
        stepName: "requirement-coverage.automatic",
        message: "Grounding requirements and linking source-verified Company Vault evidence",
        status: "RUNNING",
      });
      const coverageBeforePlan = await reconcileAutomaticRequirementCoverage(
        prisma,
        ctx.tenderId,
        ctx.userId,
      );
      if (!coverageBeforePlan.ok) {
        await recordStep(ctx.jobId, {
          stepName: "requirement-coverage.blocked",
          message: coverageBeforePlan.code ?? "Automatic requirement coverage failed",
          status: "FAILED",
        });
        throw new Error(
          `Automatic requirement coverage blocked (${coverageBeforePlan.code ?? "UNKNOWN"})`,
        );
      }
      if (coverageBeforePlan.remainingUngrounded.length > 0) {
        const titles = coverageBeforePlan.remainingUngrounded
          .slice(0, 4)
          .map((item) => item.title)
          .join("; ");
        await recordStep(ctx.jobId, {
          stepName: "requirement-coverage.source-blocked",
          message: `${coverageBeforePlan.remainingUngrounded.length} mandatory/critical requirement(s) remain without provable active-file source coordinates: ${titles}`,
          status: "FAILED",
        });
        throw new Error(
          `Automatic source grounding incomplete for ${coverageBeforePlan.remainingUngrounded.length} mandatory/critical requirement(s)`,
        );
      }
      await recordStep(ctx.jobId, {
        stepName: "requirement-coverage.linked",
        message: `Automatic requirement coverage persisted ${coverageBeforePlan.desiredLinks} current link(s); ${coverageBeforePlan.remainingWithoutEligibleEvidence.length} true evidence gap(s) remain`,
        status: "SUCCEEDED",
      });

      // Build Plan creation is part of Engine completion, not a later human
      // approval stage. The service re-derives current tender-controlled scope,
      // validates source grounding, binds revision/hash, and commits the same
      // fail-closed CONFIRMED authority consumed by generation/export.
      await recordStep(ctx.jobId, {
        stepName: "build-plan.automatic",
        message: "Deriving and source-verifying the submission Build Plan",
        status: "RUNNING",
      });
      const buildPlan = await buildAndVerifyBuildPlan(prisma, ctx.tenderId, ctx.userId, {
        reuseCurrent: false,
      });
      if (!buildPlan.ok) {
        await recordStep(ctx.jobId, {
          stepName: "build-plan.blocked",
          message: `${buildPlan.code}: ${buildPlan.message}`,
          status: "FAILED",
        });
        throw new Error(
          `Automatic Build Plan verification blocked (${buildPlan.code}): ${[
            buildPlan.message,
            ...(buildPlan.blockers ?? []),
          ].join(" ")}`,
        );
      }
      await recordStep(ctx.jobId, {
        stepName: "build-plan.complete",
        message: `Build Plan revision ${buildPlan.revision} automatically source-verified`,
        status: "SUCCEEDED",
      });

      // BuildPlan writes invalidate old planned-output links at the database
      // layer. Reconcile once more so required output files and methodology
      // sections become PARTIAL planned coverage immediately, then upgrade to
      // FULL automatically when validated generated bytes exist.
      const coverageAfterPlan = await reconcileAutomaticRequirementCoverage(
        prisma,
        ctx.tenderId,
        ctx.userId,
      );
      if (!coverageAfterPlan.ok || coverageAfterPlan.remainingUngrounded.length > 0) {
        await recordStep(ctx.jobId, {
          stepName: "requirement-coverage.post-plan-blocked",
          message: coverageAfterPlan.ok
            ? `${coverageAfterPlan.remainingUngrounded.length} requirement source trace(s) became invalid during Build Plan creation`
            : coverageAfterPlan.code ?? "Post-plan coverage reconciliation failed",
          status: "FAILED",
        });
        throw new Error("Post-plan automatic requirement coverage reconciliation failed");
      }
      await recordStep(ctx.jobId, {
        stepName: "requirement-coverage.complete",
        message: `Requirement coverage synchronized with Build Plan revision ${buildPlan.revision}`,
        status: "SUCCEEDED",
      });

      return {
        ...result,
        automaticRequirementCoverage: {
          groundedRequirements: coverageAfterPlan.groundedRequirements,
          persistedLinks: coverageAfterPlan.desiredLinks,
          trueEvidenceGaps: coverageAfterPlan.remainingWithoutEligibleEvidence.length,
          sourceRepair: {
            checked: coverageAfterPlan.sourceRepair.checkedCount,
            repaired: coverageAfterPlan.sourceRepair.repairedCount,
            remaining: coverageAfterPlan.sourceRepair.remainingCount,
          },
        },
        automaticBuildPlan: {
          status: buildPlan.status,
          revision: buildPlan.revision,
          contentHash: buildPlan.contentHash,
          confirmationMode: buildPlan.confirmationMode,
          authorizesGeneration: true,
        },
      };
    };
  }

  return legacyHandler;
}

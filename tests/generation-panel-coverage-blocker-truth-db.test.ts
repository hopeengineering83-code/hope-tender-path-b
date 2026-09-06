// Regression — the tender page must not contradict itself about why the
// workflow stopped.
//
// Reported defect: the header read "NEXT REQUIRED ACTION → Source evidence
// required" while the Release status banner directly below read "Processing
// automatically — the workflow is running ... processing continues
// server-side." The second sentence was false, so the owner waited for a
// worker that was never going to run.
//
// Cause: MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE is emitted ONLY by
// lib/engine/canonical-workflow-decision.ts. The GenerationActionPanel drew
// blocker codes from readiness.blockers, readiness.fullProposalBlockers,
// releaseDecision.blockerCodes and canonicalReadiness.blockers — none of
// which ever carries that code. deriveTruthfulReleaseStatus already knew how
// to flip PROCESSING_AUTOMATICALLY -> GENUINE_SOURCE_BLOCKED on an evidence
// code, but the code never reached it.
//
// This test seeds the owner's actual shape on real PostgreSQL: a populated,
// source-verified Company Vault with selected expert/project matches (so no
// vault/matching blocker fires), a confirmed Build Plan, a current AI
// analysis — and only 2 of 4 mandatory requirements at FULL/SUBSTANTIAL
// coverage. In that state the canonical decision blocks on coverage, and the
// panel must agree.
//
// Requires RUN_DB_INTEGRATION=true and a real PostgreSQL DATABASE_URL.

import { before, after, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  dbDescribe,
  getPrisma,
  testSuffix,
  seedUser,
  seedTender,
  seedTenderFile,
  seedRequirement,
  seedComplianceRow,
  cleanupTender,
  cleanupUser,
} from "./helpers/db-acceptance-harness";
import {
  buildSourceVerificationProvenance,
  expertReviewFields,
  projectReviewFields,
} from "../lib/vault-review-provenance";
import { getCanonicalTenderWorkflowDecision } from "../lib/engine/canonical-workflow-decision";
import { buildAndVerifyBuildPlan } from "../lib/engine/automatic-build-plan";
import { getTenderGenerationReadinessStrict } from "../lib/tender-generation-readiness-strict";
import { getCanonicalTenderReadiness } from "../lib/canonical-tender-readiness";
import { computeEngineSourceRevision } from "../lib/engine/engine-source-revision";
import {
  describeAIAnalyzeWorkflowState,
  describeMatchingEngineState,
} from "../lib/engine/workflow-panel-presentation";
import {
  deriveTruthfulReleaseStatus,
  resolveGenerationPanelWorkflowDecision,
} from "../components/generation-action-panel";

const QUOTES = [
  "The Contractor shall provide a licensed Water Engineer with 10 years experience.",
  "The Contractor shall provide a licensed Structural Engineer with 12 years experience.",
  "The Bidder shall demonstrate three completed water supply projects.",
  "The Bidder shall demonstrate two completed sanitation projects.",
];

const FILLER =
  "The Employer intends to procure works for the rehabilitation of municipal water supply and sanitation infrastructure. Bidders shall submit a technical proposal, a financial proposal, and all mandatory forms in the exact order specified in this document. ";

const EXTRACTED_TEXT = [
  "SECTION 1 - INSTRUCTIONS TO BIDDERS",
  FILLER.repeat(6),
  "SECTION 2 - EVALUATION CRITERIA",
  FILLER.repeat(6),
  "SECTION 3 - MANDATORY REQUIREMENTS",
  ...QUOTES,
  "SECTION 4 - SUBMISSION INSTRUCTIONS",
  "Submission shall be by email to submit@example.com before the deadline of 30 calendar days from issue.",
  FILLER.repeat(6),
].join("\n");

dbDescribe("Generation panel — coverage blocker reaches the release status", () => {
  const prisma = getPrisma();
  const client = prisma as unknown as Record<string, any>;
  const suffix = testSuffix();
  let user: { id: string };
  let tender: { id: string };

  before(async () => {
    user = await seedUser(prisma, suffix, "PROPOSAL_MANAGER");
    const company = await client.company.create({
      data: {
        userId: user.id,
        name: `Coverage Co ${suffix}`,
        legalName: `Coverage Co Legal ${suffix}`,
        country: "ET",
        sectors: "Engineering",
      },
    });

    tender = await seedTender(prisma, {
      userId: user.id,
      suffix,
      title: `Water Supply Rehabilitation ${suffix}`,
      status: "MATCHED",
      stage: "COMPLIANCE",
      exactFileNaming: JSON.stringify(["Technical Proposal.docx", "Financial Proposal.docx"]),
    });

    const file = await seedTenderFile(prisma, {
      tenderId: tender.id,
      suffix,
      extractedText: EXTRACTED_TEXT,
      extractionScore: 95,
      totalPages: 2,
      extractedPages: 2,
    });
    // The snapshot's page ledger fails closed without per-page status, which
    // would surface EXTRACTION_UNSAFE instead of the coverage blocker.
    await client.tenderFile.update({
      where: { id: file.id },
      data: {
        pageStatusJson: JSON.stringify([
          { page: 1, status: "OK", charCount: 2000, hasContent: true },
          { page: 2, status: "OK", charCount: 2000, hasContent: true },
        ]),
      },
    });

    // Four mandatory requirements, every one source-traced.
    const requirements = [];
    for (let index = 0; index < QUOTES.length; index += 1) {
      requirements.push(await seedRequirement(prisma, {
        tenderId: tender.id,
        title: `Mandatory requirement ${index + 1}`,
        description: QUOTES[index],
        requirementType: index < 2 ? "EXPERT" : "PROJECT_EXPERIENCE",
        priority: "MANDATORY",
        sourceTenderFileId: file.id,
        sourcePageNumber: 1,
        sourceExactQuote: QUOTES[index],
        sourceConfidence: 95,
      }));
    }

    // Two FULL, two PARTIAL — the genuine 2/4 capability gap.
    for (let index = 0; index < requirements.length; index += 1) {
      await seedComplianceRow(prisma, {
        tenderId: tender.id,
        requirementId: requirements[index].id,
        supportLevel: index < 2 ? "FULL" : "PARTIAL",
        evidenceType: index < 2 ? "EXPERT" : "PROJECT",
      });
    }

    // ── A real, source-verified Company Vault ─────────────────────────────
    const seedVaultDoc = async (name: string, text: string, category: string) =>
      client.companyDocument.create({
        data: {
          companyId: company.id,
          fileName: name,
          originalFileName: name,
          mimeType: "application/pdf",
          size: Buffer.byteLength(text),
          category,
          extractedText: text,
          contentSha256: createHash("sha256").update(text).digest("hex"),
          contentByteLength: Buffer.byteLength(text),
          integrityStatus: "VERIFIED",
          metadata: JSON.stringify({ extractionRevision: 1 }),
        },
      });

    const expertSpecs = [
      { fullName: "Amina Noor", title: "Water Engineer", yearsExperience: 12, disciplines: ["Water Engineering"] },
      { fullName: "Bekele Tadesse", title: "Structural Engineer", yearsExperience: 14, disciplines: ["Structural Engineering"] },
    ];
    for (const spec of expertSpecs) {
      const text = `CURRICULUM VITAE\nName: ${spec.fullName}\nTitle: ${spec.title}\n${spec.fullName} has ${spec.yearsExperience} years of ${spec.disciplines[0]} experience delivering verified public infrastructure assignments.`;
      const document = await seedVaultDoc(`${spec.fullName}-cv.pdf`, text, "CV");
      const fields = {
        fullName: spec.fullName,
        title: spec.title,
        yearsExperience: spec.yearsExperience,
        disciplines: JSON.stringify(spec.disciplines),
      };
      const provenance = buildSourceVerificationProvenance({
        recordType: "EXPERT",
        sourceDocument: document,
        fields: expertReviewFields(fields),
        verificationMethod: "HYBRID",
      });
      assert.equal(provenance.ok, true, "expert source-verification fixture must be valid");
      if (!provenance.ok) return;
      const expert = await client.expert.create({
        data: {
          companyId: company.id,
          ...fields,
          trustLevel: "SOURCE_VERIFIED",
          reviewNotes: provenance.serialized,
          sourceDocumentId: document.id,
        },
      });
      await client.tenderExpertMatch.create({
        data: {
          tenderId: tender.id,
          expertId: expert.id,
          score: 88,
          rationale: "Source-verified discipline match.",
          isSelected: true,
        },
      });
    }

    const projectSpecs = [
      { name: "Adama Water Supply Rehabilitation", clientName: "Adama City Water Utility", country: "ET", sector: "Water" },
      { name: "Bahir Dar Sanitation Upgrade", clientName: "Bahir Dar Municipality", country: "ET", sector: "Sanitation" },
    ];
    for (const spec of projectSpecs) {
      const text = `PROJECT COMPLETION CERTIFICATE\nProject: ${spec.name}\nClient: ${spec.clientName}\nCountry: ${spec.country}\nSector: ${spec.sector}\nThe works were completed and accepted by the client.`;
      const document = await seedVaultDoc(`${spec.name}-certificate.pdf`, text, "PROJECT");
      const provenance = buildSourceVerificationProvenance({
        recordType: "PROJECT",
        sourceDocument: document,
        fields: projectReviewFields(spec),
        verificationMethod: "HYBRID",
      });
      assert.equal(provenance.ok, true, "project source-verification fixture must be valid");
      if (!provenance.ok) return;
      const project = await client.project.create({
        data: {
          companyId: company.id,
          ...spec,
          trustLevel: "SOURCE_VERIFIED",
          reviewNotes: provenance.serialized,
          sourceDocumentId: document.id,
        },
      });
      await client.tenderProjectMatch.create({
        data: {
          tenderId: tender.id,
          projectId: project.id,
          score: 86,
          rationale: "Source-verified sector match.",
          isSelected: true,
        },
      });
    }

    // ── A current tender-source analysis ──────────────────────────────────
    const { buildTenderAnalysisContent, computeAnalysisContentHash } =
      await import("../lib/engine/tender-analysis-content");
    const tenderRow = await client.tender.findUnique({
      where: { id: tender.id },
      select: { title: true, description: true, intakeSummary: true },
    });
    const analysisInputHash = computeAnalysisContentHash(
      buildTenderAnalysisContent(
        {
          title: tenderRow.title,
          description: tenderRow.description,
          intakeSummary: tenderRow.intakeSummary,
          files: [{ id: file.id, extractedText: EXTRACTED_TEXT, originalFileName: `Tender Document ${suffix}.pdf` }],
        } as never,
      ),
    );
    await client.aiJob.create({
      data: {
        userId: user.id,
        tenderId: tender.id,
        jobType: "AI_ANALYZE",
        status: "SUCCEEDED",
        analysisInputHash,
        promotedAt: new Date(),
        startedAt: new Date(Date.now() - 60_000),
        finishedAt: new Date(Date.now() - 30_000),
      },
    });

    const plan = await buildAndVerifyBuildPlan(prisma, tender.id, user.id);
    assert.equal(plan.ok, true, "fixture requires a confirmed Build Plan");

    // Pin the exact reported state: Engine already completed for the same
    // current source revision that owns the selected evidence and Build Plan.
    const engineRevision = await computeEngineSourceRevision(prisma, {
      tenderId: tender.id,
      userId: user.id,
      companyId: company.id,
    });
    assert.ok(engineRevision, "fixture requires a current Engine source revision");
    await client.aiJob.create({
      data: {
        userId: user.id,
        tenderId: tender.id,
        jobType: "ENGINE_RUN",
        status: "SUCCEEDED",
        analysisInputHash: engineRevision.sourceRevision,
        startedAt: new Date(Date.now() - 20_000),
        finishedAt: new Date(Date.now() - 10_000),
      },
    });
  });

  after(async () => {
    if (tender?.id) await cleanupTender(prisma, tender.id);
    if (user?.id) await cleanupUser(prisma, user.id);
  });

  it("blocks on the mandatory coverage gate and no earlier stage", async () => {
    const decision = await getCanonicalTenderWorkflowDecision(prisma, user.id, tender.id);
    assert.equal(decision?.currentBlockingStage, "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE");
    assert.equal(decision?.nextRequiredActionLabel, "Source evidence required");
    assert.equal(decision?.mandatoryFullOrSubstantialCoverageCount, 2);
    assert.equal(decision?.mandatoryRequirementCount, 4);
  });

  it("renders no contradictory manual action after the current Engine completed", async () => {
    const decision = await getCanonicalTenderWorkflowDecision(prisma, user.id, tender.id);
    const readiness = await getTenderGenerationReadinessStrict(prisma, user.id, tender.id);
    const canonicalReadiness = await getCanonicalTenderReadiness(prisma, user.id, tender.id);
    const workflowDecision = await resolveGenerationPanelWorkflowDecision(prisma, user.id, tender.id);
    const engineState = {
      analysisCurrent: true,
      engineRunning: false,
      engineComplete: true,
      engineFailed: false,
      canRunEngine: false,
      activeJob: null,
    };
    assert.ok(decision, "fixture requires a canonical workflow decision");
    const aiPanel = describeAIAnalyzeWorkflowState(engineState);
    const matchingPanel = describeMatchingEngineState(engineState, true, {
      nextRequiredAction: decision.nextRequiredAction,
      nextRequiredActionLabel: decision.nextRequiredActionLabel,
      nextRequiredActionReason: decision.nextRequiredActionReason,
      currentBlockingStage: decision.currentBlockingStage,
      downstreamSuppressedBy: decision.downstreamSuppressedBy,
      finalExportAllowed: decision.finalExportAllowed,
      activeJob: null,
    });
    const releaseStatus = deriveTruthfulReleaseStatus(
      readiness,
      canonicalReadiness,
      null,
      false,
      workflowDecision,
    );

    assert.equal(decision?.nextRequiredActionLabel, "Source evidence required");
    assert.equal(aiPanel, "AI Analysis is complete and current.");
    assert.match(matchingPanel, /Engine complete/);
    assert.match(matchingPanel, /paused — source evidence required/);
    assert.doesNotMatch(matchingPanel, /Downstream processing continues automatically/);
    assert.doesNotMatch(`${aiPanel} ${matchingPanel}`, /Run Engine|Run AI Analyze/);
    assert.equal(releaseStatus, "GENUINE_SOURCE_BLOCKED");
  });

  it("the strict generation sources still cannot produce the coverage code", async () => {
    // The original mechanism of the defect, still asserted: the strict
    // generation-readiness blockers know nothing about mandatory evidence
    // coverage, which is why the panel could not learn about it from them.
    const readiness = await getTenderGenerationReadinessStrict(prisma, user.id, tender.id);
    const strictSourceCodes = [
      ...(readiness?.blockers ?? []).map((blocker) => blocker.code),
      ...(readiness?.fullProposalBlockers ?? []).map((blocker) => blocker.code),
    ];
    assert.ok(
      !strictSourceCodes.includes("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"),
      `strict generation sources unexpectedly carry the coverage code: ${strictSourceCodes.join(", ")}`,
    );
  });

  it("the canonical readiness summary DOES carry the coverage code", async () => {
    // This assertion is inverted from the one it replaces, deliberately.
    //
    // It used to read "the panel's own readiness sources never carry the
    // coverage code", grouping getCanonicalTenderReadiness() with the strict
    // sources and pinning the fact that none of them could see the blocker.
    // That was an accurate description of a limitation, not a property worth
    // protecting: because the summary could not see the release blocker, it
    // reported readyForFinalExport true on tenders /export-readiness was
    // refusing, and the Export screen enabled a download the API then declined.
    //
    // The summary now folds in the canonical release decision's blockers, so
    // it can no longer be more permissive than the gate. Asserting the old
    // limitation would forbid that fix.
    const canonicalReadiness = await getCanonicalTenderReadiness(prisma, user.id, tender.id);
    assert.ok(
      (canonicalReadiness?.blockers ?? []).includes("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"),
      "the readiness summary that gates the download control cannot see the coverage blocker",
    );
    assert.equal(
      canonicalReadiness?.readyForFinalExport,
      false,
      "summary promised final export while mandatory coverage was blocked",
    );
  });

  it("reports GENUINE_SOURCE_BLOCKED, not 'processing automatically'", async () => {
    const readiness = await getTenderGenerationReadinessStrict(prisma, user.id, tender.id);
    const canonicalReadiness = await getCanonicalTenderReadiness(prisma, user.id, tender.id);
    const workflowDecision = await resolveGenerationPanelWorkflowDecision(prisma, user.id, tender.id);

    assert.ok(
      workflowDecision?.blockerCodes.includes("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"),
      "the panel must be able to load the canonical coverage blocker",
    );

    const status = deriveTruthfulReleaseStatus(
      readiness,
      canonicalReadiness,
      null,
      false,
      workflowDecision,
    );
    assert.equal(status, "GENUINE_SOURCE_BLOCKED");
  });

  it("still says 'processing automatically' while downstream work is genuinely queued", async () => {
    const readiness = await getTenderGenerationReadinessStrict(prisma, user.id, tender.id);
    const canonicalReadiness = await getCanonicalTenderReadiness(prisma, user.id, tender.id);
    const workflowDecision = await resolveGenerationPanelWorkflowDecision(prisma, user.id, tender.id);

    // The existing !activeDownstreamWork guard must survive the fix: a real
    // running job is the one case where "processing" is the truth.
    const status = deriveTruthfulReleaseStatus(
      readiness,
      canonicalReadiness,
      null,
      true,
      workflowDecision,
    );
    assert.equal(status, "PROCESSING_AUTOMATICALLY");
  });

  it("names the coverage gap in the pending items instead of an opaque code", async () => {
    const workflowDecision = await resolveGenerationPanelWorkflowDecision(prisma, user.id, tender.id);
    const index = workflowDecision?.blockerCodes.indexOf("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE") ?? -1;
    assert.ok(index >= 0);
    const detail = workflowDecision?.blockerDetails[index] ?? "";
    assert.match(detail, /2\/4 mandatory requirements have release-qualified FULL\/SUBSTANTIAL coverage/);
    assert.match(detail, /Strengthen partial evidence/i);
  });
});

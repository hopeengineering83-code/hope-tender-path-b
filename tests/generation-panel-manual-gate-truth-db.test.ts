// Regression — the release panel must not claim server-side processing while
// the workflow is stopped at a gate only a human can open.
//
// Sibling of the mandatory-coverage contradiction. The panel's
// PROCESSING_AUTOMATICALLY explanation reads "The workflow is running ...
// You may close or refresh this page — processing continues server-side."
// That sentence is false whenever the canonical decision is blocked on a
// manual gate: AI Analyze never run, analysis stale after a content change,
// or Run Engine required. AI Analyze and Run Engine are deliberate manual
// gates, so nothing is running and nothing will start on its own — the owner
// waits forever for a worker that was never queued.
//
// The panel must instead state the same required action the header states.
// It reads the canonical decision through presentTwoActionWorkflowDecision,
// exactly as app/api/tenders/[id]/workflow-center/route.ts does for the
// header, so the two surfaces cannot word it differently.
//
// Requires RUN_DB_INTEGRATION=true and a real PostgreSQL DATABASE_URL.

import { after, it } from "node:test";
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
  cleanupTender,
  cleanupUser,
} from "./helpers/db-acceptance-harness";
import {
  buildSourceVerificationProvenance,
  expertReviewFields,
} from "../lib/vault-review-provenance";
import { getCanonicalTenderWorkflowDecision } from "../lib/engine/canonical-workflow-decision";
import { presentTwoActionWorkflowDecision } from "../lib/engine/two-action-workflow-presentation";
import { getTenderGenerationReadinessStrict } from "../lib/tender-generation-readiness-strict";
import { getCanonicalTenderReadiness } from "../lib/canonical-tender-readiness";
import {
  deriveTruthfulReleaseStatus,
  resolveGenerationPanelWorkflowDecision,
} from "../components/generation-action-panel";

const QUOTES = [
  "The Contractor shall provide a licensed Water Engineer with 10 years experience.",
  "The Contractor shall provide a licensed Structural Engineer with 12 years experience.",
];
const FILLER =
  "The Employer intends to procure works for the rehabilitation of municipal water supply and sanitation infrastructure. Bidders shall submit a technical proposal, a financial proposal, and all mandatory forms in the exact order specified in this document. ";
const TEXT = [
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

type Seeded = { userId: string; tenderId: string };

const created: Seeded[] = [];

/**
 * Seed a tender whose Vault evidence is genuine and selected, so no evidence
 * blocker fires and the only thing left blocking is the requested stage.
 */
async function seedScenario(
  client: Record<string, any>,
  analysisJob: "none" | "current" | "stale",
): Promise<Seeded> {
  const prisma = getPrisma();
  const suffix = testSuffix();
  const user = await seedUser(prisma, suffix, "PROPOSAL_MANAGER");
  const company = await client.company.create({
    data: {
      userId: user.id,
      name: `Manual Gate Co ${suffix}`,
      legalName: `Manual Gate Co Legal ${suffix}`,
      country: "ET",
      sectors: "Engineering",
    },
  });

  const tender = await seedTender(prisma, {
    userId: user.id,
    suffix,
    status: "MATCHED",
    stage: "COMPLIANCE",
    exactFileNaming: JSON.stringify(["Technical Proposal.docx"]),
    // The harness default notes ("Analysis source: AI ...") are what
    // analysis-state-resolver treats as a legacy AI-analyzed marker. For the
    // "never run" scenario that would fake an analysis into existence, so use
    // neutral notes and let the absence of a job speak for itself.
    ...(analysisJob === "none" ? { notes: "Intake recorded from the procurement portal." } : {}),
  });
  const seeded: Seeded = { userId: user.id, tenderId: tender.id };
  created.push(seeded);

  const file = await seedTenderFile(prisma, {
    tenderId: tender.id,
    suffix,
    extractedText: TEXT,
    extractionScore: 95,
    totalPages: 2,
    extractedPages: 2,
  });
  await client.tenderFile.update({
    where: { id: file.id },
    data: {
      pageStatusJson: JSON.stringify([
        { page: 1, status: "OK", charCount: 2000, hasContent: true },
        { page: 2, status: "OK", charCount: 2000, hasContent: true },
      ]),
    },
  });

  for (let index = 0; index < QUOTES.length; index += 1) {
    await seedRequirement(prisma, {
      tenderId: tender.id,
      title: `Mandatory requirement ${index + 1}`,
      description: QUOTES[index],
      requirementType: "EXPERT",
      priority: "MANDATORY",
      sourceTenderFileId: file.id,
      sourcePageNumber: 1,
      sourceExactQuote: QUOTES[index],
      sourceConfidence: 95,
    });
  }

  const spec = { fullName: "Amina Noor", title: "Water Engineer", yearsExperience: 12, disciplines: ["Water Engineering"] };
  const cvText = `CURRICULUM VITAE\nName: ${spec.fullName}\nTitle: ${spec.title}\n${spec.fullName} has ${spec.yearsExperience} years of ${spec.disciplines[0]} experience delivering verified public infrastructure assignments.`;
  const document = await client.companyDocument.create({
    data: {
      companyId: company.id,
      fileName: "cv.pdf",
      originalFileName: "cv.pdf",
      mimeType: "application/pdf",
      size: Buffer.byteLength(cvText),
      category: "CV",
      extractedText: cvText,
      contentSha256: createHash("sha256").update(cvText).digest("hex"),
      contentByteLength: Buffer.byteLength(cvText),
      integrityStatus: "VERIFIED",
      metadata: JSON.stringify({ extractionRevision: 1 }),
    },
  });
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
  if (!provenance.ok) return seeded;
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

  if (analysisJob !== "none") {
    const { buildTenderAnalysisContent, computeAnalysisContentHash } =
      await import("../lib/engine/tender-analysis-content");
    const tenderRow = await client.tender.findUnique({
      where: { id: tender.id },
      select: { title: true, description: true, intakeSummary: true },
    });
    const currentHash = computeAnalysisContentHash(
      buildTenderAnalysisContent(
        {
          title: tenderRow.title,
          description: tenderRow.description,
          intakeSummary: tenderRow.intakeSummary,
          files: [{ id: file.id, extractedText: TEXT, originalFileName: `Tender Document ${suffix}.pdf` }],
        } as never,
      ),
    );
    await client.aiJob.create({
      data: {
        userId: user.id,
        tenderId: tender.id,
        jobType: "AI_ANALYZE",
        status: "SUCCEEDED",
        analysisInputHash:
          analysisJob === "current" ? currentHash : "stale-hash-that-cannot-match-current-content",
        promotedAt: new Date(),
        startedAt: new Date(Date.now() - 60_000),
        finishedAt: new Date(Date.now() - 30_000),
      },
    });
  }

  return seeded;
}

async function panelStatusFor(seeded: Seeded, activeDownstreamWork = false) {
  const prisma = getPrisma();
  const readiness = await getTenderGenerationReadinessStrict(prisma, seeded.userId, seeded.tenderId);
  const canonicalReadiness = await getCanonicalTenderReadiness(prisma, seeded.userId, seeded.tenderId);
  const workflowDecision = await resolveGenerationPanelWorkflowDecision(prisma, seeded.userId, seeded.tenderId);
  return {
    workflowDecision,
    status: deriveTruthfulReleaseStatus(
      readiness,
      canonicalReadiness,
      null,
      activeDownstreamWork,
      workflowDecision,
    ),
  };
}

dbDescribe("Generation panel — no false 'processing' at a manual gate", () => {
  const prisma = getPrisma();
  const client = prisma as unknown as Record<string, any>;

  after(async () => {
    for (const seeded of created) {
      await cleanupTender(prisma, seeded.tenderId).catch(() => {});
      await cleanupUser(prisma, seeded.userId).catch(() => {});
    }
  });

  it("AI Analyze never run — the panel names the action instead of claiming processing", async () => {
    const seeded = await seedScenario(client, "none");
    const decision = presentTwoActionWorkflowDecision(
      await getCanonicalTenderWorkflowDecision(prisma, seeded.userId, seeded.tenderId),
    );
    assert.equal(decision?.currentBlockingStage, "AI_ANALYZE_NOT_RUN");
    assert.equal(decision?.nextRequiredAction, "RUN_AI_ANALYZE");

    const { status } = await panelStatusFor(seeded);
    assert.notEqual(
      status,
      "PROCESSING_AUTOMATICALLY",
      "AI Analyze is a manual gate — nothing is running server-side",
    );
    assert.equal(status, "MANUAL_ACTION_REQUIRED");
  });

  it("analysis stale after a content change — same, it needs a human re-run", async () => {
    const seeded = await seedScenario(client, "stale");
    const decision = presentTwoActionWorkflowDecision(
      await getCanonicalTenderWorkflowDecision(prisma, seeded.userId, seeded.tenderId),
    );
    assert.equal(decision?.currentBlockingStage, "STALE_ANALYSIS");
    assert.equal(decision?.nextRequiredActionLabel, "Re-run AI Analyze");

    const { status } = await panelStatusFor(seeded);
    assert.equal(status, "MANUAL_ACTION_REQUIRED");
  });

  it("Run Engine required — a manual gate too, so no processing claim", async () => {
    const seeded = await seedScenario(client, "current");
    const decision = presentTwoActionWorkflowDecision(
      await getCanonicalTenderWorkflowDecision(prisma, seeded.userId, seeded.tenderId),
    );
    // presentTwoActionWorkflowDecision maps the Engine-owned stages onto the
    // single Run Engine action the owner actually has to press.
    assert.equal(decision?.nextRequiredAction, "RUN_ENGINE");

    const { status } = await panelStatusFor(seeded);
    assert.equal(status, "MANUAL_ACTION_REQUIRED");
  });

  it("the panel echoes the header's exact wording, so they cannot disagree", async () => {
    const seeded = await seedScenario(client, "stale");
    const header = presentTwoActionWorkflowDecision(
      await getCanonicalTenderWorkflowDecision(prisma, seeded.userId, seeded.tenderId),
    );
    const { workflowDecision } = await panelStatusFor(seeded);
    assert.equal(workflowDecision?.nextRequiredActionLabel, header?.nextRequiredActionLabel);
    assert.equal(workflowDecision?.nextRequiredActionReason, header?.nextRequiredActionReason);
    assert.equal(workflowDecision?.nextRequiredAction, header?.nextRequiredAction);
  });

  it("a genuinely queued job still reads as processing", async () => {
    const seeded = await seedScenario(client, "current");
    const { status } = await panelStatusFor(seeded, true);
    assert.equal(
      status,
      "PROCESSING_AUTOMATICALLY",
      "with real downstream work queued, 'processing automatically' is the truth",
    );
  });
});

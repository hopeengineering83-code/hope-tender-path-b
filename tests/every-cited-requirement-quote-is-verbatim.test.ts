// Every requirement the Build Plan cites carries a quote that is verbatim in
// its tender file, whatever the requirement's priority — and the plan's
// confirmation compares that quote the way every other check does.
//
// 2026-10-06, Preview, a feasibility-study ToR: Run Engine stopped at
// BUILD_PLAN_AUTOMATION_BLOCKED, "Requirement … quote is not supported by
// active file text", for two rows:
//
//   1. "Technical Proposal • Understanding of the assignment; • Proposed
//      methodology; …" — verbatim in the source, but the source's bullets are
//      a different glyph. The draft preflight and AI Analyze's grounding
//      compare through normalizeForContainment; the confirmation compared
//      lowercase/whitespace only, so the same quote passed one gate and failed
//      the next.
//   2. "The proposed team should preferably include: Team Leader / …
//      Specialist; … Specialist." — the model re-punctuated a bulleted list.
//      Only MANDATORY rows were ever re-grounded, and this row is optional,
//      yet the plan cites it.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { groundRequirementInActiveFiles } from "../lib/engine/repair-source-grounding";
import { validateBuildPlanForConfirmation } from "../lib/engine/build-plan";
import { buildSubmissionPlan, plannedSubmissionTargetFiles } from "../lib/engine/submission-plan";
import { normalizeForContainment } from "../lib/engine/evidence-grounding";

const PAGE_1 =
  "Terms of Reference — Consultancy Service for a Feasibility Study\n" +
  "1. Background\nThe project strengthens water, sanitation and hygiene service delivery in three districts. ".repeat(3) +
  "\n9. Team composition\nThe proposed team should preferably include:\n" +
  " Team Leader / WASH Systems Specialist\n" +
  " WASH Governance/Institutional Specialist\n" +
  " WASH Financing Specialist\n" +
  " WASH Service Delivery/O&M Specialist\n" +
  " MEAL/Data Specialist.\n";
const PAGE_2 =
  "11. Proposal content\nTechnical Proposal\n" +
  " Understanding of the assignment;\n" +
  " Proposed methodology;\n" +
  " Approach to assessing previous/ongoing project – New project;\n" +
  " Work plan;\n" +
  " Team composition.\n" +
  "The consultant shall submit a technical proposal and a financial proposal. ".repeat(3);
const TEXT = `${PAGE_1}\f${PAGE_2}`;

const REPUNCTUATED =
  "The proposed team should preferably include: Team Leader / WASH Systems Specialist; WASH Governance/Institutional Specialist; " +
  "WASH Financing Specialist; WASH Service Delivery/O&M Specialist; MEAL/Data Specialist.";
const BULLETED =
  "Technical Proposal • Understanding of the assignment; • Proposed methodology; • Approach to assessing previous/ongoing project – New project; • Work plan; • Team composition.";

describe("a re-punctuated quote is grounded on the passage it lifted", () => {
  const files = [{ id: "file-tor", extractedText: TEXT, totalPages: 2 }];

  it("the re-punctuated list is not itself in the source", () => {
    assert.equal(normalizeForContainment(TEXT).includes(normalizeForContainment(REPUNCTUATED)), false);
  });

  it("finds the bulleted passage verbatim, on its page", () => {
    const hit = groundRequirementInActiveFiles(
      { title: "Team Composition Requirements", description: "Proposed team composition.", sourceTenderFileId: "file-tor", sourceQuote: REPUNCTUATED },
      files,
    );
    assert.ok(hit, "grounded");
    assert.equal(hit!.fileId, "file-tor");
    assert.equal(hit!.page, 1);
    assert.ok(TEXT.includes(hit!.quote), "the stored quote is verbatim source text");
    assert.match(hit!.quote, /WASH Financing Specialist/);
  });

  it("a quote whose words the tender does not hold is still not grounded", () => {
    const hit = groundRequirementInActiveFiles(
      { title: "Insurance", description: "", sourceQuote: "Professional indemnity insurance of not less than one million dollars is mandatory." },
      files,
    );
    assert.equal(hit, null);
  });
});

describe("Build Plan confirmation compares quotes the way the draft check does", () => {
  function tenderWith(quote: string) {
    return {
      id: "t1",
      userId: "u1",
      title: "Consultancy Service for a Feasibility Study",
      exactFileNaming: null,
      exactFileOrder: null,
      submissionMethod: null,
      files: [{ id: "file-tor", deletionStatus: "ACTIVE", extractedText: TEXT, totalPages: 2, originalFileName: "ToR.pdf" }],
      requirements: [{
        id: "req-tech",
        title: "Technical Proposal",
        description: "Submit a technical proposal covering the listed contents.",
        requirementType: "TECHNICAL_PROPOSAL",
        priority: "MANDATORY",
        exactFileName: null,
        exactOrder: null,
        requiredQuantity: null,
        pageLimit: null,
        restrictions: null,
        sectionReference: null,
        sourceTenderFileId: "file-tor",
        sourcePageNumber: 2,
        sourceExactQuote: quote,
      }],
      metadataOverrides: [],
    };
  }
  async function blockers(quote: string): Promise<string[]> {
    const tender = tenderWith(quote);
    const items = plannedSubmissionTargetFiles(buildSubmissionPlan(tender as never));
    assert.ok(items.some((item) => item.sourceRequirementIds.includes("req-tech")), "the plan cites the requirement");
    const fakePrisma = { tender: { findFirst: async () => tender } };
    const result = await validateBuildPlanForConfirmation(fakePrisma as never, "t1", "u1", items as never);
    return result.blockers.filter((b) => b.includes("req-tech"));
  }

  it("a quote over a bulleted list with a different bullet glyph is supported", async () => {
    assert.deepEqual(await blockers(BULLETED), []);
  });

  it("a quote the file does not contain is still refused", async () => {
    const found = await blockers("Technical Proposal • Executive summary; • Corporate social responsibility statement.");
    assert.ok(found.some((b) => /quote is not supported by active file text/.test(b)), JSON.stringify(found));
  });
});

// The promotion itself, against a real database: a SUCCEEDED analysis chunk
// whose optional requirement carries the re-punctuated quote.
const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
describe("AI Analyze promotion grounds an optional requirement's quote — real PostgreSQL", { skip: !RUN_DB }, () => {
  let prisma: any;
  let userId = "";
  let tenderId = "";
  let fileId = "";
  let jobId = "";

  before(async () => {
    const db = await import("../lib/prisma");
    prisma = db.prisma;
    await db.prismaReady;
    const { computeAnalysisContentHash, buildTenderAnalysisContent, ANALYSIS_HASH_FILE_SELECT } = await import("../lib/engine/tender-analysis-content");
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    userId = (await prisma.user.create({ data: { email: `verbatim-${nonce}@example.test`, name: "Verbatim Quotes", passwordHash: "h" } })).id;
    tenderId = (await prisma.tender.create({
      data: { userId, title: `Feasibility Study ${nonce}`, status: "DRAFT", stage: "TENDER_INTAKE" },
    })).id;
    fileId = (await prisma.tenderFile.create({
      data: { tenderId, fileName: "tor.pdf", originalFileName: "ToR.pdf", mimeType: "application/pdf", size: TEXT.length, storagePath: "", extractedText: TEXT, totalPages: 2 },
    })).id;
    const tender = await prisma.tender.findFirst({ where: { id: tenderId }, include: { files: { where: { deletionStatus: "ACTIVE" }, select: ANALYSIS_HASH_FILE_SELECT } } });
    const analysisInputHash = computeAnalysisContentHash(buildTenderAnalysisContent(tender as never, undefined));
    jobId = (await prisma.aiJob.create({
      data: { userId, tenderId, jobType: "AI_ANALYZE", status: "RUNNING", input: "{}", analysisInputHash },
    })).id;
    const result = {
      summary: "Feasibility study of WASH service delivery.",
      requirements: [
        {
          title: "Technical Proposal",
          description: "Submit a technical proposal covering the listed contents.",
          requirementType: "TECHNICAL_PROPOSAL",
          priority: "MANDATORY",
          sourcePage: 2,
          sourceQuote: BULLETED,
          sourceTenderFileId: fileId,
        },
        {
          title: "Team Composition Requirements",
          description: "Proposed team composition.",
          requirementType: "PERSONNEL",
          priority: "PREFERRED",
          sourcePage: 1,
          sourceQuote: REPUNCTUATED,
          sourceTenderFileId: fileId,
        },
      ],
      exactFileNaming: [],
      exactFileOrder: [],
      evaluationMethodology: "",
      submissionNotes: "",
    };
    await prisma.aiAnalyzeChunk.create({
      data: {
        jobId, tenderId, userId, contentHash: analysisInputHash, chunkIndex: 0, totalChunks: 1,
        status: "SUCCEEDED", provider: "groq", resultJson: JSON.stringify(result), finishedAt: new Date(),
      },
    });
  });

  after(async () => {
    if (!prisma) return;
    await prisma.tenderRequirement.deleteMany({ where: { tenderId } }).catch(() => {});
    await prisma.aiAnalyzeChunk.deleteMany({ where: { jobId } }).catch(() => {});
    await prisma.aiAnalyzeRetryState.deleteMany({ where: { jobId } }).catch(() => {});
    await prisma.aiJob.deleteMany({ where: { tenderId } }).catch(() => {});
    await prisma.tenderFile.deleteMany({ where: { tenderId } }).catch(() => {});
    await prisma.tender.deleteMany({ where: { id: tenderId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  });

  it("stores a verbatim quote for the optional row", async () => {
    const { finalizeJob } = await import("../lib/ai-jobs/analysis-job-service");
    const outcome = await finalizeJob(jobId, userId);
    assert.notEqual((outcome as any)?.status, "FAILED", JSON.stringify(outcome));
    const rows = await prisma.tenderRequirement.findMany({ where: { tenderId }, select: { title: true, sourceExactQuote: true, sourceTenderFileId: true, sourcePageNumber: true } });
    const team = rows.find((r: any) => r.title === "Team Composition Requirements");
    assert.ok(team, `the optional row is stored: ${JSON.stringify(rows.map((r: any) => r.title))}`);
    assert.equal(team.sourceTenderFileId, fileId);
    assert.equal(team.sourcePageNumber, 1);
    assert.ok(normalizeForContainment(TEXT).includes(normalizeForContainment(team.sourceExactQuote)), `verbatim: ${team.sourceExactQuote}`);
  });
});

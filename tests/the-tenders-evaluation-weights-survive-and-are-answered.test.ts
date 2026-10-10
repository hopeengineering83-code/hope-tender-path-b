// The tender's evaluation criteria and weights survive Run Engine, and the
// proposal answers them as the tender states them — without stock claims.
//
// 2026-10-10, a probe of the real generator with a weighted tender
// ("Specific Experience of the Consultant: 20 points; Adequacy of the Proposed
// Methodology and Work Plan: 40 points; Qualifications of Key Experts: 30
// points; Social Value and Local Capacity Building: 10 points"):
//  - Run Engine rebuilt the promoted analysis without evaluationMethodology and
//    wrote null back to the tender, so every run erased the criteria and
//    weights AI Analyze had extracted;
//  - with them kept, the rubric post-pass injected stock paragraphs claiming
//    completion certificates, on-time and on-budget delivery, an ISO 14001
//    system and 60 % local staff, two of them after the signature block;
//  - Section F listed the keyword detector's sector defaults instead of the
//    tender's criteria, paired weights by one shared word, and printed "Not
//    presented in this proposal" beside the 40-point methodology criterion.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { ensureRubricHeadings } from "../lib/engine/rubric-driven-sections";
import { buildEvaluatorMirrorSection } from "../lib/engine/evaluator-mirror-builder";
import { reconcileSectionPointers } from "../lib/engine/section-pointer-reconciliation";

const WEIGHTS = [
  { criterion: "Specific Experience of the Consultant", weight: "20 points", rawMatch: "Specific Experience of the Consultant: 20 points" },
  { criterion: "Adequacy of the Proposed Methodology and Work Plan", weight: "40 points", rawMatch: "Adequacy of the Proposed Methodology and Work Plan: 40 points" },
  { criterion: "Qualifications of Key Experts", weight: "30 points", rawMatch: "Qualifications of Key Experts: 30 points" },
  { criterion: "Social Value and Local Capacity Building", weight: "10 points", rawMatch: "Social Value and Local Capacity Building: 10 points" },
];
const DOCUMENT = [
  "# SECTION A: COMPANY PROFILE", "## A.1 Company Overview", "x", "## A.3 Proposed Project Team", "x", "## A.4 Team-to-Project Experience Mapping", "x",
  "# Section B: Relevant Experience", "## B.1 Client References", "x", "## B.2 Project Portfolio", "x",
  "# SECTION C: TECHNICAL APPROACH", "## C.2 Understanding of the Assignment", "x", "## C.3 Technical Methodology", "x", "## C.4 Work Plan and Deliverables", "x",
  "# Section D: Additional Information", "## D.1 Value Framework", "x",
  "# Declaration", "Signature: ____",
].join("\n");

describe("a weighted criterion without its own heading gets no stock text", () => {
  it("the post-pass reports it and leaves the proposal as written", () => {
    const result = ensureRubricHeadings(DOCUMENT, WEIGHTS, "Building Design");
    assert.equal(result.markdown, DOCUMENT);
    assert.deepEqual(result.missingCriteria, WEIGHTS.map((w) => w.criterion));
    assert.doesNotMatch(result.markdown, /completion certificate|within budget|ISO 14001|60 %|minimum of 10 years/);
  });

  it("a criterion the proposal already heads is not reported", () => {
    const withHeading = `${DOCUMENT}\n## MA 01 Adequacy of the Proposed Methodology and Work Plan (40 points)\nBody.`;
    assert.ok(!ensureRubricHeadings(withHeading, WEIGHTS).missingCriteria.includes("Adequacy of the Proposed Methodology and Work Plan"));
  });
});

describe("Section F answers the tender's own weighted criteria", () => {
  const sectionF = () => {
    const section = buildEvaluatorMirrorSection({
      evaluationCriteria: WEIGHTS.map((w) => w.criterion),
      evaluationWeights: WEIGHTS,
      primarySector: "Building Design",
      projects: [{ name: "Lakeshore Resort Hotel", country: "Ethiopia", contractValue: 310e6, currency: "ETB", summary: "Hotel (9,500 m²)" }],
      experts: [{ fullName: "Hanna Tadesse", title: "Principal Architect", certifications: JSON.stringify(["AR/2201"]) }],
    })!;
    return reconcileSectionPointers(`${DOCUMENT}\n\n${section}`).markdown;
  };
  const row = (markdown: string, criterion: string) => markdown.split("\n").find((l) => l.startsWith(`| ${criterion} |`))!.split("|").map((c) => c.trim());

  it("each criterion carries its own weight", () => {
    const md = sectionF();
    for (const w of WEIGHTS) assert.equal(row(md, w.criterion)[2], w.weight, w.criterion);
  });

  it("each points at the section that answers it", () => {
    const md = sectionF();
    assert.equal(row(md, "Adequacy of the Proposed Methodology and Work Plan")[3], "Section C.3 Technical Methodology + Section C.4 Work Plan and Deliverables");
    assert.match(row(md, "Specific Experience of the Consultant")[3]!, /Section B\.2 Project Portfolio/);
    assert.match(row(md, "Qualifications of Key Experts")[3]!, /Section A\.3 Proposed Project Team/);
    assert.match(row(md, "Social Value and Local Capacity Building")[3]!, /^Section D /);
    assert.doesNotMatch(md, /Not presented in this proposal/);
  });

  it("evidence fits the criterion: no portfolio area for a methodology, no featured project for social value", () => {
    const md = sectionF();
    assert.equal(row(md, "Adequacy of the Proposed Methodology and Work Plan")[4], "The technical methodology, work plan and deliverables set out in Section C");
    assert.equal(row(md, "Social Value and Local Capacity Building")[4], "The commitments stated in Section D");
  });

  it("one shared word does not lend a criterion another's weight", () => {
    const section = buildEvaluatorMirrorSection({ evaluationCriteria: ["Company profile and organisational capacity"], evaluationWeights: WEIGHTS, primarySector: "Building Design" })!;
    assert.match(section, /\| Company profile and organisational capacity \| — \|/);
  });

  it("'Quality of technical methodology' is a methodology question, and one project's area is not a range", () => {
    const section = buildEvaluatorMirrorSection({
      evaluationCriteria: ["Quality of technical methodology", "Quality and relevance of portfolio"], evaluationWeights: [], primarySector: "Building Design",
      projects: [{ name: "Lakeshore Resort Hotel", summary: "Hotel (9,500 m²)", serviceAreas: "Architectural design" }],
    })!;
    assert.match(section, /\| Quality of technical methodology \| [^|]+ \| The technical methodology, work plan and deliverables set out in Section C \|/);
    assert.match(section, /1 project of 9,500 m²/);
    assert.doesNotMatch(section, /9,500–9,500/);
  });
});

describe("a pointer to a whole section is read as one", () => {
  it("'… and Section C: Technical Approach' ends the pointer before it", () => {
    const md = `${DOCUMENT}\n\n| Criterion | Where This Proposal Answers It |\n|---|---|\n| Methodology | Section C.2 Understanding of the Assignment and Section C: Technical Approach |`;
    const out = reconcileSectionPointers(md).markdown;
    assert.match(out, /\| Methodology \| Section C\.2 Understanding of the Assignment \+ Section C Technical Approach \|/);
  });
});

describe("Run Engine keeps the tender's evaluation methodology — real PostgreSQL", { skip: process.env.RUN_DB_INTEGRATION !== "true" }, () => {
  it("the criteria and weights AI Analyze extracted are still on the tender after two runs", async () => {
    const { createHash, randomUUID } = await import("node:crypto");
    const { prisma, prismaReady } = await import("../lib/prisma");
    const { buildTenderAnalysisContent, computeAnalysisContentHash } = await import("../lib/engine/tender-analysis-content");
    const { enqueueEngineJobForCurrentSources } = await import("../lib/engine/enqueue-engine-job");
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const { completeJob } = await import("../lib/ai-jobs");
    const { runTenderEngine } = await import("../lib/engine/run-tender-engine");
    await prismaReady;

    const METHODOLOGY = WEIGHTS.map((w, i) => `${i + 1}. ${w.rawMatch}`).join("\n");
    const user = await prisma.user.create({ data: { email: `eval-weights-${randomUUID()}@test.local`, passwordHash: "unused", role: "PROPOSAL_MANAGER" } });
    const company = await prisma.company.create({ data: { userId: user.id, name: "Northgate Engineering" } });
    const text = ["RFP MSB/31-11 — Design of a G+8 Office Building", "Technical evaluation criteria:", METHODOLOGY, "The consultant shall design the building and prepare tender documents."].join("\n");
    const tender = await prisma.tender.create({ data: {
      userId: user.id, title: "Design of a G+8 Office Building", clientName: "Metro Savings Bank", status: "AI_ANALYZED",
      analysisSummary: "Design of an office building.", evaluationMethodology: METHODOLOGY,
    } });
    try {
      const source = await prisma.tenderFile.create({ data: {
        tenderId: tender.id, fileName: "rfp.pdf", originalFileName: "rfp.pdf", mimeType: "application/pdf", size: Buffer.byteLength(text),
        extractedText: text, totalPages: 1, extractedPages: 1, failedPages: 0, extractionScore: 100, extractionMethod: "text",
        integrityStatus: "VERIFIED", contentSha256: createHash("sha256").update(text).digest("hex"), contentByteLength: Buffer.byteLength(text),
      } });
      const quote = "The consultant shall design the building and prepare tender documents.";
      await prisma.tenderRequirement.create({ data: {
        tenderId: tender.id, title: "Building design", description: quote, requirementType: "TECHNICAL", priority: "MANDATORY",
        sourceTenderFileId: source.id, sourcePageNumber: 1, sourceExactQuote: quote, sourceConfidence: 1, sourceExtractionMethod: "text",
      } });
      const hash = computeAnalysisContentHash(buildTenderAnalysisContent({ title: tender.title, description: null, intakeSummary: null, files: [{ ...source, createdAt: source.createdAt }] }));
      await prisma.aiJob.create({ data: {
        userId: user.id, tenderId: tender.id, jobType: "AI_ANALYZE", status: "SUCCEEDED", analysisInputHash: hash,
        promotedAt: new Date(), promotedBy: user.id, finishedAt: new Date(), input: "{}", output: JSON.stringify({ analysisSource: "AI" }),
      } });

      for (let run = 1; run <= 2; run++) {
        const job = await enqueueEngineJobForCurrentSources(prisma, { userId: user.id, tenderId: tender.id, companyId: company.id, manualRequested: true });
        await claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: tender.id, userId: user.id, global: false });
        const result = await runTenderEngine(tender.id, user.id, undefined, { safe: true, skipAiRematch: true });
        assert.equal(result.reusedPromotedAnalysis, true);
        if (job) await completeJob(job.job.id, { ok: true });
        const after = await prisma.tender.findUniqueOrThrow({ where: { id: tender.id }, select: { evaluationMethodology: true } });
        assert.equal(after.evaluationMethodology, METHODOLOGY, `run ${run} kept the tender's criteria and weights`);
      }
    } finally {
      await prisma.aiJob.deleteMany({ where: { tenderId: tender.id } });
      await prisma.tender.deleteMany({ where: { id: tender.id } });
      await prisma.company.deleteMany({ where: { userId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });
});

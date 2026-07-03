import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeTenderReadinessState } from "../lib/tender-readiness-state";
import { computeCanonicalModuleStates } from "../lib/engine/canonical-readiness-state";
import { resolveSubmissionPlanCompleteness, hasValidSubmissionPlan } from "../lib/engine/submission-plan-completeness";

const req = (overrides: Record<string, unknown> = {}) => ({
  id: "req-1",
  priority: "MANDATORY",
  title: "Technical proposal",
  description: "Submit a technical proposal",
  requirementType: "DOCUMENT",
  sourcePageNumber: 4,
  sourceExactQuote: "Bidders shall submit a technical proposal.",
  sectionReference: "ITB 4",
  sourceConfidence: 0.92,
  exactFileName: "Technical Proposal.docx",
  exactOrder: 1,
  ...overrides,
});

const readyTender = {
  id: "tender-1",
  analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
  analysisSource: "AI",
  analysisSeverity: "GOOD" as const,
  notes: "Analysis source: AI",
  title: "Hospital Equipment Tender",
  clientName: "Ministry of Health",
  reference: "MOH-001",
  requirements: [req()],
  exactFileNaming: '["Technical Proposal.docx"]',
  exactFileOrder: '["Technical Proposal.docx"]',
};

function states(input: Parameters<typeof computeTenderReadinessState>[0]) {
  const readiness = computeTenderReadinessState(input);
  return computeCanonicalModuleStates({
    ...readiness,
    hasAnalysis: true,
    hasRequirements: (input.requirements ?? []).length > 0,
    hasDocuments: (input.generatedDocuments ?? []).length > 0,
    generationServerReady: readiness.exportAllowed,
  });
}

describe("canonical readiness contradictions restored coverage", () => {
  it("regex fallback remains blocked across analysis, requirements, generation, and export", () => {
    const result = states({ ...readyTender, analysisSource: "REGEX_FALLBACK_AI_ERROR", notes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR)." });
    assert.equal(result.analysis, "BLOCKED");
    assert.equal(result.requirements, "BLOCKED");
    assert.equal(result.generation, "BLOCKED");
    assert.equal(result.export, "BLOCKED");
  });

  it("missing submission plan blocks final export even when analysis and requirements exist", () => {
    const readiness = computeTenderReadinessState({ ...readyTender, exactFileNaming: "[]", exactFileOrder: "[]", requirements: [req({ exactFileName: null })] });
    const result = computeCanonicalModuleStates({ ...readiness, hasAnalysis: true, hasRequirements: true, hasDocuments: false, generationServerReady: false });
    assert.equal(readiness.submissionPlanBuilt, false);
    assert.equal(readiness.exportAllowed, false);
    assert.equal(result.submissionPlan, "NOT_RUN");
    assert.notEqual(result.export, "READY");
  });

  it("stale generated documents block documents, generation, and export", () => {
    const result = states({ ...readyTender, generatedDocuments: [{ generationStatus: "GENERATED", contentSummary: JSON.stringify({ analysisHash: "v1:stale" }) }] });
    assert.equal(result.documents, "STALE");
    assert.equal(result.generation, "STALE");
    assert.equal(result.export, "STALE");
  });

  it("OCR_REQUIRED blocks extraction-dependent readiness", () => {
    const result = states({ ...readyTender, analysisExtractionStatus: "OCR_REQUIRED" });
    assert.equal(result.extraction, "BLOCKED");
    assert.equal(result.analysis, "BLOCKED");
    assert.equal(result.export, "BLOCKED");
  });

  it("critical metadata cannot be trusted without active source values", () => {
    const result = states({ ...readyTender, clientName: "", procuringEntityName: "", reference: "" });
    assert.equal(result.metadata, "BLOCKED");
    assert.equal(result.export, "BLOCKED");
  });

  it("export blockers stay strict for generated document gaps and PLANNED placeholders", () => {
    const report = resolveSubmissionPlanCompleteness({
      tender: { ...readyTender, requirements: [req()] },
      generatedDocuments: [{
        id: "planned-1",
        name: "Technical Proposal",
        exactFileName: "Technical Proposal.docx",
        exactOrder: 1,
        documentType: "TECHNICAL_PROPOSAL",
        format: "DOCX",
        generationStatus: "PLANNED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
        fileContent: null,
        storagePath: null,
      }],
    });
    assert.equal(report.totalRequired, 1);
    assert.equal(report.totalGenerated, 0);
    assert.equal(report.totalMissing, 1);
    assert.match(report.warnings.join("\n"), /planned document placeholder|missing/i);
  });

  it("PLANNED documents are virtual/readiness-only in routes and are not persisted before readiness", async () => {
    const buildRoute = readFileSync("app/api/tenders/[id]/submission-plan/build/route.ts", "utf8");
    const generateRoute = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.match(buildRoute, /zero GeneratedDocument rows/);
    assert.doesNotMatch(buildRoute, /prisma\.generatedDocument\.create\(/);
    assert.match(generateRoute, /Plan-only mode is virtual\/readiness-only/);
    assert.match(generateRoute, /planRowsCreated = 0/);
    assert.match(generateRoute, /no GeneratedDocument rows were created before readiness/);

    const calls: unknown[] = [];
    const result = await hasValidSubmissionPlan({ generatedDocument: { count: async (args: unknown) => { calls.push(args); return 0; } } } as any, "tender-1");
    assert.equal(result.valid, false);
    assert.equal(result.plannedCount, 0);
    assert.deepEqual(calls, [{ where: { tenderId: "tender-1", generationStatus: { not: "SUPERSEDED" } } }]);
  });
});

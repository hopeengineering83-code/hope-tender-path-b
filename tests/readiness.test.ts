import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { getCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { getTenderGenerationReadiness } from "../lib/tender-generation-readiness";
import { buildReviewProvenance, expertReviewFields, projectReviewFields } from "../lib/vault-review-provenance";

// getTenderGenerationReadiness now delegates expert/project match evidence
// checks to canUseVaultRecord(), the same durable-provenance authority the
// Engine and generate-elite.ts use — a bare `{ trustLevel: "REVIEWED" }`
// match (no sourceDocumentId/reviewedBy/reviewedAt/reviewNotes) correctly
// fails closed, so fixtures meant to be genuinely reviewed need a real
// bound-and-verified provenance envelope.
function durableReviewedExpert(fullName = "Senior Engineer") {
  const companyId = "company-1";
  const sourceText = `CURRICULUM VITAE\nName of Key Expert: ${fullName}\n${fullName} is a Senior Consultant with 15 years of experience in General Consultancy Services, proposed for the technical team.`;
  const sourceDocument = {
    id: `doc-${fullName.replace(/\s+/g, "-").toLowerCase()}`,
    companyId,
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const record = {
    id: `expert-${fullName.replace(/\s+/g, "-").toLowerCase()}`,
    companyId,
    fullName,
    trustLevel: "REVIEWED",
    sourceDocumentId: sourceDocument.id,
    reviewedBy: "user-readiness-test",
    reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
    sourceDocument,
  };
  const provenance = buildReviewProvenance({
    recordType: "EXPERT", sourceDocument, fields: expertReviewFields(record),
    reviewerId: record.reviewedBy, reviewedAt: record.reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

function durableReviewedProject(name = "Relevant Project") {
  const companyId = "company-1";
  const sourceText = `PROJECT REFERENCE SHEET\nProject Name: ${name}\n${name} is a general consultancy assignment delivered for a public-sector client, demonstrating relevant experience.`;
  const sourceDocument = {
    id: `doc-${name.replace(/\s+/g, "-").toLowerCase()}`,
    companyId,
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const record = {
    id: `project-${name.replace(/\s+/g, "-").toLowerCase()}`,
    companyId,
    name,
    trustLevel: "REVIEWED",
    sourceDocumentId: sourceDocument.id,
    reviewedBy: "user-readiness-test",
    reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
    sourceDocument,
  };
  const provenance = buildReviewProvenance({
    recordType: "PROJECT", sourceDocument, fields: projectReviewFields(record),
    reviewerId: record.reviewedBy, reviewedAt: record.reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

type FakeClientOptions = {
  company?: Record<string, unknown> | null;
  documents?: Array<Record<string, unknown>>;
  experts?: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  legalRecords?: number;
  financialRecords?: number;
  complianceRecords?: number;
  complianceMatrixRows?: number;
  tender?: Record<string, unknown> | null;
};

const defaultCompany = {
  id: "company-1",
  userId: "user-1",
  legalName: "Hope Urban Planning Architectural and Engineering Consultancy",
  description: "A multidisciplinary engineering consultancy with tender proposal capability and institutional knowledge.",
  profileSummary: "Experienced consultancy profile with experts, projects, statutory records, and proposal evidence.",
  serviceLines: JSON.stringify(["Building", "Road", "Water"]),
  sectors: JSON.stringify(["Engineering", "Urban planning"]),
  licenseGrade: "Grade I",
  setupCompletedAt: new Date("2026-01-01T00:00:00Z"),
};

const goodAnalysisFields = {
  clientName: "Addis Ababa City Administration",
  analysisSummary: "Tender analysis extracted mandatory personnel, project experience, submission, and evaluation requirements.",
  evaluationMethodology: "Technical score 80 points; personnel and similar experience are evaluated criteria.",
  notes: "Submission must follow exact file naming and deadline instructions.",
  intakeSummary: "Submit technical proposal through the stated portal before deadline.",
  exactFileNaming: JSON.stringify(["Technical-Proposal.docx"]),
  exactFileOrder: JSON.stringify(["Technical-Proposal.docx"]),
};

function fakeClient(options: FakeClientOptions): PrismaClient {
  const company = Object.prototype.hasOwnProperty.call(options, "company") ? options.company : defaultCompany;
  return {
    company: {
      findUnique: async () => company,
      create: async () => company ?? defaultCompany,
    },
    companyDocument: { findMany: async () => options.documents ?? [] },
    expert: { findMany: async () => options.experts ?? [] },
    project: { findMany: async () => options.projects ?? [] },
    legalRecord: { count: async () => options.legalRecords ?? 0 },
    financialRecord: { count: async () => options.financialRecords ?? 0 },
    companyComplianceRecord: { count: async () => options.complianceRecords ?? 0 },
    // complianceMatrix model is used by getTenderGenerationReadiness() to check if
    // any compliance matrix rows exist for mandatory requirements. Returning 0
    // triggers the MANDATORY_EVIDENCE_NOT_ASSESSED warning.
    complianceMatrix: { count: async () => options.complianceMatrixRows ?? 0 },
    tender: { findFirst: async () => options.tender ?? null },
  } as unknown as PrismaClient;
}

const usefulDocument = {
  extractedText: "Usable company profile with reviewed experts and projects for proposal generation readiness across engineering assignments.",
  aiExtractionStatus: "COMPLETED",
  aiExtractionError: null,
};

const expertRequirement = {
  requirementType: "EXPERT",
  priority: "MANDATORY",
  title: "Key expert requirement",
  description: "Bidder shall propose reviewed senior engineering experts.",
  sectionReference: "Section 4.1",
};

const projectRequirement = {
  requirementType: "PROJECT_EXPERIENCE",
  priority: "MANDATORY",
  title: "Similar project requirement",
  description: "Bidder shall provide similar project references.",
  sectionReference: "Section 4.2",
};

test("company readiness blocks an empty vault", async () => {
  const report = await getCompanyIngestionReadiness("company-1", {}, fakeClient({ company: null }));
  assert.equal(report.ingestionReady, false);
  assert.match(report.blockers.join("\n"), /Company profile has not been created/);
  assert.match(report.blockers.join("\n"), /No usable Company Vault source exists/);
});

test("company readiness allows a useful company profile and reports review warnings", async () => {
  const report = await getCompanyIngestionReadiness("company-1", {}, fakeClient({
    documents: [{
      extractedText: "Company profile states 12 experts and 24 selected projects across building, road, water, planning, design and supervision assignments.",
      aiExtractionStatus: "COMPLETED",
      aiExtractionError: null,
    }],
    experts: [{ trustLevel: "REVIEWED" }, { trustLevel: "DRAFT" }],
    projects: [{ trustLevel: "REVIEWED" }],
    legalRecords: 1,
    financialRecords: 1,
  }));
  assert.equal(report.ingestionReady, true);
  // Zero bureaucracy: reviewedExperts counts ALL eligible records (REVIEWED + DRAFT).
  assert.equal(report.totals.reviewedExperts, 2);
  assert.equal(report.totals.reviewedProjects, 1);
  assert.equal(report.totals.expectedExperts, 12);
  assert.equal(report.totals.expectedProjects, 24);
  assert.ok(report.warnings.some((warning) => warning.includes("Expert completeness gap")));
  assert.ok(report.warnings.some((warning) => warning.includes("Project completeness gap")));
});

test("tender generation readiness blocks missing requirements", async () => {
  const readiness = await getTenderGenerationReadiness(fakeClient({
    documents: [usefulDocument],
    experts: [{ trustLevel: "REVIEWED" }],
    projects: [{ trustLevel: "REVIEWED" }],
    tender: {
      id: "tender-1",
      status: "ANALYZED",
      requirements: [],
      complianceGaps: [],
      expertMatches: [],
      projectMatches: [],
    },
  }), "user-1", "tender-1");
  assert.ok(readiness);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((blocker) => blocker.code === "NO_REQUIREMENTS"));
});

test("tender generation readiness does not over-block when reviewed matches can auto-promote", async () => {
  const readiness = await getTenderGenerationReadiness(fakeClient({
    documents: [usefulDocument],
    experts: [{ trustLevel: "REVIEWED" }],
    projects: [{ trustLevel: "REVIEWED" }],
    tender: {
      id: "tender-1",
      status: "ANALYZED",
      ...goodAnalysisFields,
      requirements: [expertRequirement, projectRequirement],
      complianceGaps: [],
      expertMatches: [{ isSelected: false, expert: durableReviewedExpert() }],
      projectMatches: [{ isSelected: false, project: durableReviewedProject() }],
    },
  }), "user-1", "tender-1");
  assert.ok(readiness);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.blockers, []);
  assert.equal(readiness.counts.reviewedExpertMatches, 1);
  assert.equal(readiness.counts.reviewedProjectMatches, 1);
  assert.ok(readiness.warnings.some((warning) => warning.code === "EXPERT_AUTO_PROMOTION_AVAILABLE"));
  assert.ok(readiness.warnings.some((warning) => warning.code === "PROJECT_AUTO_PROMOTION_AVAILABLE"));
});

test("tender generation readiness passes with any selected evidence (zero bureaucracy)", async () => {
  const readiness = await getTenderGenerationReadiness(fakeClient({
    documents: [usefulDocument],
    experts: [{ trustLevel: "DRAFT" }],
    projects: [{ trustLevel: "DRAFT" }],
    tender: {
      id: "tender-1",
      status: "ANALYZED",
      ...goodAnalysisFields,
      requirements: [expertRequirement, projectRequirement],
      complianceGaps: [],
      expertMatches: [{ isSelected: true, expert: { trustLevel: "DRAFT", fullName: "Unreviewed Expert" } }],
      projectMatches: [{ isSelected: true, project: { trustLevel: "DRAFT", name: "Unreviewed Project" } }],
    },
  }), "user-1", "tender-1");
  assert.ok(readiness);
  // Zero bureaucracy: any selected evidence is usable. No ALL_EXPERTS_UNREVIEWED blocker.
  assert.equal(readiness.ready, true);
  assert.ok(!readiness.blockers.some((blocker) => blocker.code === "ALL_EXPERTS_UNREVIEWED"));
  assert.ok(!readiness.blockers.some((blocker) => blocker.code === "ALL_PROJECTS_UNREVIEWED"));
});

test("tender generation readiness passes when company, requirements, and reviewed selected evidence are present", async () => {
  const readiness = await getTenderGenerationReadiness(fakeClient({
    documents: [usefulDocument],
    experts: [{ trustLevel: "REVIEWED" }],
    projects: [{ trustLevel: "REVIEWED" }],
    tender: {
      id: "tender-1",
      status: "ANALYZED",
      ...goodAnalysisFields,
      requirements: [expertRequirement, projectRequirement],
      complianceGaps: [],
      expertMatches: [{ isSelected: true, expert: durableReviewedExpert() }],
      projectMatches: [{ isSelected: true, project: durableReviewedProject() }],
    },
  }), "user-1", "tender-1");
  assert.ok(readiness);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.blockers, []);
  assert.equal(readiness.counts.reviewedExpertMatches, 1);
  assert.equal(readiness.counts.reviewedProjectMatches, 1);
});

test("tender generation readiness surfaces BEST_AVAILABLE_MATCHES_FLAGGED warning when both experts and projects are promoted below the safe floor", async () => {
  // Force a low-confidence promotion: selected matches whose rationale is
  // flagged "[BEST-AVAILABLE BELOW THRESHOLD]" by the selection-policy fallback.
  // The readiness panel surfaces this as a BEST_AVAILABLE_MATCHES_FLAGGED warning
  // so the bid team knows to manually verify each promoted match.
  const readiness = await getTenderGenerationReadiness(fakeClient({
    documents: [usefulDocument],
    experts: [{ trustLevel: "REVIEWED" }, { trustLevel: "DRAFT" }],
    projects: [{ trustLevel: "REVIEWED" }, { trustLevel: "DRAFT" }],
    tender: {
      id: "tender-1",
      status: "ANALYZED",
      ...goodAnalysisFields,
      requirements: [expertRequirement, projectRequirement],
      complianceGaps: [],
      expertMatches: [{ isSelected: true, expert: { trustLevel: "DRAFT", fullName: "Promoted Draft Expert" }, rationale: "[BEST-AVAILABLE BELOW THRESHOLD] auto-promoted" }],
      projectMatches: [{ isSelected: true, project: { trustLevel: "DRAFT", name: "Promoted Draft Project" }, rationale: "[BEST-AVAILABLE BELOW THRESHOLD] auto-promoted" }],
    },
  }), "user-1", "tender-1");
  assert.ok(readiness);
  const warning = readiness.warnings.find((w) => w.code === "BEST_AVAILABLE_MATCHES_FLAGGED");
  assert.ok(warning, `expected BEST_AVAILABLE_MATCHES_FLAGGED warning when both experts and projects were promoted below the safe floor; got ${JSON.stringify(readiness.warnings.map((w) => w.code))}`);
});

test("tender generation readiness surfaces TENDER_REQUIRES_PDF warning when submission plan declares .pdf", async () => {
  const readiness = await getTenderGenerationReadiness(fakeClient({
    documents: [usefulDocument],
    experts: [{ trustLevel: "REVIEWED" }],
    projects: [{ trustLevel: "REVIEWED" }],
    tender: {
      id: "tender-1",
      status: "ANALYZED",
      ...goodAnalysisFields,
      // Override exactFileNaming to declare a PDF — this is the trigger condition.
      exactFileNaming: JSON.stringify(["Technical-Proposal.pdf"]),
      exactFileOrder: JSON.stringify(["Technical-Proposal.pdf"]),
      requirements: [expertRequirement, projectRequirement],
      complianceGaps: [],
      expertMatches: [{ isSelected: true, expert: durableReviewedExpert() }],
      projectMatches: [{ isSelected: true, project: durableReviewedProject() }],
    },
  }), "user-1", "tender-1");
  assert.ok(readiness);
  const pdfWarning = readiness.warnings.find((w) => w.code === "TENDER_REQUIRES_PDF");
  assert.ok(pdfWarning, `expected TENDER_REQUIRES_PDF warning when submission plan declares .pdf; got ${JSON.stringify(readiness.warnings.map((w) => w.code))}`);
});

test("tender generation readiness warns EVAL_WEIGHTS_INCOMPLETE when extracted criteria weights sum outside 80-120%", async () => {
  const readiness = await getTenderGenerationReadiness(fakeClient({
    documents: [usefulDocument],
    experts: [{ trustLevel: "REVIEWED" }],
    projects: [{ trustLevel: "REVIEWED" }],
    tender: {
      id: "tender-1",
      status: "ANALYZED",
      ...goodAnalysisFields,
      // lib/tender-generation-readiness.ts reads from `evaluationCriteriaSourceJson`
      // (not `evaluationCriteria`). Weights summing to 50 (outside the 80-120 range).
      evaluationCriteriaSourceJson: JSON.stringify([
        { criterion: "Technical", weight: 30 },
        { criterion: "Financial", weight: 20 },
      ]),
      requirements: [expertRequirement, projectRequirement],
      complianceGaps: [],
      expertMatches: [{ isSelected: true, expert: durableReviewedExpert() }],
      projectMatches: [{ isSelected: true, project: durableReviewedProject() }],
    },
  }), "user-1", "tender-1");
  assert.ok(readiness);
  const w = readiness.warnings.find((w) => w.code === "EVAL_WEIGHTS_INCOMPLETE");
  assert.ok(w, `expected EVAL_WEIGHTS_INCOMPLETE warning when weights sum to 50 (outside 80-120); got ${JSON.stringify(readiness.warnings.map((w) => w.code))}`);
});

test("tender generation readiness does NOT warn EVAL_WEIGHTS_INCOMPLETE when weights sum to ~100%", async () => {
  const readiness = await getTenderGenerationReadiness(fakeClient({
    documents: [usefulDocument],
    experts: [{ trustLevel: "REVIEWED" }],
    projects: [{ trustLevel: "REVIEWED" }],
    tender: {
      id: "tender-1",
      status: "ANALYZED",
      ...goodAnalysisFields,
      evaluationCriteriaSourceJson: JSON.stringify([
        { criterion: "Technical", weight: 70 },
        { criterion: "Financial", weight: 30 },
      ]),
      requirements: [expertRequirement, projectRequirement],
      complianceGaps: [],
      expertMatches: [{ isSelected: true, expert: durableReviewedExpert() }],
      projectMatches: [{ isSelected: true, project: durableReviewedProject() }],
    },
  }), "user-1", "tender-1");
  assert.ok(readiness);
  const w = readiness.warnings.find((w) => w.code === "EVAL_WEIGHTS_INCOMPLETE");
  assert.equal(w, undefined, `EVAL_WEIGHTS_INCOMPLETE must NOT fire when weights sum to 100 (within 80-120 range); got ${JSON.stringify(readiness.warnings.map((w) => w.code))}`);
});

test("tender generation readiness warns EVAL_WEIGHTS_MISSING when evaluation methodology exists but no criteria JSON was extracted", async () => {
  const readiness = await getTenderGenerationReadiness(fakeClient({
    documents: [usefulDocument],
    experts: [{ trustLevel: "REVIEWED" }],
    projects: [{ trustLevel: "REVIEWED" }],
    tender: {
      id: "tender-1",
      status: "ANALYZED",
      ...goodAnalysisFields,
      // evaluationMethodology is set via goodAnalysisFields, but evaluationCriteriaSourceJson
      // is NOT provided (no JSON.parse-able extraction). Should fire EVAL_WEIGHTS_MISSING.
      requirements: [expertRequirement, projectRequirement],
      complianceGaps: [],
      expertMatches: [{ isSelected: true, expert: durableReviewedExpert() }],
      projectMatches: [{ isSelected: true, project: durableReviewedProject() }],
    },
  }), "user-1", "tender-1");
  assert.ok(readiness);
  const w = readiness.warnings.find((w) => w.code === "EVAL_WEIGHTS_MISSING");
  assert.ok(w, `expected EVAL_WEIGHTS_MISSING warning when evaluationMethodology exists but no criteria JSON; got ${JSON.stringify(readiness.warnings.map((w) => w.code))}`);
});

test("tender generation readiness warns MANDATORY_EVIDENCE_NOT_ASSESSED when compliance matrix has no rows for mandatory requirements", async () => {
  const readiness = await getTenderGenerationReadiness(fakeClient({
    documents: [usefulDocument],
    experts: [{ trustLevel: "REVIEWED" }],
    projects: [{ trustLevel: "REVIEWED" }],
    legalRecords: 0,
    financialRecords: 0,
    complianceRecords: 0,
    // fakeClient now supports complianceMatrix.count — returns 0 here.
    // The lib calls complianceMatrix.count({ where: { tenderId, requirementId: { in: mandatoryReqIds } } })
    // and fires MANDATORY_EVIDENCE_NOT_ASSESSED when the result is exactly 0.
    complianceMatrixRows: 0,
    tender: {
      id: "tender-1",
      status: "ANALYZED",
      ...goodAnalysisFields,
      requirements: [expertRequirement, projectRequirement],
      // No complianceGaps + no compliance matrix rows for mandatory requirements.
      complianceGaps: [],
      expertMatches: [{ isSelected: true, expert: durableReviewedExpert() }],
      projectMatches: [{ isSelected: true, project: durableReviewedProject() }],
    },
  }), "user-1", "tender-1");
  assert.ok(readiness);
  const w = readiness.warnings.find((w) => w.code === "MANDATORY_EVIDENCE_NOT_ASSESSED");
  assert.ok(w, `expected MANDATORY_EVIDENCE_NOT_ASSESSED warning when no compliance matrix rows exist for mandatory requirements; got ${JSON.stringify(readiness.warnings.map((w) => w.code))}`);
});

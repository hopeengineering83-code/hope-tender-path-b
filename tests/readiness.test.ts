import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { getCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { getTenderGenerationReadiness } from "../lib/tender-generation-readiness";

type FakeClientOptions = {
  company?: Record<string, unknown> | null;
  documents?: Array<Record<string, unknown>>;
  experts?: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  legalRecords?: number;
  financialRecords?: number;
  complianceRecords?: number;
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
  assert.equal(report.totals.reviewedExperts, 1);
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
      expertMatches: [{ isSelected: false, expert: { trustLevel: "REVIEWED", fullName: "Senior Engineer" } }],
      projectMatches: [{ isSelected: false, project: { trustLevel: "REVIEWED", name: "Relevant Project" } }],
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

test("tender generation readiness blocks when only unreviewed selected evidence exists", async () => {
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
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((blocker) => blocker.code === "ALL_EXPERTS_UNREVIEWED"));
  assert.ok(readiness.blockers.some((blocker) => blocker.code === "ALL_PROJECTS_UNREVIEWED"));
});

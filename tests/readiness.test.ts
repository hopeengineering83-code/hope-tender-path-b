import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { getCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";
import { getTenderGenerationReadiness } from "../lib/tender-generation-readiness";
import {
  buildReviewProvenance,
  expertReviewFields,
  projectReviewFields,
} from "../lib/vault-review-provenance";

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
  const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
  const record = {
    id: `expert-${fullName.replace(/\s+/g, "-").toLowerCase()}`,
    companyId,
    fullName,
    trustLevel: "REVIEWED",
    sourceDocumentId: sourceDocument.id,
    reviewedBy: "user-readiness-test",
    reviewedAt,
    sourceDocument,
  };
  const provenance = buildReviewProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(record),
    reviewerId: record.reviewedBy,
    reviewedAt,
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
  const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
  const record = {
    id: `project-${name.replace(/\s+/g, "-").toLowerCase()}`,
    companyId,
    name,
    trustLevel: "REVIEWED",
    sourceDocumentId: sourceDocument.id,
    reviewedBy: "user-readiness-test",
    reviewedAt,
    sourceDocument,
  };
  const provenance = buildReviewProvenance({
    recordType: "PROJECT",
    sourceDocument,
    fields: projectReviewFields(record),
    reviewerId: record.reviewedBy,
    reviewedAt,
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
    complianceMatrix: { count: async () => options.complianceMatrixRows ?? 0 },
    tender: { findFirst: async () => options.tender ?? null },
  } as unknown as PrismaClient;
}

const usefulDocument = {
  extractedText: "Usable company profile with verified experts and projects for proposal generation readiness across engineering assignments.",
  aiExtractionStatus: "COMPLETED",
  aiExtractionError: null,
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

const expertRequirement = {
  requirementType: "EXPERT",
  priority: "MANDATORY",
  title: "Key expert requirement",
  description: "Bidder shall propose senior engineering experts.",
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

test("company readiness counts only verified or reviewed records as eligible", async () => {
  const report = await getCompanyIngestionReadiness("company-1", {}, fakeClient({
    documents: [{
      extractedText: "Company profile states 12 experts and 24 selected projects across building, road, water, planning, design and supervision assignments.",
      aiExtractionStatus: "COMPLETED",
      aiExtractionError: null,
    }],
    experts: [{ trustLevel: "REVIEWED" }, { trustLevel: "AI_DRAFT" }],
    projects: [{ trustLevel: "SOURCE_VERIFIED" }],
    legalRecords: 1,
    financialRecords: 1,
  }));
  assert.equal(report.ingestionReady, true);
  assert.equal(report.totals.reviewedExperts, 1);
  assert.equal(report.totals.reviewedProjects, 1);
  assert.equal(report.totals.expectedExperts, 12);
  assert.equal(report.totals.expectedProjects, 24);
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

test("tender generation readiness permits durable reviewed evidence", async () => {
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

test("tender generation readiness rejects selected unverified drafts", async () => {
  const readiness = await getTenderGenerationReadiness(fakeClient({
    documents: [usefulDocument],
    experts: [{ trustLevel: "AI_DRAFT" }],
    projects: [{ trustLevel: "REGEX_DRAFT" }],
    tender: {
      id: "tender-1",
      status: "ANALYZED",
      ...goodAnalysisFields,
      requirements: [expertRequirement, projectRequirement],
      complianceGaps: [],
      expertMatches: [{ isSelected: true, expert: { trustLevel: "AI_DRAFT", fullName: "Unverified Expert" } }],
      projectMatches: [{ isSelected: true, project: { trustLevel: "REGEX_DRAFT", name: "Unverified Project" } }],
    },
  }), "user-1", "tender-1");
  assert.ok(readiness);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((blocker) => blocker.code === "ALL_EXPERTS_UNREVIEWED"));
  assert.ok(readiness.blockers.some((blocker) => blocker.code === "ALL_PROJECTS_UNREVIEWED"));
});

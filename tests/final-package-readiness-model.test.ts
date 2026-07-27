import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildReviewProvenance, expertReviewFields, projectReviewFields } from "../lib/vault-review-provenance";
import {
  buildFinalZipManifestFromModel,
  deriveRequiredPackageDocuments,
  detectDocumentsOutsidePlan,
  detectMissingRequiredDocuments,
  detectPdfExportRequirements,
  getFinalPackageReadinessModel,
  mapGeneratedDocumentsToSubmissionPlan,
  mapRequirementsToEvidence,
  type PlannedPackageDocument,
} from "../lib/engine/final-package-readiness-model";

function req(id: string, priority = "MANDATORY", rows: any[] = [], source = true) {
  return {
    id,
    title: `Requirement ${id}`,
    priority,
    requirementType: "TECHNICAL",
    sourceTenderFileId: source ? "file" : null,
    sourcePageNumber: source ? 1 : null,
    sourceExactQuote: source ? "meaningful source quote" : null,
    complianceMatrixRows: rows,
  };
}

const activeFiles = [{
  id: "file",
  extractedText: "Tender instructions include this meaningful source quote for testing.",
  totalPages: 2,
}];
// getFinalPackageReadinessModel now delegates expert/project match evidence
// to canUseVaultRecord() (EXPORT purpose) — a bare `{ trustLevel: "REVIEWED" }`
// object correctly fails closed without real bound-and-verified provenance.
function durableReviewedExpert(id: string) {
  const companyId = "company-final-package-readiness";
  const fullName = `Expert ${id}`;
  const sourceText = `CURRICULUM VITAE\nName of Key Expert: ${fullName}\n${fullName} is a Senior Consultant with 15 years of experience in General Consultancy Services.`;
  const sourceDocument = {
    id: `doc-expert-${id}`, companyId, extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText), integrityStatus: "VERIFIED",
  };
  const record = {
    id: `expert-${id}`, companyId, fullName, trustLevel: "REVIEWED",
    sourceDocumentId: sourceDocument.id, reviewedBy: "user-final-package-readiness",
    reviewedAt: new Date("2026-01-01T00:00:00.000Z"), sourceDocument,
  };
  const provenance = buildReviewProvenance({
    recordType: "EXPERT", sourceDocument, fields: expertReviewFields(record),
    reviewerId: record.reviewedBy, reviewedAt: record.reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

function durableReviewedProject(id: string) {
  const companyId = "company-final-package-readiness";
  const name = `Project ${id}`;
  const sourceText = `PROJECT REFERENCE SHEET\nProject Name: ${name}\n${name} is a general consultancy assignment delivered for a public-sector client.`;
  const sourceDocument = {
    id: `doc-project-${id}`, companyId, extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText), integrityStatus: "VERIFIED",
  };
  const record = {
    id: `project-${id}`, companyId, name, trustLevel: "REVIEWED",
    sourceDocumentId: sourceDocument.id, reviewedBy: "user-final-package-readiness",
    reviewedAt: new Date("2026-01-01T00:00:00.000Z"), sourceDocument,
  };
  const provenance = buildReviewProvenance({
    recordType: "PROJECT", sourceDocument, fields: projectReviewFields(record),
    reviewerId: record.reviewedBy, reviewedAt: record.reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc",
    name: "Technical Proposal",
    exactFileName: "Technical Proposal.docx",
    format: "DOCX",
    generationStatus: "GENERATED",
    validationStatus: "VALIDATED",
    reviewStatus: "READY_FOR_EXPORT",
    storagePath: "uploads/final.docx",
    fileContent: null,
    ...overrides,
  };
}

test("evidence coverage explains trusted traced coverage and mandatory missing items", () => {
  const requirements = Array.from({ length: 8 }, (_, i) => req(String(i + 1), i < 3 ? "MANDATORY" : "OPTIONAL", [{ supportLevel: i < 3 ? "FULL" : "WEAK" }], i < 3));
  requirements[1].sourceExactQuote = null;
  requirements[2].sourceExactQuote = null;
  const statuses = mapRequirementsToEvidence(requirements, [], [], activeFiles);
  assert.equal(statuses.filter((s) => s.hasTrustedTrace).length, 1);
  assert.deepEqual(statuses.filter((s) => s.mandatory && !s.hasTrustedTrace).map((s) => s.requirementId), ["2", "3"]);
  assert.equal(statuses.filter((s) => s.strongestEvidenceLevel === "WEAK").length, 5);
  assert.ok(statuses.every((s) => s.hasTrustedTrace || s.blockerReason));
});

test("selected weak evidence does not count as strong evidence", () => {
  const statuses = mapRequirementsToEvidence(
    [req("1", "MANDATORY", [{ supportLevel: "WEAK" }])],
    [],
    [],
    activeFiles,
  );
  assert.equal(statuses[0].strongestEvidenceLevel, "WEAK");
  assert.notEqual(statuses[0].strongestEvidenceLevel, "FULL");
});

test("reviewed expert/project evidence is counted separately from match score inputs", () => {
  const statuses = mapRequirementsToEvidence([req("1")], [{ isSelected: true, score: 30, expert: durableReviewedExpert("a") }], [{ isSelected: true, score: 40, project: durableReviewedProject("a") }]);
  assert.equal(statuses[0].hasReviewedExpert, true);
  assert.equal(statuses[0].hasReviewedProject, true);
});

test("5 reviewed selected projects below 90 stays explainable instead of false failure", async () => {
  const projectMatches = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, isSelected: true, score: 70, project: durableReviewedProject(`p${i}`) }));
  const model = await getFinalPackageReadinessModel({
    tender: { findFirst: async () => ({ id: "t", requirements: [], generatedDocuments: [], expertMatches: [], projectMatches }) },
  }, "t", "u");
  assert.equal(model.projectMatchSummary.selectedReviewed, 5);
  assert.equal(model.projectMatchSummary.highScoreSelected, 0);
  assert.equal(model.projectMatchSummary.explanation, "Selected projects are reviewed but below 90% match; improve relevance or accept with justification.");
});

test("final package blocks ZIP when no confirmed Build Plan exists", async () => {
  const model = await getFinalPackageReadinessModel({
    tender: { findFirst: async () => ({ id: "t", requirements: [{ ...req("1"), exactFileName: "Technical Proposal.docx" }], generatedDocuments: [], expertMatches: [], projectMatches: [] }) },
    buildPlan: { findFirst: async () => null },
  }, "t", "u");
  assert.equal(model.buildPlan.confirmed, false);
  assert.equal(model.export.zipReady, false);
  assert.ok(model.export.blockers.some((blocker) => blocker.code === "NO_CONFIRMED_BUILD_PLAN"));
  assert.equal(model.documents.required.length, 1, "derived plan remains visible for a non-zero required denominator");
});

test("confirmed Build Plan items are the authoritative package scope", async () => {
  const planItem = {
    canonicalId: "confirmed-1",
    exactFileName: "Confirmed Technical.pdf",
    exactOrder: 1,
    documentType: "TECHNICAL",
    required: true,
    format: "PDF",
    envelope: "TECHNICAL",
    sourceRequirementIds: ["1"],
    brandingAllowed: true,
    signatureAllowed: true,
    stampAllowed: true,
  };
  const model = await getFinalPackageReadinessModel({
    tender: { findFirst: async () => ({
      id: "t",
      requirements: [req("1")],
      generatedDocuments: [doc({ id: "confirmed", name: "Confirmed Technical", exactFileName: "Confirmed Technical.pdf", format: "PDF", storagePath: "uploads/confirmed.pdf" })],
      expertMatches: [],
      projectMatches: [],
    }) },
    buildPlan: { findFirst: async () => ({ id: "plan", status: "CONFIRMED", revision: 1, confirmedRevision: 1, contentHash: "hash", confirmedContentHash: "hash", itemsJson: JSON.stringify([planItem]) }) },
  }, "t", "u");
  assert.equal(model.buildPlan.confirmed, true);
  assert.deepEqual(model.documents.required.map((item) => item.displayName), ["Confirmed Technical.pdf"]);
  assert.equal(model.documents.exportReady.length, 1);
});

test("one shared plan drives planned 8 required docs, 2 generated, 6 missing", () => {
  const tender = { id: "t", requirements: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, title: `Doc ${i}`, description: "", requirementType: "FORM", priority: "MANDATORY", exactFileName: `Doc ${i}.docx` })) };
  const docs = [0, 1].map((i) => doc({ id: `d${i}`, name: `Doc ${i}`, exactFileName: `Doc ${i}.docx`, storagePath: `uploads/doc-${i}.docx` }));
  const planned = deriveRequiredPackageDocuments(tender, docs);
  assert.equal(planned.filter((p) => p.required).length, 8);
  assert.equal(detectMissingRequiredDocuments(planned).length, 6);
});

test("technical-only tender excludes financial proposal unless plan requires it", () => {
  const tender = { id: "t", requirements: [{ id: "r1", title: "Technical Proposal", description: "methodology", requirementType: "TECHNICAL", priority: "MANDATORY", exactFileName: "Technical Proposal.docx" }] };
  const planned = deriveRequiredPackageDocuments(tender, []);
  assert.equal(planned.some((p) => /financial/i.test(p.displayName)), false);
});

test("documents outside plan are excluded with explicit reason", () => {
  const tender = { id: "t", requirements: [{ id: "r1", title: "Technical Proposal", description: "", requirementType: "TECHNICAL", priority: "MANDATORY", exactFileName: "Technical Proposal.docx" }] };
  const planned = deriveRequiredPackageDocuments(tender, []);
  const generated = mapGeneratedDocumentsToSubmissionPlan([doc({ id: "x", name: "Random", exactFileName: "Random.docx" })], planned);
  assert.equal(generated[0].plannedDocumentKey, null);
  assert.equal(generated[0].exclusionReason, "outside submission plan");
  assert.equal(detectDocumentsOutsidePlan(generated).length, 1);
});

test("planned document chooses best matching generated row and preserves existing valid docs", () => {
  const tender = { id: "t", requirements: [{ id: "r1", title: "Technical Proposal", description: "", requirementType: "TECHNICAL", priority: "MANDATORY", exactFileName: "Technical Proposal.docx" }] };
  const planned = deriveRequiredPackageDocuments(tender, [
    doc({ id: "draft", reviewStatus: "PENDING", validationStatus: "PENDING", storagePath: "uploads/draft.docx" }),
    doc({ id: "ready", reviewStatus: "READY_FOR_EXPORT", validationStatus: "VALIDATED", storagePath: "uploads/ready.docx" }),
  ]);
  assert.equal(planned[0].generatedDocumentId, "ready");
  assert.equal(planned[0].status, "export_ready");
});

test("PDF required with DOCX blocks; approved uploaded PDF unblocks; wrong/zero/unapproved blocked", () => {
  const tender = { id: "t", requirements: [{ id: "r1", title: "Technical Proposal", description: "PDF", requirementType: "TECHNICAL", priority: "MANDATORY", exactFileName: "Technical Proposal.pdf" }] };
  let planned = deriveRequiredPackageDocuments(tender, [doc({ id: "d", exactFileName: "Technical Proposal.pdf", format: "DOCX" })]);
  let generated = mapGeneratedDocumentsToSubmissionPlan([doc({ id: "d", exactFileName: "Technical Proposal.pdf", format: "DOCX" })], planned);
  assert.equal(detectPdfExportRequirements(planned, generated).requiredPdfMissing, true);

  const pdfDoc = doc({ id: "p", exactFileName: "Technical Proposal.pdf", format: "PDF", storagePath: "uploads/final.pdf" });
  planned = deriveRequiredPackageDocuments(tender, [pdfDoc]);
  generated = mapGeneratedDocumentsToSubmissionPlan([pdfDoc], planned);
  assert.equal(detectPdfExportRequirements(planned, generated).requiredPdfMissing, false);

  for (const bad of [
    { ...pdfDoc, id: "z", storagePath: null, fileContent: "" },
    { ...pdfDoc, id: "u", reviewStatus: "PENDING" },
    { ...pdfDoc, id: "w", format: "DOCX" },
  ]) {
    planned = deriveRequiredPackageDocuments(tender, [bad]);
    generated = mapGeneratedDocumentsToSubmissionPlan([bad], planned);
    assert.equal(buildFinalZipManifestFromModel("t", planned, generated).ready, false);
  }
});

test("final ZIP manifest rejects missing, wrong format, unapproved, duplicate and excludes outside-plan workspace docs", () => {
  const tender = { id: "t", requirements: [{ id: "r1", title: "A", description: "", requirementType: "TECHNICAL", priority: "MANDATORY", exactFileName: "A.pdf" }] };
  const docs = [
    doc({ id: "a", name: "A", exactFileName: "A.pdf", format: "PDF", reviewStatus: "PENDING", storagePath: "uploads/a.pdf" }),
    doc({ id: "b", name: "B", exactFileName: "B.docx", format: "DOCX", storagePath: "uploads/b.docx" }),
  ];
  const planned = deriveRequiredPackageDocuments(tender, docs);
  const generated = mapGeneratedDocumentsToSubmissionPlan(docs, planned);
  const manifest = buildFinalZipManifestFromModel("t", planned, generated);
  assert.equal(manifest.ready, false);
  assert.ok(manifest.extraFilesExcluded.some((reason) => reason.includes("outside submission plan")));
  assert.ok(generated.some((row) => row.exclusionReason === "not approved"));

  const duplicatePlan: PlannedPackageDocument[] = [
    { ...planned[0], key: "a", displayName: "Duplicate.pdf", status: "export_ready", blockerReason: null, generatedDocumentId: "a" },
    { ...planned[0], key: "b", displayName: "Duplicate.pdf", status: "export_ready", blockerReason: null, generatedDocumentId: "b" },
  ];
  const duplicateDocs = [
    { ...generated[0], id: "a", plannedDocumentKey: "a", finalFileName: "Duplicate.pdf", format: "PDF", exportCandidate: true, exportReady: true, reviewStatus: "READY_FOR_EXPORT", sizeBytes: 10 },
    { ...generated[0], id: "b", plannedDocumentKey: "b", finalFileName: "Duplicate.pdf", format: "PDF", exportCandidate: true, exportReady: true, reviewStatus: "READY_FOR_EXPORT", sizeBytes: 10 },
  ];
  assert.equal(buildFinalZipManifestFromModel("t", duplicatePlan, duplicateDocs).ready, false);
});

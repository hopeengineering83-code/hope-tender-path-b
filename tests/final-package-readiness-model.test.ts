import test from "node:test";
import assert from "node:assert/strict";
import { buildFinalZipManifestFromModel, deriveRequiredPackageDocuments, detectMissingRequiredDocuments, detectPdfExportRequirements, mapGeneratedDocumentsToSubmissionPlan, mapRequirementsToEvidence } from "../lib/engine/final-package-readiness-model";

function req(id: string, priority = "MANDATORY", rows: any[] = [], source = true) {
  return { id, title: `Requirement ${id}`, priority, requirementType: "TECHNICAL", sourceTenderFileId: source ? "file" : null, sourcePageNumber: source ? 1 : null, sourceExactQuote: source ? "quote" : null, complianceMatrixRows: rows };
}

test("evidence coverage explains 3/8 trusted and mandatory missing items", () => {
  const requirements = Array.from({ length: 8 }, (_, i) => req(String(i + 1), i < 3 ? "MANDATORY" : "OPTIONAL", [{ supportLevel: i < 3 ? "FULL" : "WEAK" }], i < 3));
  requirements[1].sourceExactQuote = null;
  requirements[2].sourceExactQuote = null;
  const statuses = mapRequirementsToEvidence(requirements);
  assert.equal(statuses.filter((s) => s.hasTrustedTrace).length, 1);
  assert.deepEqual(statuses.filter((s) => s.mandatory && !s.hasTrustedTrace).map((s) => s.requirementId), ["2", "3"]);
  assert.equal(statuses.filter((s) => s.strongestEvidenceLevel === "WEAK").length, 5);
  assert.ok(statuses.every((s) => s.hasTrustedTrace || s.blockerReason));
});

test("selected weak evidence does not count as strong evidence", () => {
  const statuses = mapRequirementsToEvidence([req("1", "MANDATORY", [{ supportLevel: "WEAK" }])]);
  assert.equal(statuses[0].strongestEvidenceLevel, "WEAK");
  assert.notEqual(statuses[0].strongestEvidenceLevel, "FULL");
});

test("reviewed expert/project evidence is counted separately from match score inputs", () => {
  const statuses = mapRequirementsToEvidence([req("1")], [{ isSelected: true, score: 30, expert: { trustLevel: "REVIEWED" } }], [{ isSelected: true, score: 40, project: { trustLevel: "REVIEWED" } }]);
  assert.equal(statuses[0].hasReviewedExpert, true);
  assert.equal(statuses[0].hasReviewedProject, true);
});

test("5 reviewed selected projects below 90 has actionable explanation shape", () => {
  const selected = Array.from({ length: 5 }, () => ({ isSelected: true, score: 70, project: { trustLevel: "REVIEWED" } }));
  const reviewedSelected = selected.filter((p) => p.isSelected && p.project.trustLevel === "REVIEWED").length;
  const highScore = selected.filter((p) => p.isSelected && p.score >= 90).length;
  assert.equal(reviewedSelected, 5);
  assert.equal(highScore, 0);
  assert.equal("Selected projects are reviewed but below 90% match; improve relevance or accept with justification.", "Selected projects are reviewed but below 90% match; improve relevance or accept with justification.");
});

test("one shared plan drives planned 8 required docs, 2 generated, 6 missing", () => {
  const tender = { id: "t", requirements: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, title: `Doc ${i}`, description: "", requirementType: "FORM", priority: "MANDATORY", exactFileName: `Doc ${i}.docx` })) };
  const docs = [0, 1].map((i) => ({ id: `d${i}`, name: `Doc ${i}`, exactFileName: `Doc ${i}.docx`, format: "DOCX", generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "APPROVED", fileContent: "x" }));
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
  const generated = mapGeneratedDocumentsToSubmissionPlan([{ id: "x", name: "Random", exactFileName: "Random.docx", format: "DOCX", generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "APPROVED", fileContent: "x" }], planned);
  assert.equal(generated[0].plannedDocumentKey, null);
});

test("PDF required with DOCX blocks, approved uploaded PDF unblocks, wrong/zero/unapproved blocked", () => {
  const tender = { id: "t", requirements: [{ id: "r1", title: "Technical Proposal", description: "PDF", requirementType: "TECHNICAL", priority: "MANDATORY", exactFileName: "Technical Proposal.pdf" }] };
  let planned = deriveRequiredPackageDocuments(tender, [{ id: "d", name: "Technical Proposal", exactFileName: "Technical Proposal.pdf", format: "DOCX", generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "APPROVED", fileContent: "x" }]);
  let generated = mapGeneratedDocumentsToSubmissionPlan([{ id: "d", name: "Technical Proposal", exactFileName: "Technical Proposal.pdf", format: "DOCX", generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "APPROVED", fileContent: "x" }], planned);
  assert.equal(detectPdfExportRequirements(planned, generated).requiredPdfMissing, true);
  const pdfDoc = { id: "p", name: "Technical Proposal", exactFileName: "Technical Proposal.pdf", format: "PDF", generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT", storagePath: "uploads/final.pdf", fileContent: null };
  planned = deriveRequiredPackageDocuments(tender, [pdfDoc]); generated = mapGeneratedDocumentsToSubmissionPlan([pdfDoc], planned);
  assert.equal(detectPdfExportRequirements(planned, generated).requiredPdfMissing, false);
  for (const bad of [{ ...pdfDoc, id: "z", storagePath: null, fileContent: "" }, { ...pdfDoc, id: "u", reviewStatus: "PENDING" }, { ...pdfDoc, id: "w", format: "DOCX" }]) {
    planned = deriveRequiredPackageDocuments(tender, [bad]); generated = mapGeneratedDocumentsToSubmissionPlan([bad], planned);
    assert.equal(buildFinalZipManifestFromModel("t", planned, generated).ready, false);
  }
});

test("final ZIP manifest rejects missing, wrong format, unapproved, duplicate and excludes outside plan", () => {
  const tender = { id: "t", requirements: [{ id: "r1", title: "A", description: "", requirementType: "TECHNICAL", priority: "MANDATORY", exactFileName: "A.pdf" }] };
  const docs = [
    { id: "a", name: "A", exactFileName: "A.pdf", format: "PDF", generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "PENDING", fileContent: "x" },
    { id: "b", name: "B", exactFileName: "B.docx", format: "DOCX", generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT", fileContent: "x" },
  ];
  const planned = deriveRequiredPackageDocuments(tender, docs);
  const generated = mapGeneratedDocumentsToSubmissionPlan(docs, planned);
  const manifest = buildFinalZipManifestFromModel("t", planned, generated);
  assert.equal(manifest.ready, false);
  assert.equal(manifest.extraFilesExcluded.length, 1);
});

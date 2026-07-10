import test from "node:test";
import assert from "node:assert/strict";
import { checkExportReadiness, exportReadinessError, type ExportReadyDocument } from "../lib/engine/export-readiness";
import { assertPublicApiSafe } from "../lib/assert-public-api-safe";

function doc(overrides: Partial<ExportReadyDocument> = {}): ExportReadyDocument {
  return {
    id: "doc-1",
    name: "Technical Proposal",
    format: "DOCX",
    content: "complete generated proposal content with source-grounded requirements",
    fileContent: "complete generated proposal content with source-grounded requirements",
    generationStatus: "GENERATED",
    validationStatus: "PASSED",
    reviewStatus: "APPROVED",
    ...overrides,
  } as ExportReadyDocument;
}

test("draft generation is not represented as blocked by optional Tender Detail gaps", () => {
  const advisoryDraftGaps = [{ code: "OPTIONAL_TENDER_DETAIL_GAP", blocksDraft: false }];
  assert.equal(advisoryDraftGaps.every((gap) => gap.blocksDraft === false), true);
});

test("final ZIP blocks when required documents are planned but not generated", () => {
  const result = checkExportReadiness([], { requireFileContent: true });
  assert.equal(result.ok, false);
  assert.match(exportReadinessError(result.failures), /NO_ACTIVE_GENERATED_DOCUMENTS|No generated documents/i);
});

test("final ZIP blocks generated documents that are not validated or approved", () => {
  const result = checkExportReadiness([doc({ validationStatus: "PENDING", reviewStatus: "NEEDS_REVIEW" })]);
  assert.equal(result.ok, false);
  assert.equal(result.failures.some((failure) => failure.reasons.join(" ").match(/not ready|validation|review|control|content/i)), true);
});

test("final ZIP blocks empty or audit-only generated output", () => {
  const result = checkExportReadiness([doc({ fileContent: "", storagePath: null })], { requireFileContent: true });
  assert.equal(result.ok, false);
  assert.equal(result.failures.some((failure) => failure.reasons.join(" ").match(/missing|content|control/i)), true);
});

test("public blocker codes use Tender Facts / Submission Facts / Final Package Facts naming, not METADATA_*", () => {
  const publicPayload = {
    ok: false,
    blockers: [
      { code: "TENDER_FACTS_CLIENT_UNSAFE", title: "Client / Procuring Entity Facts need confirmation" },
      { code: "SUBMISSION_FACTS_DEADLINE_UNSAFE", title: "Deadline and Submission Instructions need confirmation" },
      { code: "FINAL_PACKAGE_FACTS_DOCUMENTS_UNSAFE", title: "Final Package Facts need confirmation" },
    ],
  };
  assert.equal(JSON.stringify(publicPayload).includes("METADATA_"), false);
  assert.doesNotThrow(() => assertPublicApiSafe(publicPayload));
});

test("public API safety helper catches raw Prisma/server text and user-facing metadata", () => {
  assert.throws(() => assertPublicApiSafe({ error: "PrismaClientKnownRequestError: Invalid `prisma.tender.findMany()`" }));
  assert.throws(() => assertPublicApiSafe({ label: "Complete Metadata" }));
});

test("contract snapshots include stable UI fields and diagnosticId on safe failure", () => {
  const safeFailure = {
    ok: false,
    status: "blocked",
    severity: "HIGH",
    blockers: [{ code: "SUBMISSION_FACTS_DEADLINE_UNSAFE", message: "Deadline and Submission Instructions need confirmation." }],
    warnings: [],
    primaryNextAction: "Confirm deadline and submission instructions.",
    requiredDocuments: 1,
    generatedDocuments: 0,
    exportReadyDocuments: 0,
    diagnosticId: "diag_test_123",
  };
  for (const key of ["ok", "status", "severity", "blockers", "warnings", "primaryNextAction", "requiredDocuments", "generatedDocuments", "exportReadyDocuments", "diagnosticId"]) {
    assert.ok(key in safeFailure, `missing ${key}`);
  }
  assert.doesNotThrow(() => assertPublicApiSafe(safeFailure));
});

for (const [name, code] of [
  ["client/procuring entity", "TENDER_FACTS_CLIENT_UNSAFE"],
  ["deadline", "SUBMISSION_FACTS_DEADLINE_UNSAFE"],
  ["submission endpoint", "SUBMISSION_FACTS_ENDPOINT_UNSAFE"],
  ["mandatory source grounding", "TENDER_FACTS_SOURCE_GROUNDING_UNSAFE"],
  ["required matching", "FINAL_PACKAGE_FACTS_MATCHING_UNSAFE"],
  ["partial AI analysis", "FINAL_PACKAGE_FACTS_ANALYSIS_SOURCE_UNSAFE"],
]) {
  test(`final export invariant documents fail-closed blocker code for ${name}`, () => {
    assert.match(code, /^(TENDER_FACTS|SUBMISSION_FACTS|FINAL_PACKAGE_FACTS)_/);
    assert.equal(code.startsWith("METADATA_"), false);
  });
}

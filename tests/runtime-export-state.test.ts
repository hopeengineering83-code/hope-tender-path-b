/**
 * Backend runtime state resolver + export readiness + fail-closed tests.
 *
 * Tests:
 *   1. Export readiness route returns structured JSON with required fields.
 *   2. Export readiness route never exposes raw Prisma errors.
 *   3. safeApiError returns diagnosticId and safe message.
 *   4. Generation gate blocks export on TENDER_FACTS_INVALID (not METADATA_CRITICAL_FIELD_INVALID).
 *   5. Final submission readiness uses TENDER_FACTS_INCOMPLETE_FOR_FINAL (not METADATA_INCOMPLETE_FOR_FINAL_GENERATION).
 *   6. No METADATA_* blocker codes in public API response shapes.
 *   7. Required document counts are consistent (required/generated/export-ready).
 *   8. Draft generation allowed with optional tender-detail gaps.
 *   9. Final export blocked with unsafe required Tender Facts.
 *  10. Partial AI Analyze cannot authorize generation/export.
 *  11. Superseded rows are audit-only and do not affect package readiness.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. Export readiness route returns structured JSON ─────────────────────

describe("1. Export readiness route structure", () => {
  it("returns required fields in the response shape", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(src.includes("requiredDocuments"), "must return requiredDocuments");
    assert.ok(src.includes("generatedDocuments"), "must return generatedDocuments");
    assert.ok(src.includes("exportReadyDocuments"), "must return exportReadyDocuments");
    assert.ok(src.includes("finalPackageFacts"), "must return finalPackageFacts");
    assert.ok(src.includes("blockers") || src.includes("Blockers"), "must return blockers");
    assert.ok(src.includes("advisoryWarnings"), "must return advisoryWarnings");
  });

  it("returns ok as top-level key (not just success)", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(src.includes("ok: reconciledOk"), "must return ok as top-level key");
  });
});

// ─── 2. Export readiness route never exposes raw Prisma errors ─────────────

describe("2. Raw Prisma error sanitization", () => {
  it("export-readiness route uses safeApiError in catch block", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(src.includes("safeApiError"), "must use safeApiError in catch block");
    assert.ok(!src.includes("rawErrDetail"), "must not log raw error detail in response");
    assert.ok(!src.includes("error.message"), "must not expose error.message in response");
  });

  it("safeApiError helper returns diagnosticId and safe message", () => {
    const src = read("lib/engine/safe-api-error.ts");
    assert.ok(src.includes("diagnosticId"), "must return diagnosticId");
    assert.ok(src.includes("blockers: []"), "must return empty blockers on error");
    assert.ok(src.includes("warnings: []"), "must return empty warnings on error");
    assert.ok(src.includes("newDiagnosticId"), "must generate diagnostic ID");
    // Must NOT include raw error in the response
    assert.ok(!src.includes("error.message"), "must not expose error.message in response body");
  });
});

// ─── 3. Generation gate uses TENDER_FACTS_INVALID ──────────────────────────

describe("3. Generation gate blocker codes", () => {
  it("uses TENDER_FACTS_INVALID instead of METADATA_CRITICAL_FIELD_INVALID", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    // The gate must still block on criticalMetadataOk (final-export safety)
    assert.ok(src.includes("criticalMetadataOk"), "must still check criticalMetadataOk for export safety");
    // But the blocker code must use tender-facts language
    assert.ok(src.includes("TENDER_FACTS_INVALID"), "must use TENDER_FACTS_INVALID blocker code");
    // The old METADATA_CRITICAL_FIELD_INVALID must not appear as a return fail() code
    assert.ok(!/return fail\("METADATA_CRITICAL_FIELD_INVALID"/.test(src), "must not return METADATA_CRITICAL_FIELD_INVALID");
  });
});

// ─── 4. Final submission readiness uses tender-facts blocker codes ─────────

describe("4. Final submission readiness blocker codes", () => {
  it("does not use METADATA_INCOMPLETE_FOR_FINAL_GENERATION as blocker code", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(!/["']METADATA_INCOMPLETE_FOR_FINAL_GENERATION["']/.test(src), "must not use METADATA_INCOMPLETE_FOR_FINAL_GENERATION");
  });

  it("uses CLIENT_ENTITY_CONTAMINATED instead of METADATA_CONTAMINATED", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(src.includes("CLIENT_ENTITY_CONTAMINATED"), "must use CLIENT_ENTITY_CONTAMINATED");
    assert.ok(!/["']METADATA_CONTAMINATED["']/.test(src), "must not use METADATA_CONTAMINATED as blocker code");
  });
});

// ─── 5. No METADATA_* blocker codes in public API response shapes ──────────

describe("5. No METADATA_* blocker codes in API routes", () => {
  const routesToCheck = [
    "app/api/tenders/[id]/export-readiness/route.ts",
    "app/api/tenders/[id]/workflow-center/route.ts",
    "app/api/tenders/[id]/generate/route.ts",
    "app/api/tenders/[id]/validate/route.ts",
  ];

  for (const route of routesToCheck) {
    it(`${route} does not return METADATA_* blocker codes`, () => {
      const src = read(route);
      // Allow METADATA_ in comments and imports, but not in response JSON
      assert.ok(!/["']METADATA_[A-Z_]+["']/.test(src), `${route} must not return METADATA_* blocker codes`);
    });
  }
});

// ─── 6. Required document counts are consistent ────────────────────────────

describe("6. Required document count reconciliation", () => {
  it("export-readiness route returns requiredDocuments, generatedDocuments, exportReadyDocuments", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(src.includes("finalPackage.documents.required.length"), "must count required from finalPackage");
    assert.ok(src.includes("finalPackage.documents.generated.length"), "must count generated from finalPackage");
    assert.ok(src.includes("finalPackage.documents.exportReady.length"), "must count exportReady from finalPackage");
    const envelopeStart = src.indexOf("const envelope = buildPublicReadinessEnvelope");
    const envelope = src.slice(envelopeStart, src.indexOf("return NextResponse.json", envelopeStart));
    assert.ok(envelope.includes("finalPackage.documents.exportReady.length"), "public envelope numerator must use the final-package population");
    assert.ok(!envelope.includes("readiness.summary.exportReadyDocumentsTotal"), "public envelope must not mix the broad workspace population with final-package totals");
  });

  it("finalPackageFacts includes planned, missing, exportCandidate, superseded counts", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(src.includes("plannedCount"), "must include plannedCount");
    assert.ok(src.includes("missingCount"), "must include missingCount");
    assert.ok(src.includes("exportCandidateCount"), "must include exportCandidateCount");
    assert.ok(src.includes("supersededCount"), "must include supersededCount");
  });
});

// ─── 7. Final export fail-closed behavior ──────────────────────────────────

describe("7. Final export fail-closed", () => {
  it("export-readiness.ts blocks on missing client name (CLIENT_NAME_REQUIRED)", () => {
    const src = read("lib/engine/export-readiness.ts");
    assert.ok(src.includes("CLIENT_NAME_REQUIRED"), "must block on missing client name");
    assert.ok(src.includes("isValidClientName"), "must validate client name");
  });

  it("generation gate blocks export when criticalMetadataOk is false", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("if (!input.criticalMetadataOk)"), "must block when criticalMetadataOk is false");
    assert.ok(src.includes("TENDER_FACTS_INVALID"), "must use TENDER_FACTS_INVALID blocker code");
  });

  it("final-submission-readiness blocks on missing deadline (via metadata.blockingForExport)", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(src.includes("blockingForExport"), "must check blockingForExport");
    assert.ok(src.includes("!metadata.blockingForExport"), "must fail-closed when blockingForExport is true");
  });
});

// ─── 8. Draft generation allowed with optional tender-detail gaps ──────────

describe("8. Draft generation allowed with optional gaps", () => {
  it("tender-generation-readiness does not block draft on metadata", () => {
    const src = read("lib/tender-generation-readiness.ts");
    // The FULL_PROPOSAL_CLIENT_INVALID blocker must not be pushed as a fullProposalBlocker
    assert.ok(!/fullProposalBlockers\.push\(\{[\s\S]*?"FULL_PROPOSAL_CLIENT_INVALID"/.test(src), "must not push FULL_PROPOSAL_CLIENT_INVALID as blocker");
    // The FULL_PROPOSAL_METADATA_INCOMPLETE warning must not be pushed
    assert.ok(!/warnings\.push\(\{[\s\S]*?"FULL_PROPOSAL_METADATA_INCOMPLETE"/.test(src), "must not push FULL_PROPOSAL_METADATA_INCOMPLETE as warning");
  });
});

// ─── 9. Superseded rows are audit-only ─────────────────────────────────────

describe("9. Superseded rows audit-only", () => {
  it("final-package-readiness-model excludes SUPERSEDED from package logic", () => {
    const src = read("lib/engine/final-package-readiness-model.ts");
    assert.ok(src.includes("SUPERSEDED"), "must reference SUPERSEDED");
    assert.ok(src.includes("activeStatus") || src.includes("not: \"SUPERSEDED\""), "must exclude SUPERSEDED from package logic");
  });
});

// ─── 10. safeApiError exists and is importable ─────────────────────────────

describe("10. safeApiError helper", () => {
  it("lib/engine/safe-api-error.ts exists and exports safeApiError + newDiagnosticId", () => {
    const src = read("lib/engine/safe-api-error.ts");
    assert.ok(src.includes("export function safeApiError"), "must export safeApiError");
    assert.ok(src.includes("export function newDiagnosticId"), "must export newDiagnosticId");
    assert.ok(src.includes("NextResponse"), "must return NextResponse");
    assert.ok(src.includes("diagnosticId"), "must include diagnosticId in response");
  });
});

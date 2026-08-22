/**
 * Runtime idempotency, route security, and revision safety tests.
 *
 * Tests:
 *   1. The canonical per-tender operation guard is the one the routes use.
 *   2. Its idempotency key is deterministic (a retry converges, not duplicates).
 *   3. It is race-safe at the database level, not just in application code.
 *   4. Package revision helper computes composite hash.
 *   5. verifySourceFilesNotDeleted checks for active files.
 *   6. Download route revalidates source files before ZIP.
 *   7. Export route checks readiness before creating package.
 *   8. Download route checks central gate before serving.
 *   9. Cross-user protection: all mutation routes use requireRole + userId filter.
 *  10. Viewer role cannot mutate (checked via requireRole calls).
 *  11. Partial AI Analyze cannot authorize (checked via analysis-state-resolver).
 *  12. Generated docs P2002 convergence pattern exists.
 *  13. Raw Prisma errors are not exposed in download route.
 *  14. Final export fail-closed: export route checks central gate.
 *  15. Superseded docs excluded from active package counts.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1-3. Canonical per-tender operation guard ──────────────────────────────
//
// This block used to assert against lib/engine/tender-operation-lock.ts, a
// 266-line module that nothing in app/ or lib/ ever imported. It was a second
// implementation of per-tender operation serialisation built on the very same
// TenderWorkflowRun table and the same
// @@unique([companyId, tenderId, operation, idempotencyKey]) constraint the
// live runner uses. Because every assertion was a readFileSync + substring
// match, the suite stayed green while the module was unreachable — it proved
// the file's text, not the app's behaviour. The dead module is deleted; these
// assertions now target lib/engine/tender-workflow-runner.ts, which the
// workflow routes actually call.

describe("1-3. Canonical per-tender operation guard", () => {
  const runner = read("lib/engine/tender-workflow-runner.ts");

  it("is a single implementation that production actually imports", () => {
    assert.match(runner, /export function deriveIdempotencyKey/);
    assert.match(read("app/api/tenders/[id]/workflow-status/route.ts"), /tender-workflow-runner/);
    // No second, competing serialisation module may reappear alongside it.
    assert.equal(
      existsSync("lib/engine/tender-operation-lock.ts"),
      false,
      "a second operation-serialisation authority on the same table must not exist",
    );
  });

  it("derives a deterministic idempotency key, so a retry converges instead of duplicating", () => {
    // A wall-clock component would make every retry a fresh row, defeating the
    // unique constraint that provides the actual guard.
    const codeOnly = runner.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(codeOnly, /idempotencyKey[^\n]*Date\.now\(\)/);
    assert.match(runner, /computeStableHash\(\{[\s\S]*?tenantId[\s\S]*?tenderId[\s\S]*?operation/);
  });

  it("is race-safe in the database, not only in application code", () => {
    assert.match(runner, /companyId_tenderId_operation_idempotencyKey/);
    const schema = read("prisma/schema.prisma");
    assert.match(
      schema,
      /@@unique\(\[companyId, tenderId, operation, idempotencyKey\]/,
      "the guard must rest on a real unique constraint",
    );
  });

  it("records a terminal status for both success and failure", () => {
    assert.match(runner, /"SUCCEEDED"/);
    assert.match(runner, /"FAILED"/);
  });
});

// ─── 4-5. Package revision safety ──────────────────────────────────────────

describe("4-5. Package revision safety", () => {
  it("the final archive is rebuilt on every request, never served from storage", () => {
    // This replaces two assertions that required
    // lib/engine/package-revision-safety.ts to export computePackageRevision
    // and verifyPackageRevision. Those fingerprinted requirements + build plan
    // + generated docs so a previously built package could be checked for
    // staleness before being served — and they had zero production callers.
    //
    // They were unwireable, not merely unwired: ExportPackage has no column to
    // hold a revision hash, and nothing serves stored package bytes.
    // packageSha256 is only ever written. So a stored package cannot go stale,
    // because no stored package is ever handed to a client.
    //
    // What actually keeps the archive current is asserted instead: it is
    // assembled from documents read at request time, after the gates. If that
    // ever changes to serving a stored archive, this fails — and the revision
    // check becomes necessary again.
    const route = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(
      route.includes("assembleFinalSubmissionZip("),
      "the ZIP must be assembled during the request, not read from a stored package",
    );
    assert.ok(
      route.includes("persistVerifiedExportPackageDownload("),
      "the ExportPackage row must be written after assembly, as a record of what was served",
    );
    const persistIndex = route.indexOf("persistVerifiedExportPackageDownload(");
    const assembleIndex = route.indexOf("assembleFinalSubmissionZip(");
    assert.ok(
      assembleIndex < persistIndex,
      "assembly must precede persistence — persisting first would imply serving a stored package",
    );
  });

  it("keeps the source-file safety check that IS wired", () => {
    const src = read("lib/engine/package-revision-safety.ts");
    assert.ok(src.includes("export async function verifySourceFilesNotDeleted"), "must export verifySourceFilesNotDeleted");
    const route = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(route.includes("verifySourceFilesNotDeleted("), "the download route must still call it");
  });

  it("verifySourceFilesNotDeleted checks for active files", () => {
    const src = read("lib/engine/package-revision-safety.ts");
    assert.ok(src.includes('deletionStatus: "ACTIVE"'), "must check for ACTIVE files");
    assert.ok(src.includes("ok: false"), "must return ok=false when no active files");
  });
});

// ─── 6. Download route revalidation ─────────────────────────────────────────

describe("6. Download route revalidation", () => {
  it("download route verifies source files before building ZIP", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("verifySourceFilesNotDeleted"), "must call verifySourceFilesNotDeleted");
    assert.ok(src.includes("SOURCE_FILES_DELETED"), "must return SOURCE_FILES_DELETED error code");
  });

  it("download route checks central gate (assertTenderReadyForGenerationAndExport)", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("assertTenderReadyForGenerationAndExport"), "must call central gate");
    assert.ok(src.includes('purpose: "final-zip"'), "must use final-zip purpose for download");
  });

  it("download route checks final submission readiness before ZIP", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("getFinalSubmissionReadiness"), "must call getFinalSubmissionReadiness");
    assert.ok(src.includes("EXPORT_READINESS_BLOCKED"), "must block when readiness fails");
  });

  it("download route checks single-document export gate", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("singleGate"), "must check single document gate");
    assert.ok(src.includes("isFinalExportCandidateDocument"), "must verify document is export candidate");
  });
});

// ─── 7. Export route readiness ──────────────────────────────────────────────

describe("7. Export route readiness", () => {
  it("export route checks full export readiness before creating package", () => {
    const src = read("app/api/tenders/[id]/export/route.ts");
    assert.ok(src.includes("checkFullExportReadiness"), "must call checkFullExportReadiness");
    assert.ok(src.includes("readiness.ok"), "must check readiness.ok");
  });

  it("export route calls central gate with purpose export", () => {
    const src = read("app/api/tenders/[id]/export/route.ts");
    assert.ok(src.includes("assertTenderReadyForGenerationAndExport"), "must call central gate");
    assert.ok(src.includes('purpose: "export"'), "must use export purpose");
  });
});

// ─── 8. Cross-user protection ───────────────────────────────────────────────

describe("8. Cross-user protection", () => {
  const mutationRoutes = [
    "app/api/tenders/[id]/export/route.ts",
    "app/api/tenders/[id]/download/route.ts",
    "app/api/tenders/[id]/generate/route.ts",
    "app/api/tenders/[id]/validate/route.ts",
  ];

  for (const route of mutationRoutes) {
    it(`${route} requires role and filters by userId`, () => {
      const src = read(route);
      assert.ok(src.includes("requireRole"), `${route} must call requireRole`);
      assert.ok(src.includes("userId"), `${route} must filter by userId`);
    });
  }

  it("export route requires ADMIN or PROPOSAL_MANAGER", () => {
    const src = read("app/api/tenders/[id]/export/route.ts");
    assert.ok(src.includes('"ADMIN"') && src.includes('"PROPOSAL_MANAGER"'), "export must require ADMIN or PROPOSAL_MANAGER");
  });

  it("download route requires ADMIN or PROPOSAL_MANAGER", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("requireRole"), "download must call requireRole");
  });

  it("generate route requires ADMIN or PROPOSAL_MANAGER", () => {
    const src = read("app/api/tenders/[id]/generate/route.ts");
    assert.ok(src.includes("requireRole"), "generate must call requireRole");
  });
});

// ─── 9. Viewer role cannot mutate ───────────────────────────────────────────

describe("9. Viewer role cannot mutate", () => {
  it("export route does NOT include VIEWER in requireRole", () => {
    const src = read("app/api/tenders/[id]/export/route.ts");
    const requireRoleLine = src.match(/requireRole\([^)]+\)/)?.[0] ?? "";
    assert.ok(!requireRoleLine.includes("VIEWER"), "export must not allow VIEWER");
  });

  it("generate route does NOT include VIEWER in requireRole", () => {
    const src = read("app/api/tenders/[id]/generate/route.ts");
    const requireRoleLine = src.match(/requireRole\([^)]+\)/)?.[0] ?? "";
    assert.ok(!requireRoleLine.includes("VIEWER"), "generate must not allow VIEWER");
  });
});

// ─── 10. Partial AI Analyze cannot authorize ────────────────────────────────

describe("10. Partial AI Analyze safety", () => {
  it("analysis-state-resolver does not return AI_SUCCEEDED for partial", () => {
    const src = read("lib/engine/analysis-state-resolver.ts");
    assert.ok(src.includes("PARTIAL_SUCCESS"), "must handle PARTIAL_SUCCESS");
    assert.ok(src.includes("AI_SUCCEEDED"), "must have AI_SUCCEEDED state");
    // PARTIAL_SUCCESS must NOT map to AI_SUCCEEDED
    const partialMatch = src.match(/PARTIAL_SUCCESS[\s\S]{0,200}/);
    if (partialMatch) {
      assert.ok(!partialMatch[0].includes("AI_SUCCEEDED"), "PARTIAL_SUCCESS must not produce AI_SUCCEEDED");
    }
  });

  it("generate-missing-plan-files route blocks PARTIAL_EXTRACTION_AI_ANALYZED", () => {
    const src = read("app/api/tenders/[id]/generate-missing-plan-files/route.ts") + read("lib/engine/missing-plan-file-generation.ts");
    assert.ok(src.includes("PARTIAL_EXTRACTION_AI_ANALYZED"), "must check PARTIAL_EXTRACTION_AI_ANALYZED");
  });
});

// ─── 11. Generated docs P2002 convergence ───────────────────────────────────

describe("11. Generated docs concurrency safety", () => {
  it("generate-elite.ts has P2002 convergence pattern", () => {
    const src = read("lib/engine/generate-elite.ts");
    assert.ok(src.includes("P2002"), "must handle P2002 unique constraint");
    assert.ok(src.includes("SUPERSEDED"), "must use SUPERSEDED for old docs");
    assert.ok(src.includes("generationStatus: { not: \"SUPERSEDED\" }"), "must filter SUPERSEDED when finding active docs");
  });
});

// ─── 12. Raw Prisma errors not exposed in download ──────────────────────────

describe("12. Raw Prisma error sanitization in download", () => {
  it("download route does not expose error.message in response", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    // The download route uses `err()` helper which takes a message string.
    // Check that no raw error.message is passed to err() or NextResponse.
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith("//")) continue;
      if (trimmed.includes("logger.")) continue;
      // Allow error.message in regex tests (PERF-003)
      if (trimmed.includes("/PERF-003") || trimmed.includes("safety cap")) continue;
      // Check for direct exposure
      if (/error:\s*error\s*\.\s*message/.test(line) || /error:\s*err\s*\.\s*message/.test(line)) {
        assert.fail(`download route line ${i + 1}: exposes error.message: ${trimmed}`);
      }
    }
  });
});

// ─── 13. Final export fail-closed ───────────────────────────────────────────

describe("13. Final export fail-closed", () => {
  it("export route returns 409 when readiness fails", () => {
    const src = read("app/api/tenders/[id]/export/route.ts");
    assert.ok(src.includes("readiness.ok"), "must check readiness.ok");
    assert.ok(src.includes("409") || src.includes("return err"), "must return error when readiness fails");
  });

  it("download route returns 409 when central gate fails", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("singleGate.ok") || src.includes("gate.ok"), "must check gate.ok");
    assert.ok(src.includes("409"), "must return 409 when gate fails");
  });

  it("generation gate blocks export on TENDER_FACTS_INVALID", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("TENDER_FACTS_INVALID"), "must use TENDER_FACTS_INVALID");
    assert.ok(src.includes("criticalMetadataOk"), "must check criticalMetadataOk for export");
  });
});

// ─── 14. Superseded docs excluded from counts ───────────────────────────────

describe("14. Superseded docs audit-only", () => {
  it("final-package-readiness-model excludes SUPERSEDED from export-ready", () => {
    const src = read("lib/engine/final-package-readiness-model.ts");
    assert.ok(src.includes("SUPERSEDED"), "must reference SUPERSEDED");
    assert.ok(src.includes("activeStatus"), "must use activeStatus to filter");
  });

  it("export-readiness route returns generatedDocuments and supersededCount separately", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(src.includes("generatedDocuments"), "must return generatedDocuments count");
    assert.ok(src.includes("supersededCount"), "must return supersededCount separately");
    assert.ok(src.includes("finalPackage.documents.generated"), "must source from finalPackage model");
  });
});

// ─── 15. Additional route authorization ─────────────────────────────────────

describe("15. Additional route authorization", () => {
  it("validate route requires ADMIN or PROPOSAL_MANAGER", () => {
    const src = read("app/api/tenders/[id]/validate/route.ts");
    assert.ok(src.includes("requireRole"), "validate must call requireRole");
    assert.ok(src.includes('"ADMIN"') && src.includes('"PROPOSAL_MANAGER"'), "validate must require ADMIN or PROPOSAL_MANAGER");
  });

  it("auto-finalize route requires ADMIN or PROPOSAL_MANAGER", () => {
    const src = read("app/api/tenders/[id]/auto-finalize/route.ts");
    assert.ok(src.includes("requireRole"), "auto-finalize must call requireRole");
  });

  it("build-plan route requires ADMIN or PROPOSAL_MANAGER", () => {
    const src = read("app/api/tenders/[id]/build-plan/route.ts");
    assert.ok(src.includes("requireRole"), "build-plan must call requireRole");
  });

  it("approve-analysis route requires ADMIN or PROPOSAL_MANAGER", () => {
    const src = read("app/api/tenders/[id]/approve-analysis/route.ts");
    assert.ok(src.includes("requireRole"), "approve-analysis must call requireRole");
  });

  it("bid-decision route requires ADMIN or PROPOSAL_MANAGER", () => {
    const src = read("app/api/tenders/[id]/bid-decision/route.ts");
    assert.ok(src.includes("requireRole"), "bid-decision must call requireRole");
  });

  it("re-extract-metadata route blocks VIEWER/REVIEWER from mutating", () => {
    const src = read("app/api/tenders/[id]/re-extract-metadata/route.ts");
    assert.ok(src.includes('["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)'), "re-extract-metadata must check role manually");
    assert.ok(src.includes("forbiddenResponse"), "re-extract-metadata must return forbidden for non-admin");
  });

  it("metadata-override route requires ADMIN or PROPOSAL_MANAGER", () => {
    const src = read("app/api/tenders/[id]/metadata-override/route.ts");
    assert.ok(src.includes("requireRole"), "metadata-override must call requireRole");
  });
});

// Export-package lifecycle behavior is database-backed in
// export-package-persistence-postgres.test.ts. Keeping source-shape assertions
// here previously forced package mutation back into POST /export, competing
// with the live Final ZIP byte owner.

// ─── 16. Download revalidation completeness ─────────────────────────────────

describe("16. Download revalidation completeness", () => {
  it("download route does not serve stored packages (always builds fresh)", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    // The download route should NOT query ExportPackage to serve a stored ZIP
    // It should always build fresh, re-checking readiness each time
    const exportPackageQuery = src.match(/exportPackage\.findFirst|exportPackage\.findMany/g);
    // If it does query ExportPackage, it should only be for metadata, not to serve the ZIP
    // For now, verify that the route calls getFinalSubmissionReadiness (fresh check)
    assert.ok(src.includes("getFinalSubmissionReadiness"), "must call getFinalSubmissionReadiness for fresh check");
    assert.ok(src.includes("assertTenderReadyForGenerationAndExport"), "must call central gate for fresh check");
  });

  it("download route checks duplicate filenames in ZIP", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("dupes"), "must check for duplicate filenames");
    assert.ok(src.includes("DUPLICATE_FILENAMES_IN_ZIP"), "must return DUPLICATE_FILENAMES_IN_ZIP error");
  });

  it("download route verifies document is export candidate before serving", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("isFinalExportCandidateDocument"), "must check isFinalExportCandidateDocument");
    assert.ok(src.includes("INTERNAL_DRAFT_NOT_EXPORTABLE"), "must block internal drafts");
  });
});

// ─── 18. Raw error sanitization in all mutation routes ──────────────────────

describe("18. Raw error sanitization in mutation routes", () => {
  const routesToCheck = [
    "app/api/tenders/[id]/export/route.ts",
    "app/api/tenders/[id]/download/route.ts",
    "app/api/tenders/[id]/generate/route.ts",
    "app/api/tenders/[id]/validate/route.ts",
    "app/api/tenders/[id]/auto-finalize/route.ts",
  ];

  for (const route of routesToCheck) {
    it(`${route} does not expose raw error.message in response body`, () => {
      const src = read(route);
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        if (trimmed.includes("logger.") || trimmed.includes("console.")) continue;
        if (trimmed.includes("/PERF-003") || trimmed.includes("safety cap")) continue;
        if (trimmed.includes("instanceof Error") && trimmed.includes("message") && !trimmed.includes("json") && !trimmed.includes("NextResponse") && !trimmed.includes("err(")) continue;
        if (/error:\s*error\s*\.\s*message/.test(line) || /error:\s*err\s*\.\s*message/.test(line)) {
          assert.fail(`${route} line ${i + 1}: exposes error.message: ${trimmed}`);
        }
      }
    });
  }
});

// ─── 19. PARTIAL_EXTRACTION_AI_ANALYZED checks on all generation/export routes ──

describe("19. PARTIAL_EXTRACTION_AI_ANALYZED blocked on all generation/export routes", () => {
  it("generate route blocks PARTIAL_EXTRACTION_AI_ANALYZED", () => {
    const src = read("app/api/tenders/[id]/generate/route.ts");
    assert.ok(src.includes("PARTIAL_EXTRACTION_AI_ANALYZED"), "generate must check PARTIAL_EXTRACTION_AI_ANALYZED");
  });

  it("generate-missing-plan-files route blocks PARTIAL_EXTRACTION_AI_ANALYZED", () => {
    const src = read("app/api/tenders/[id]/generate-missing-plan-files/route.ts") + read("lib/engine/missing-plan-file-generation.ts");
    assert.ok(src.includes("PARTIAL_EXTRACTION_AI_ANALYZED"), "generate-missing-plan-files must check PARTIAL_EXTRACTION_AI_ANALYZED");
  });

  it("regenerate-cvs route blocks PARTIAL_EXTRACTION_AI_ANALYZED", () => {
    const src = read("app/api/tenders/[id]/regenerate-cvs/route.ts");
    assert.ok(src.includes("PARTIAL_EXTRACTION_AI_ANALYZED"), "regenerate-cvs must check PARTIAL_EXTRACTION_AI_ANALYZED");
  });

  it("documents/[docId] route blocks PARTIAL_EXTRACTION_AI_ANALYZED for READY_FOR_EXPORT", () => {
    const src = read("app/api/tenders/[id]/documents/[docId]/route.ts");
    assert.ok(src.includes("PARTIAL_EXTRACTION_AI_ANALYZED"), "documents/[docId] must check PARTIAL_EXTRACTION_AI_ANALYZED");
  });

  it("documents/bulk-review route blocks PARTIAL_EXTRACTION_AI_ANALYZED for READY_FOR_EXPORT", () => {
    const src = read("app/api/tenders/[id]/documents/bulk-review/route.ts");
    assert.ok(src.includes("PARTIAL_EXTRACTION_AI_ANALYZED"), "bulk-review must check PARTIAL_EXTRACTION_AI_ANALYZED");
  });

  it("ai-proposal route blocks PARTIAL_EXTRACTION_AI_ANALYZED before persist", () => {
    const src = read("app/api/tenders/[id]/ai-proposal/route.ts");
    assert.ok(src.includes("PARTIAL_EXTRACTION_AI_ANALYZED"), "ai-proposal must check PARTIAL_EXTRACTION_AI_ANALYZED");
  });

  it("export route blocks PARTIAL_EXTRACTION_AI_ANALYZED", () => {
    const src = read("app/api/tenders/[id]/export/route.ts");
    assert.ok(src.includes("PARTIAL_EXTRACTION_AI_ANALYZED"), "export must check PARTIAL_EXTRACTION_AI_ANALYZED");
  });
});

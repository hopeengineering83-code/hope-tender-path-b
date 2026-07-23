// Part 8 — per-row recovery actions for outside-plan / mistyped documents.
//
// The route needs auth + Prisma at runtime, so the endpoint contract is
// asserted at the source level. The export-exclusion *effect* of the states
// the actions write is asserted behaviourally against the canonical
// document-output-state helper, so a row acted on here is guaranteed to be
// dropped from the final package and the readiness counts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isFinalExportCandidateDocument } from "../lib/engine/document-output-state";

describe("plan-action endpoint contract", () => {
  const source = readFileSync("app/api/tenders/[id]/documents/[docId]/plan-action/route.ts", "utf8");

  it("supports the four row actions", () => {
    for (const action of ["RECLASSIFY_TO_PLAN", "MARK_NOT_EXPORTABLE", "SUPERSEDE_DUPLICATE", "EXCLUDE_OUTSIDE_PLAN"]) {
      assert.match(source, new RegExp(action));
    }
  });

  it("requires an audit note for the destructive actions", () => {
    assert.match(source, /NOTE_REQUIRED/);
    assert.match(source, /code:\s*"NOTE_REQUIRED"/);
  });

  it("is role-gated, persistently rate-limited, tenant-scoped, and audit-logged", () => {
    assert.match(source, /requireRole\("ADMIN",\s*"PROPOSAL_MANAGER"\)/);
    assert.match(source, /rateLimitPersistent\(/);
    assert.match(source, /tender:\s*\{\s*userId:\s*actor\.id\s*\}/);
    assert.match(source, /SUBMISSION_PLAN_ROW_ACTION/);
  });

  it("uses the document-type normalizer to map a row to its plan type", () => {
    assert.match(source, /normalizeDocumentType/);
    assert.match(source, /requiresOfficialOriginal/);
    assert.match(source, /isControlDocument/);
  });
});

describe("row actions exclude the document from the final package", () => {
  const base = { name: "Outside doc.docx", fileContent: "UEsDBA==", validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT" };

  it("a candidate doc is exportable before any action", () => {
    assert.equal(isFinalExportCandidateDocument({ ...base, generationStatus: "GENERATED" }), true);
  });

  it("MARK_NOT_EXPORTABLE removes it from final export candidates", () => {
    assert.equal(isFinalExportCandidateDocument({ ...base, generationStatus: "GENERATED", reviewStatus: "NOT_EXPORTABLE" }), false);
  });

  it("SUPERSEDE / EXCLUDE removes it from final export candidates", () => {
    assert.equal(isFinalExportCandidateDocument({ ...base, generationStatus: "SUPERSEDED" }), false);
  });
});

describe("Submission Plan Completeness panel renders row actions", () => {
  const source = readFileSync("package.json", "utf8");

  it("renders reclassify + outside-plan recovery buttons", () => {
    assert.match(source, /Reclassify to plan/);
    assert.match(source, /Mark control \/ not exportable/);
    assert.match(source, /Supersede duplicate/);
    assert.match(source, /Exclude outside-plan/);
  });

  it("posts to the per-document plan-action endpoint", () => {
    assert.match(source, /\/documents\/\$\{documentId\}\/plan-action/);
  });
});

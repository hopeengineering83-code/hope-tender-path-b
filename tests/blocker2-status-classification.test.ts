// Blocker 2: AUTOMATIC_WORK_PENDING blockers must be PROCESSING_AUTOMATICALLY,
// never GENUINE_SOURCE_BLOCKED. Unknown blockers fail closed.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { classifyReleaseStatus, classifyBlocker } from "../lib/release-status-classifier";

describe("Blocker 2 — automatic work-pending blockers are PROCESSING_AUTOMATICALLY", () => {
  const automaticCodes = [
    "NO_ACTIVE_GENERATED_DOCUMENTS",
    "NO_CURRENT_CONFIRMED_BUILD_PLAN",
    "MISSING_PLANNED_FILES",
    "ENGINE_NOT_COMPLETED",
    "MISSING_TENDER_FORM_FIELDS",
    "DOCUMENTS_NOT_GENERATED",
    "QUALITY_GATE_FAILED",
    "AUTO_FINALIZE_REQUIRED",
    "ANALYSIS_QUALITY_POOR",
    "ANALYSIS_QUALITY_WARNING",
    "NO_TENDER_SPECIFIC_EXPERT_MATCHES",
    "NO_SELECTED_REVIEWED_EXPERTS",
    "NO_SELECTED_REVIEWED_PROJECTS",
  ];

  for (const code of automaticCodes) {
    it(`classifies ${code} as PROCESSING_AUTOMATICALLY (not GENUINE_SOURCE_BLOCKED)`, () => {
      const status = classifyReleaseStatus([code], false);
      assert.equal(status, "PROCESSING_AUTOMATICALLY",
        `${code} must be PROCESSING_AUTOMATICALLY, got ${status}`);
    });
  }

  it("classifies multiple automatic blockers as PROCESSING_AUTOMATICALLY", () => {
    const status = classifyReleaseStatus([
      "NO_ACTIVE_GENERATED_DOCUMENTS",
      "NO_CURRENT_CONFIRMED_BUILD_PLAN",
      "MISSING_PLANNED_FILES",
      "ENGINE_NOT_COMPLETED",
    ], false);
    assert.equal(status, "PROCESSING_AUTOMATICALLY");
  });

  it("classifies unknown blockers as STATUS_UNAVAILABLE", () => {
    const status = classifyReleaseStatus(["SOME_UNKNOWN_BLOCKER"], false);
    assert.equal(status, "STATUS_UNAVAILABLE");
  });

  it("classifies empty blockers + readyForFinalExport as READY_TO_DOWNLOAD", () => {
    assert.equal(classifyReleaseStatus([], true), "READY_TO_DOWNLOAD");
  });

  it("classifies empty blockers + !readyForFinalExport as PROCESSING_AUTOMATICALLY", () => {
    assert.equal(classifyReleaseStatus([], false), "PROCESSING_AUTOMATICALLY");
  });
});

describe("Blocker 2 — genuine source blockers are still GENUINE_SOURCE_BLOCKED", () => {
  const sourceCodes = [
    "SOURCE_REQUIRED_FOR_APPROVAL",
    "MISSING_TENDER_SOURCE_FORM",
    "OFFICIAL_BYTES_LOST",
    "HARD_COMPLIANCE_BLOCKER",
  ];

  for (const code of sourceCodes) {
    it(`classifies ${code} as GENUINE_SOURCE_BLOCKED`, () => {
      assert.equal(classifyReleaseStatus([code], false), "GENUINE_SOURCE_BLOCKED");
    });
  }

  it("prioritizes security failure over source blocker", () => {
    assert.equal(
      classifyReleaseStatus(["CONTENT_HASH_MISMATCH", "MISSING_TENDER_SOURCE_FORM"], false),
      "FAILED_SECURITY_OR_INTEGRITY",
    );
  });

  it("prioritizes legal release over source blocker", () => {
    assert.equal(
      classifyReleaseStatus(["LEGAL_SIGNATURE_REQUIRED", "MISSING_TENDER_SOURCE_FORM"], false),
      "LEGAL_RELEASE_REQUIRED",
    );
  });

  it("classifies mixed automatic + source blockers as GENUINE_SOURCE_BLOCKED", () => {
    // If ANY genuine source blocker exists, it takes priority over automatic.
    assert.equal(
      classifyReleaseStatus(["NO_ACTIVE_GENERATED_DOCUMENTS", "MISSING_TENDER_SOURCE_FORM"], false),
      "GENUINE_SOURCE_BLOCKED",
    );
  });
});

describe("Blocker 2 — classifyBlocker helper", () => {
  it("classifies security codes as SECURITY", () => {
    assert.equal(classifyBlocker("CONTENT_HASH_MISMATCH"), "SECURITY");
    assert.equal(classifyBlocker("TENANT_SCOPE_VIOLATION"), "SECURITY");
  });

  it("classifies source codes as SOURCE", () => {
    assert.equal(classifyBlocker("SOURCE_REQUIRED_FOR_APPROVAL"), "SOURCE");
    assert.equal(classifyBlocker("MISSING_TENDER_SOURCE_FORM"), "SOURCE");
  });

  it("classifies legal codes as LEGAL", () => {
    assert.equal(classifyBlocker("LEGAL_SIGNATURE_REQUIRED"), "LEGAL");
    assert.equal(classifyBlocker("ADMIN_RELEASE_REQUIRED"), "LEGAL");
  });

  it("classifies automatic codes as AUTOMATIC", () => {
    assert.equal(classifyBlocker("NO_ACTIVE_GENERATED_DOCUMENTS"), "AUTOMATIC");
    assert.equal(classifyBlocker("ENGINE_NOT_COMPLETED"), "AUTOMATIC");
  });

  it("classifies unknown codes as UNKNOWN (fail closed)", () => {
    assert.equal(classifyBlocker("UNKNOWN_CODE"), "UNKNOWN");
  });
});

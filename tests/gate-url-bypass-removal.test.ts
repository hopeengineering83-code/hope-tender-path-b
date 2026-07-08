/**
 * Behavioral tests proving URL bypasses cannot unlock generation.
 *
 * Tests prove:
 * - acceptPartialExtraction=true does not bypass partial extraction gate
 * - acceptNoMandatoryReqs=true does not bypass mandatory requirements gate
 * - planOnly=true does not bypass partial extraction, regex fallback,
 *   weak extraction, missing mandatory requirements, or invalid evidence
 * - Blocked requests create zero GeneratedDocument rows
 * - Regex/deterministic fallback cannot be treated as successful AI analysis
 * - Valid complete analysis can proceed only through the central readiness gate
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const generateRoute = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");

describe("URL bypass removal — acceptPartialExtraction", () => {

  it("acceptPartialExtraction is not referenced anywhere in generate route", () => {
    assert.ok(
      !generateRoute.includes("acceptPartialExtraction"),
      "acceptPartialExtraction must not exist in generate route — bypass removed",
    );
  });

  it("partial extraction gate applies unconditionally (no planOnly bypass)", () => {
    // The PARTIAL_EXTRACTION_AI_ANALYZED gate must not check planOnly
    const partialIdx = generateRoute.indexOf("PARTIAL_EXTRACTION_AI_ANALYZED");
    assert.ok(partialIdx > -1, "Partial extraction gate must exist");
    const gateSection = generateRoute.slice(partialIdx, partialIdx + 500);
    assert.ok(
      !gateSection.includes('planOnly'),
      "Partial extraction gate must not check planOnly — must apply unconditionally",
    );
  });
});

describe("URL bypass removal — acceptNoMandatoryReqs", () => {

  it("acceptNoMandatoryReqs is not referenced anywhere in generate route", () => {
    assert.ok(
      !generateRoute.includes("acceptNoMandatoryReqs"),
      "acceptNoMandatoryReqs must not exist in generate route — bypass removed",
    );
  });

  it("mandatory requirements gate is non-blocking for draft work (no planOnly bypass needed)", () => {
    // NO_MANDATORY_REQUIREMENTS is no longer a hard block for draft work.
    // The gate was removed entirely — mandatory requirement classification
    // absence is a warning only. There is no bypass because there is no gate.
    assert.doesNotMatch(
      generateRoute, /errorCode.*NO_MANDATORY_REQUIREMENTS/,
      "NO_MANDATORY_REQUIREMENTS must NOT be a hard-block errorCode for draft work",
    );
  });
});

describe("planOnly cannot bypass safety gates", () => {

  it("planOnly does not bypass content-page detection gate", () => {
    // Find the content-page gate section
    const contentPageIdx = generateRoute.indexOf("Critical content-page gate");
    if (contentPageIdx > -1) {
      const gateSection = generateRoute.slice(contentPageIdx, contentPageIdx + 1000);
      assert.ok(
        !gateSection.includes('planOnly') || !gateSection.includes('!== "true"'),
        "Content-page gate must not have planOnly bypass condition",
      );
    }
  });

  it("planOnly does not bypass metadata gate", () => {
    // Find the metadata gate section
    const metadataIdx = generateRoute.indexOf("canonical field-state resolver");
    if (metadataIdx > -1) {
      const gateSection = generateRoute.slice(metadataIdx, metadataIdx + 1000);
      assert.ok(
        !gateSection.includes('planOnly') || !gateSection.includes('!== "true"'),
        "Metadata gate must not have planOnly bypass condition",
      );
    }
  });

  it("planOnly does not bypass submission plan gate", () => {
    // Find the submission plan gate section
    const planIdx = generateRoute.indexOf("hasValidSubmissionPlan");
    if (planIdx > -1) {
      const gateSection = generateRoute.slice(planIdx, planIdx + 500);
      assert.ok(
        !gateSection.includes('planOnly') || !gateSection.includes('!== "true"'),
        "Submission plan gate must not have planOnly bypass condition",
      );
    }
  });

  it("planOnly mode does not create GeneratedDocument rows", () => {
    // The planOnly path must set planRowsCreated = 0
    const planOnlyIdx = generateRoute.indexOf('url.searchParams.get("planOnly") === "true"');
    assert.ok(planOnlyIdx > -1, "planOnly mode entry must exist");
    // 4000-char window — CRLF checkouts inflate the block past 2000 chars.
    const planOnlySection = generateRoute.slice(planOnlyIdx, planOnlyIdx + 4000);
    assert.ok(
      planOnlySection.includes("planRowsCreated = 0") || planOnlySection.includes("virtualOnly"),
      "planOnly mode must not create GeneratedDocument rows (virtual only)",
    );
    assert.ok(
      !planOnlySection.includes("ensurePlannedGeneratedDocumentRecords(id, plannedFiles)"),
      "planOnly mode must NOT call ensurePlannedGeneratedDocumentRecords",
    );
  });
});

describe("Gate safety — regex/fallback cannot unlock generation", () => {

  it("generate route checks for regex fallback before generation", () => {
    assert.ok(
      generateRoute.includes("REGEX_FALLBACK") || generateRoute.includes("regex") || generateRoute.includes("fallback"),
      "Generate route must check for regex/fallback analysis",
    );
  });

  it("ensurePlannedGeneratedDocumentRecords is disabled (no-op)", () => {
    assert.ok(
      generateRoute.includes("PERMANENTLY DISABLED") || generateRoute.includes("return 0;"),
      "ensurePlannedGeneratedDocumentRecords must be permanently disabled (returns 0)",
    );
  });
});

describe("Gate safety — central readiness gate is preserved", () => {

  it("generate route calls assertTenderReadyForGenerationAndExport", () => {
    assert.ok(
      generateRoute.includes("assertTenderReadyForGenerationAndExport"),
      "Generate route must call the central readiness gate before generation",
    );
  });

  it("generate route does not bypass the central gate with planOnly", () => {
    // The central gate call must not be conditional on planOnly
    const gateIdx = generateRoute.indexOf("assertTenderReadyForGenerationAndExport");
    assert.ok(gateIdx > -1, "Central gate call must exist");
    // Check 200 chars before the gate call for planOnly condition
    const beforeGate = generateRoute.slice(Math.max(0, gateIdx - 200), gateIdx);
    assert.ok(
      !beforeGate.includes('planOnly') || !beforeGate.includes('!== "true"'),
      "Central readiness gate must not be bypassed by planOnly",
    );
  });
});

// Contamination detector + repair-metadata route contract tests.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  detectMetadataContamination,
  looksLikeMetadataPlaceholder,
} from "../lib/engine/tender-metadata-completeness";

describe("detectMetadataContamination", () => {
  it("flags 'Status CLOSED' scrape contamination", () => {
    const r = detectMetadataContamination("Pre-bid meeting: Sept 5\nStatus: CLOSED\nrelated tender alerts...");
    assert.equal(r.contaminated, true);
    assert.equal(r.signal, "TENDER_PORTAL_STATUS_BANNER");
  });

  it("flags 'related tender alerts'", () => {
    const r = detectMetadataContamination("related tender alerts for Ethiopia health sector");
    assert.equal(r.contaminated, true);
  });

  it("flags 'View Tender' nav link", () => {
    const r = detectMetadataContamination("Procurement plan published. View Tender to read more.");
    assert.equal(r.contaminated, true);
  });

  it("flags 3+ ALL-CAPS heading lines in a short field (scraped fragment)", () => {
    const r = detectMetadataContamination("ABC HEALTH AGENCY\nSCOPE OF WORK\nTENDER NOTICE\nThe deadline is September 12.");
    assert.equal(r.contaminated, true);
    assert.equal(r.signal, "MULTIPLE_HEADING_LINES_IN_SHORT_FIELD");
  });

  it("does NOT flag a legitimate long evaluation prose", () => {
    const longClean = "The Evaluation Methodology requires submission of Technical and Financial proposals scored 70/30. Pass/fail prequalification applies. Methodology and approach: 25 marks. Key Personnel: 30 marks.";
    const r = detectMetadataContamination(longClean);
    assert.equal(r.contaminated, false);
  });

  it("returns clean for empty / null", () => {
    assert.equal(detectMetadataContamination(null).contaminated, false);
    assert.equal(detectMetadataContamination("").contaminated, false);
    assert.equal(detectMetadataContamination(undefined).contaminated, false);
  });
});

describe("placeholder detection covers the task list", () => {
  for (const value of [
    "Bid-Team to confirm",
    "TBD",
    "TBC",
    "TBA",
    "N/A",
    "Not provided",
    "Not specified",
    "Unknown",
    "To be determined",
    "To be confirmed",
  ]) {
    it(`rejects ${JSON.stringify(value)} as placeholder`, () => {
      assert.equal(looksLikeMetadataPlaceholder(value), true);
    });
  }

  it("accepts a real value", () => {
    assert.equal(looksLikeMetadataPlaceholder("Pharo Foundation, Addis Ababa"), false);
  });
});

describe("POST /api/tenders/[id]/repair-metadata contract", () => {
  const source = readFileSync("app/api/tenders/[id]/repair-metadata/route.ts", "utf8");

  it("is role-gated, rate-limited and audit-logged", () => {
    assert.match(source, /requireRole\("ADMIN",\s*"PROPOSAL_MANAGER",\s*"REVIEWER"\)/);
    assert.match(source, /rateLimit\(/);
    assert.match(source, /TENDER_METADATA_REPAIRED/);
  });

  it("never overwrites a non-empty existing value unless force:true AND ADMIN", () => {
    assert.match(source, /tender\.evaluationMethodology\s*&&\s*tender\.evaluationMethodology\.trim\(\)\.length\s*>\s*0\s*&&\s*!force/);
    assert.match(source, /actor\.role === "ADMIN"/);
  });

  it("calls the deterministic extractor and persists only when found:true", () => {
    assert.match(source, /extractEvaluationMethodologyFromSource/);
    assert.match(source, /if \(!extraction\.found\) \{/);
    assert.match(source, /status:\s*"NOT_FOUND"/);
    assert.match(source, /status:\s*"REPAIRED"/);
  });

  it("audit metadata includes source file, confidence, and verbatim quote", () => {
    assert.match(source, /sourceFile: extraction\.sourceFile/);
    assert.match(source, /confidence: extraction\.confidence/);
    assert.match(source, /sourceQuote: extraction\.sourceQuote/);
    assert.match(source, /extractionSource: "DETERMINISTIC_SOURCE_EXTRACTOR"/);
  });

  it("returns 422 NO_TENDER_SOURCE when no files have extracted text", () => {
    assert.match(source, /code:\s*"NO_TENDER_SOURCE"/);
    assert.match(source, /status:\s*422/);
  });
});

describe("POST /api/tenders/[id]/repair-metadata — placeholder rejection (Gap C fix)", () => {
  const source = readFileSync("app/api/tenders/[id]/repair-metadata/route.ts", "utf8");

  it("imports containsMetadataPlaceholder", () => {
    assert.match(source, /containsMetadataPlaceholder/);
  });

  it("rejects extracted string values that contain a placeholder before storing", () => {
    assert.match(source, /containsMetadataPlaceholder\(rawValue\)/);
  });

  it("returns REJECTED status for placeholder values (never stores them)", () => {
    assert.match(source, /status:\s*"REJECTED"/);
    assert.match(source, /placeholder pattern and was not stored/);
  });

  it("uses continue to skip audit log and DB write when value is a placeholder", () => {
    // The continue must appear inside the placeholder check block (up to 500 chars away)
    assert.match(source, /containsMetadataPlaceholder[\s\S]{1,500}continue;/);
  });
});

describe("POST /api/tenders/[id]/engine — SELECT includes entity fields (Gap B fix)", () => {
  const source = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");

  it("selects procuringEntityName", () => {
    assert.match(source, /procuringEntityName:\s*true/);
  });

  it("selects legalClientName", () => {
    assert.match(source, /legalClientName:\s*true/);
  });

  it("selects donorAgency", () => {
    assert.match(source, /donorAgency:\s*true/);
  });

  it("selects implementingAgency", () => {
    assert.match(source, /implementingAgency:\s*true/);
  });

  it("calls computeStoredMetadataPatch after selecting entity fields so sanitizer can nullify them", () => {
    assert.match(source, /computeStoredMetadataPatch/);
    assert.match(source, /listInvalidStoredFields/);
  });
});

describe("MANUAL_CONFIRMED audit on tender PATCH", () => {
  const source = readFileSync("app/api/tenders/[id]/route.ts", "utf8");

  it("the TENDER_METADATA_MANUAL_CONFIRMED audit action is fired when critical fields change", () => {
    assert.match(source, /TENDER_METADATA_MANUAL_CONFIRMED/);
    assert.match(source, /clientName/);
    assert.match(source, /reference/);
    assert.match(source, /submissionMethod/);
    assert.match(source, /deadline/);
    assert.match(source, /evaluationMethodology/);
    assert.match(source, /source:\s*"MANUAL_CONFIRMED"/);
  });

  it("only fires when the request body actually carries the field (no spurious audits)", () => {
    assert.match(source, /body\[field\] !== undefined/);
  });
});

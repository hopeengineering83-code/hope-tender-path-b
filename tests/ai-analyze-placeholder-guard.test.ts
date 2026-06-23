// Regression tests: ai-analyze route must not write placeholder values to the DB
// for client/contact/location fields, even when the AI returns them.
//
// Both the streaming and non-streaming paths are checked via source inspection
// and via the actual validator functions that gate each field.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  containsMetadataPlaceholder,
  isValidClientContact,
  isValidCountry,
  isValidReferenceNumber,
} from "../lib/engine/metadata-validators";

const routeSrc = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
  "utf-8",
);
const builderSrc = readFileSync(
  path.join(process.cwd(), "lib/engine/canonical-analysis-update.ts"),
  "utf-8",
);

// ─── Gate coverage (post-centralisation) ─────────────────────────────────────
// The ~30-field client-metadata mapping (and its placeholder/validator guards)
// now lives in ONE shared builder (lib/engine/canonical-analysis-update.ts) that
// all three analysis paths use. These tests assert (a) the shared builder still
// applies each guard, and (b) BOTH route promotion paths route through the
// shared builder — so a guard can never be dropped from one path again (the
// original parity-bug class).

describe("ai-analyze — canonical metadata builder applies every placeholder guard", () => {
  it("country uses isValidCountry", () => {
    assert.ok(/isValidCountry\(aiResult\.country\)/.test(builderSrc), "country must be guarded by isValidCountry in the shared builder");
  });
  it("clientAddress uses containsMetadataPlaceholder", () => {
    assert.ok(/containsMetadataPlaceholder\(aiResult\.clientAddress\)/.test(builderSrc));
  });
  it("clientContactName uses isValidClientContact", () => {
    assert.ok(/isValidClientContact\(aiResult\.clientContactName\)/.test(builderSrc));
  });
  it("clientContactEmail uses containsMetadataPlaceholder", () => {
    assert.ok(/containsMetadataPlaceholder\(aiResult\.clientContactEmail\)/.test(builderSrc));
  });
  it("clientContactPhone uses containsMetadataPlaceholder", () => {
    assert.ok(/containsMetadataPlaceholder\(aiResult\.clientContactPhone\)/.test(builderSrc));
  });
  it("procurementReferenceNumber uses isValidReferenceNumber", () => {
    assert.ok(/isValidReferenceNumber\(aiResult\.procurementReferenceNumber\)/.test(builderSrc));
  });
  it("clientRepresentative uses containsMetadataPlaceholder", () => {
    assert.ok(/containsMetadataPlaceholder\(aiResult\.clientRepresentative\)/.test(builderSrc));
  });
});

describe("ai-analyze — both route promotion paths use the shared canonical builder", () => {
  it("buildCanonicalAnalysisTenderUpdate is called in both the streaming and non-streaming paths", () => {
    const occurrences = routeSrc.match(/buildCanonicalAnalysisTenderUpdate\(/g) ?? [];
    assert.ok(
      occurrences.length >= 2,
      `both AI Analyze paths must promote via the shared builder, found ${occurrences.length} call(s)`,
    );
  });
});

// ─── Validator unit tests: confirm what values each gate blocks ───────────────

describe("isValidCountry — rejects placeholder country values", () => {
  it("rejects 'N/A'", () => assert.equal(isValidCountry("N/A"), false));
  it("rejects 'unknown'", () => assert.equal(isValidCountry("unknown"), false));
  it("rejects 'not specified'", () => assert.equal(isValidCountry("not specified"), false));
  it("rejects 'TBD'", () => assert.equal(isValidCountry("TBD"), false));
  it("accepts 'Ethiopia'", () => assert.equal(isValidCountry("Ethiopia"), true));
  it("accepts 'Kenya'", () => assert.equal(isValidCountry("Kenya"), true));
  it("accepts 'Uganda'", () => assert.equal(isValidCountry("Uganda"), true));
  it("accepts country in a phrase like 'Addis Ababa, Ethiopia'", () => assert.equal(isValidCountry("Addis Ababa, Ethiopia"), true));
});

describe("isValidReferenceNumber — rejects placeholder reference values", () => {
  it("rejects 'N/A'", () => assert.equal(isValidReferenceNumber("N/A"), false));
  it("rejects 'unknown'", () => assert.equal(isValidReferenceNumber("unknown"), false));
  it("rejects 'TBD'", () => assert.equal(isValidReferenceNumber("TBD"), false));
  it("rejects 'only' (stop-word)", () => assert.equal(isValidReferenceNumber("only"), false));
  it("rejects 'none'", () => assert.equal(isValidReferenceNumber("none"), false));
  it("accepts 'RFP/DoT/2025/001'", () => assert.equal(isValidReferenceNumber("RFP/DoT/2025/001"), true));
  it("accepts 'ITT/2025/001'", () => assert.equal(isValidReferenceNumber("ITT/2025/001"), true));
  it("accepts 'PPMO/NCB/001/2025'", () => assert.equal(isValidReferenceNumber("PPMO/NCB/001/2025"), true));
  it("accepts '2026-024'", () => assert.equal(isValidReferenceNumber("2026-024"), true));
});

describe("isValidClientContact — rejects placeholder contact names", () => {
  it("rejects 'Contact Person'", () => assert.equal(isValidClientContact("Contact Person"), false));
  it("rejects 'focal point'", () => assert.equal(isValidClientContact("focal point"), false));
  it("rejects 's Contact Person' (OCR noise fragment)", () => assert.equal(isValidClientContact("s Contact Person"), false));
  it("rejects single word 'unknown'", () => assert.equal(isValidClientContact("unknown"), false));
  it("accepts 'Dr. Jane Doe'", () => assert.equal(isValidClientContact("Dr. Jane Doe"), true));
  it("accepts 'John Smith'", () => assert.equal(isValidClientContact("John Smith"), true));
  it("accepts 'Eng. Hassan Abdi'", () => assert.equal(isValidClientContact("Eng. Hassan Abdi"), true));
});

describe("containsMetadataPlaceholder — catches embedded placeholders in address/contact fields", () => {
  it("rejects 'Bid-Team to confirm'", () => assert.equal(containsMetadataPlaceholder("Bid-Team to confirm"), true));
  it("rejects 'not specified'", () => assert.equal(containsMetadataPlaceholder("not specified"), true));
  it("rejects 'unknown'", () => assert.equal(containsMetadataPlaceholder("unknown"), true));
  it("rejects 'TBC'", () => assert.equal(containsMetadataPlaceholder("TBC"), true));
  it("rejects address containing placeholder: 'Addis Ababa / Bid-Team to confirm'", () =>
    assert.equal(containsMetadataPlaceholder("Addis Ababa / Bid-Team to confirm"), true));
  it("accepts 'Bole Road, Addis Ababa'", () => assert.equal(containsMetadataPlaceholder("Bole Road, Addis Ababa"), false));
  it("accepts a real email 'procurement@moh.gov.et'", () => assert.equal(containsMetadataPlaceholder("procurement@moh.gov.et"), false));
  it("accepts a real phone '+251 11 551 7xxx'", () => assert.equal(containsMetadataPlaceholder("+251 11 551 7xxx"), false));
});

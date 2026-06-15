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
} from "../lib/engine/metadata/metadata-validators";

const routeSrc = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
  "utf-8",
);

// ─── Source-level gate coverage ──────────────────────────────────────────────

describe("ai-analyze route — placeholder guard source coverage", () => {
  it("imports isValidCountry and isValidReferenceNumber", () => {
    assert.ok(
      routeSrc.includes("isValidCountry") && routeSrc.includes("isValidReferenceNumber"),
      "ai-analyze must import isValidCountry and isValidReferenceNumber from metadata-validators",
    );
  });

  it("country field uses isValidCountry guard in both paths", () => {
    const occurrences = routeSrc.match(/isValidCountry\(aiResult\.country\)/g) ?? [];
    assert.ok(
      occurrences.length >= 2,
      `country must be guarded by isValidCountry in both streaming and non-streaming paths, found ${occurrences.length} occurrence(s)`,
    );
  });

  it("clientAddress field uses containsMetadataPlaceholder guard in both paths", () => {
    const occurrences = routeSrc.match(/containsMetadataPlaceholder\(aiResult\.clientAddress\)/g) ?? [];
    assert.ok(
      occurrences.length >= 2,
      `clientAddress must be guarded in both paths, found ${occurrences.length}`,
    );
  });

  it("clientContactName uses isValidClientContact in both paths", () => {
    const occurrences = routeSrc.match(/isValidClientContact\(aiResult\.clientContactName\)/g) ?? [];
    assert.ok(
      occurrences.length >= 2,
      `clientContactName must be guarded by isValidClientContact in both paths, found ${occurrences.length}`,
    );
  });

  it("clientContactEmail uses containsMetadataPlaceholder in both paths", () => {
    const occurrences = routeSrc.match(/containsMetadataPlaceholder\(aiResult\.clientContactEmail\)/g) ?? [];
    assert.ok(
      occurrences.length >= 2,
      `clientContactEmail must be guarded in both paths, found ${occurrences.length}`,
    );
  });

  it("clientContactPhone uses containsMetadataPlaceholder in both paths", () => {
    const occurrences = routeSrc.match(/containsMetadataPlaceholder\(aiResult\.clientContactPhone\)/g) ?? [];
    assert.ok(
      occurrences.length >= 2,
      `clientContactPhone must be guarded in both paths, found ${occurrences.length}`,
    );
  });

  it("procurementReferenceNumber uses isValidReferenceNumber in both paths", () => {
    const occurrences = routeSrc.match(/isValidReferenceNumber\(aiResult\.procurementReferenceNumber\)/g) ?? [];
    assert.ok(
      occurrences.length >= 2,
      `reference/procurementReferenceNumber must be guarded by isValidReferenceNumber in both paths, found ${occurrences.length}`,
    );
  });

  it("clientRepresentative uses containsMetadataPlaceholder in both paths", () => {
    const occurrences = routeSrc.match(/containsMetadataPlaceholder\(aiResult\.clientRepresentative\)/g) ?? [];
    assert.ok(
      occurrences.length >= 2,
      `clientRepresentative must be guarded in both paths, found ${occurrences.length}`,
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

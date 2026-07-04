/**
 * Source-inspection tests for the metadata-override route's post-override
 * source-evidence enrichment wiring.
 *
 * Closes the "USER_CONFIRMED with no prior evidence" gap: when a user
 * confirms a critical field value, the route now calls
 * enrichMetadataWithSourceEvidence to locate the value in an active tender
 * file and persist the source-evidence columns (fileId + page + quote).
 * This allows the canonical resolver to mark the field as
 * EXTRACTED_AND_GROUNDED instead of NOT_FOUND_CONFIRMED — unblocking
 * generation/export when the value IS in the file but was never attributed.
 *
 * Mirrors the wiring-test pattern in tests/metadata-source-enrichment.test.ts
 * for re-extract-metadata, tender-upload-first, and ai-analyze.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("metadata-override route — post-override enrichment wired in", () => {
  const src = read("app/api/tenders/[id]/metadata-override/route.ts");

  it("imports enrichMetadataWithSourceEvidence", () => {
    assert.ok(
      src.includes('import { enrichMetadataWithSourceEvidence } from "../../../../../lib/engine/metadata-source-enrichment";'),
      "must import enrichMetadataWithSourceEvidence",
    );
  });

  it("defines the ENRICHMENT_FIELD_MAP for the 8 enrichment-supported fields", () => {
    // The map translates the override route's `field` parameter to the
    // enrichment module's named input fields.
    for (const field of [
      "clientName", "title", "reference", "deadline",
      "submissionMethod", "submissionAddress", "submissionEmails", "submissionEmailSubject",
    ]) {
      assert.ok(
        src.includes(`${field}: "${field}"`),
        `ENRICHMENT_FIELD_MAP must map ${field}`,
      );
    }
  });

  it("only runs enrichment for USER_CONFIRMED and USER_EDITED states", () => {
    assert.ok(
      src.includes('fieldState === "USER_CONFIRMED" || fieldState === "USER_EDITED"'),
      "enrichment must be gated on USER_CONFIRMED || USER_EDITED",
    );
  });

  it("calls enrichMetadataWithSourceEvidence after the override upsert succeeds", () => {
    const upsertIdx = src.indexOf("prisma.tenderMetadataOverride.upsert({");
    const enrichIdx = src.indexOf("enrichMetadataWithSourceEvidence(");
    assert.ok(upsertIdx > -1, "must have override upsert");
    assert.ok(enrichIdx > -1, "must call enrichMetadataWithSourceEvidence");
    assert.ok(
      enrichIdx > upsertIdx,
      "enrichment must happen AFTER the override upsert succeeds",
    );
  });

  it("loads active tender files (filtered to deletionStatus=ACTIVE)", () => {
    assert.ok(
      src.includes('where: { tenderId: id, deletionStatus: "ACTIVE" }'),
      "must load active tender files for enrichment search",
    );
  });

  it("loads existing contactDetailsSourceJson for the reference merge", () => {
    assert.ok(
      src.includes("existingContactDetailsSourceJson: existingContactDetails?.contactDetailsSourceJson ?? null"),
      "must load existing contactDetailsSourceJson so the reference merge preserves other entries",
    );
  });

  it("passes the effective value (overrideValue ?? existing tender scalar) to enrichment", () => {
    assert.ok(
      src.includes("overrideValue ?? existingScalar ?? null"),
      "must resolve effective value as overrideValue ?? existingScalar ?? null",
    );
  });

  it("converts deadline string to Date for the enrichment module", () => {
    assert.ok(
      src.includes('enrichmentKey === "deadline" && typeof effectiveValue === "string"'),
      "must convert deadline string to Date for enrichment",
    );
  });

  it("only calls prisma.tender.update when enrichment found at least one field", () => {
    assert.ok(
      src.includes("Object.keys(enrichment).length > 0"),
      "must guard prisma.tender.update on Object.keys(enrichment).length > 0",
    );
  });

  it("wraps the enrichment in try/catch (best-effort, non-fatal)", () => {
    // The enrichment block must be wrapped in try/catch so a failure (missing
    // table, malformed text, etc.) does not block the override response.
    const tryIdx = src.indexOf("if (fieldState === \"USER_CONFIRMED\" || fieldState === \"USER_EDITED\") {");
    assert.ok(tryIdx > -1, "must have the enrichment conditional block");
    const catchIdx = src.indexOf("// Best-effort, non-fatal. The override itself already succeeded.");
    assert.ok(catchIdx > -1, "must have a catch block with non-fatal comment");
    assert.ok(catchIdx > tryIdx, "catch must come after the try block");
  });
});

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

describe("metadata-override route — USER_EDITED value promotion (verified manual extraction)", () => {
  const src = read("app/api/tenders/[id]/metadata-override/route.ts");

  it("promotes the override value into the tender scalar ONLY when this field's evidence was found", () => {
    // The promotion closes the documented follow-up: a USER_EDITED value that
    // enrichment PROVED is contained in an active file's text becomes the raw
    // scalar (same write re-extract-metadata performs), so the resolver's
    // exact-match rule and the BuildPlan validator both see it grounded.
    assert.ok(
      src.includes('fieldState === "USER_EDITED" && overrideValue && evidenceFound'),
      "promotion must be gated on USER_EDITED + a value + evidenceFound",
    );
    assert.ok(
      src.includes("const evidenceFound = Boolean((enrichment as Record<string, unknown>)[evidenceKeyByField[field] ?? \"\"]);"),
      "evidenceFound must be derived from the enrichment result for THIS field, not any field",
    );
  });

  it("maps every enrichment-supported field to its SourceFileId evidence key", () => {
    for (const pair of [
      'clientName: "clientNameSourceFileId"',
      'title: "titleSourceFileId"',
      'reference: "referenceSourceFileId"',
      'deadline: "deadlineSourceFileId"',
      'submissionMethod: "submissionMethodSourceFileId"',
      'submissionAddress: "submissionAddressSourceFileId"',
      'submissionEmails: "submissionEmailSourceFileId"',
      'submissionEmailSubject: "submissionEmailSubjectSourceFileId"',
    ]) {
      assert.ok(src.includes(pair), `evidenceKeyByField must contain ${pair}`);
    }
  });

  it("converts a promoted deadline to a Date and leaves other fields as strings", () => {
    assert.ok(
      src.includes('updateData[field] = field === "deadline" ? new Date(overrideValue) : overrideValue;'),
      "deadline promotion must write a Date; other fields write the string value",
    );
  });

  it("fails closed: no evidence found means the scalar is never touched", () => {
    // The promotion lives INSIDE the Object.keys(enrichment).length > 0 guard
    // and behind evidenceFound — an unevidenced USER_EDITED value never
    // reaches the tender scalar and the field stays blocked.
    const guardIdx = src.indexOf("Object.keys(enrichment).length > 0");
    const promoIdx = src.indexOf('fieldState === "USER_EDITED" && overrideValue && evidenceFound');
    assert.ok(guardIdx > -1 && promoIdx > guardIdx, "promotion must be inside the enrichment-found guard");
  });
});

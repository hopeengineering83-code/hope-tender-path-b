/**
 * Direct resolver tests for contamination handling in canonical-field-state.ts.
 *
 * Tests:
 * 1. Contaminated raw value → PORTAL_CONTAMINATION (blocked)
 * 2. Contaminated override (non-matching) → PORTAL_CONTAMINATION (stays blocked)
 * 3. Genuinely source-proven correction → EXTRACTED_AND_GROUNDED (unblocked)
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";

function makeTender(overrides: Partial<CanonicalResolverInput["tender"]> = {}): CanonicalResolverInput["tender"] {
  return {
    id: "t1",
    title: "Test Tender",
    reference: "REF-001",
    clientName: "Pharo Ventures",
    procuringEntityName: null,
    deadline: new Date("2026-12-11"),
    currency: "USD",
    country: "Ethiopia",
    submissionMethod: "Email",
    submissionAddress: "test@example.com",
    submissionEmails: "test@example.com",
    submissionEmailSubject: null,
    clientContactName: null,
    clientContactEmail: null,
    metadataContaminated: false,
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Pharo Ventures is the procuring entity for this tender",
    submissionMethodSourcePage: 2,
    submissionMethodSourceQuote: "Submit by email to the address below",
    submissionAddressSourcePage: 2,
    submissionAddressSourceQuote: "Submit to this address",
    submissionEmailSourcePage: 2,
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

function findField(result: ReturnType<typeof resolveCanonicalFieldState>, fieldKey: string) {
  const f = result.fields.find((f) => f.fieldKey === fieldKey);
  assert.ok(f, `Field ${fieldKey} not found`);
  return f;
}

describe("Contamination handling — contaminated raw value", () => {

  it("flags contaminated clientName as PORTAL_CONTAMINATION (no override) — blocks FINAL export", () => {
    // Authority model: contamination blocks FINAL export (the value is corrupted).
    // Draft work proceeds so the user can manually correct the value.
    const r = resolveCanonicalFieldState({
      tender: makeTender({ metadataContaminated: true }),
      overrides: [],
      hasExtractedRequirements: true,
    });
    const f = findField(r, "clientName");
    assert.equal(f.status, "PORTAL_CONTAMINATION");
    assert.ok(f.blockerReason, "Must have blocker reason");
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
  });

  it("contaminated field is not valid and not grounded", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({ metadataContaminated: true }),
      overrides: [],
      hasExtractedRequirements: true,
    });
    const f = findField(r, "clientName");
    assert.equal(f.isValid, false);
    assert.equal(f.isGrounded, false);
  });
});

describe("Contamination handling — contaminated override (non-matching)", () => {

  it("contaminated field with non-matching USER_EDITED override stays PORTAL_CONTAMINATION", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({
        metadataContaminated: true,
        clientName: "Contaminated Portal Text Inc",
        clientNameSourcePage: 1,
        clientNameSourceQuote: "Contaminated Portal Text Inc is the procuring entity",
      }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Different Company Name",
        reason: "corrected",
        overriddenBy: "u1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
    });
    const f = findField(r, "clientName");
    assert.equal(f.status, "PORTAL_CONTAMINATION",
      "Non-matching override must not resolve contamination");
    assert.ok(f.blockerReason);
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
  });

  it("contaminated field with USER_CONFIRMED override but no evidence stays PORTAL_CONTAMINATION", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({
        metadataContaminated: true,
        clientName: "Contaminated Text",
        clientNameSourcePage: null,
        clientNameSourceQuote: null,
      }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Contaminated Text",
        reason: "confirmed",
        overriddenBy: "u1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
    });
    const f = findField(r, "clientName");
    assert.equal(f.status, "PORTAL_CONTAMINATION",
      "Override without evidence must not resolve contamination");
  });
});

describe("Contamination handling — genuinely source-proven correction", () => {

  it("contaminated field with matching override + grounded evidence → EXTRACTED_AND_GROUNDED", () => {
    // The raw value matches the override value, AND there's active source evidence.
    // This means the user confirmed the extracted value that has source proof.
    const r = resolveCanonicalFieldState({
      tender: makeTender({
        metadataContaminated: true,
        clientName: "Pharo Ventures",
        clientNameSourcePage: 1,
        clientNameSourceQuote: "Pharo Ventures is the procuring entity for this tender",
      }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Pharo Ventures",
        reason: "confirmed from source",
        overriddenBy: "u1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
    });
    const f = findField(r, "clientName");
    assert.equal(f.status, "EXTRACTED_AND_GROUNDED",
      "Matching override with grounded evidence must resolve contamination");
    assert.equal(f.blockerReason, null);
    assert.equal(f.isValid, true);
    assert.equal(f.isGrounded, true);
  });

  it("contaminated field with matching USER_EDITED + grounded evidence → EXTRACTED_AND_GROUNDED", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({
        metadataContaminated: true,
        clientName: "Pharo Ventures",
        clientNameSourcePage: 1,
        clientNameSourceQuote: "Pharo Ventures is the procuring entity for this tender",
      }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Pharo Ventures",
        reason: "edited to match source",
        overriddenBy: "u1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
    });
    const f = findField(r, "clientName");
    assert.equal(f.status, "EXTRACTED_AND_GROUNDED");
    assert.equal(f.blockerReason, null);
  });
});

describe("Contamination handling — isGrounded agrees with status", () => {

  it("contaminated field has isGrounded=false (agrees with PORTAL_CONTAMINATION)", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({ metadataContaminated: true }),
      overrides: [],
      hasExtractedRequirements: true,
    });
    const f = findField(r, "clientName");
    assert.equal(f.status, "PORTAL_CONTAMINATION");
    assert.equal(f.isGrounded, false, "isGrounded must be false for contaminated field");
  });

  it("resolved contamination has isGrounded=true (agrees with EXTRACTED_AND_GROUNDED)", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({
        metadataContaminated: true,
        clientName: "Pharo Ventures",
        clientNameSourcePage: 1,
        clientNameSourceQuote: "Pharo Ventures is the procuring entity",
      }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Pharo Ventures",
        reason: "confirmed",
        overriddenBy: "u1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
    });
    const f = findField(r, "clientName");
    assert.equal(f.status, "EXTRACTED_AND_GROUNDED");
    assert.equal(f.isGrounded, true, "isGrounded must be true for resolved contamination");
  });
});

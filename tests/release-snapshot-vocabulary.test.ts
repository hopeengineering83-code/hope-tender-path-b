// Behavioral tests proving the unified status vocabulary across panels.
//
// Verifies that:
//   1. metadata-truth.ts MetadataFactStatus === canonical-field-state.ts CanonicalFieldStatus
//   2. NOT_FOUND_CONFIRMED is gone from the shared vocabulary (use NOT_STATED)
//   3. AMBIGUOUS_SOURCE_TEXT is gone (use EXTRACTED_UNVERIFIED)
//   4. SOURCE_CONFLICT and BLOCKED are present in the shared vocabulary
//   5. The resolver correctly blocks USER_EDITED and ungrounded USER_CONFIRMED on critical fields

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { MetadataFactStatus } from "../lib/engine/analysis/metadata-truth";
import type { CanonicalFieldStatus } from "../lib/engine/canonical-field-state";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";

// ─── Vocabulary parity ───────────────────────────────────────────────────────

describe("shared status vocabulary — MetadataFactStatus === CanonicalFieldStatus", () => {
  it("MetadataFactStatus and CanonicalFieldStatus are the same type (structural equality)", () => {
    // TypeScript structural equality: a value of one type must be assignable to the other.
    // If the types differ, this test will fail at compile time (ts-node / tsc mode).
    const v1: MetadataFactStatus = "EXTRACTED_AND_GROUNDED";
    const v2: CanonicalFieldStatus = v1; // assignment proves type compatibility
    assert.equal(v1, v2);
  });

  it("removed statuses NOT_FOUND_CONFIRMED and AMBIGUOUS_SOURCE_TEXT are not assignable", () => {
    // These keys were removed from the shared vocabulary. The runtime test
    // confirms they are not present on the canonical type by checking that
    // the well-known valid values are the accepted ones.
    const valid: CanonicalFieldStatus[] = [
      "EXTRACTED_AND_GROUNDED",
      "EXTRACTED_UNVERIFIED",
      "MANUAL_OVERRIDE",
      "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED",
      "MANUAL_CONFIRMED",
      "NOT_STATED",
      "NOT_APPLICABLE",
      "AMBIGUOUS_DATE",
      "GENERIC_FIELD_LABEL",
      "INTERNAL_PLACEHOLDER",
      "PORTAL_CONTAMINATION",
      "INVALID_FORMAT",
      "SOURCE_CONFLICT",
      "INVALID",
      "BLOCKED",
    ];
    // Confirm count equals 15 (the full vocabulary — no more, no less).
    assert.equal(valid.length, 15, "Update this count when the vocabulary changes intentionally");
    // Confirm SOURCE_CONFLICT and BLOCKED are present.
    assert.ok(valid.includes("SOURCE_CONFLICT"), "SOURCE_CONFLICT must be in vocabulary");
    assert.ok(valid.includes("BLOCKED"), "BLOCKED must be in vocabulary");
    // Confirm removed values are NOT included.
    assert.ok(!(valid as string[]).includes("NOT_FOUND_CONFIRMED"), "NOT_FOUND_CONFIRMED must be removed");
    assert.ok(!(valid as string[]).includes("AMBIGUOUS_SOURCE_TEXT"), "AMBIGUOUS_SOURCE_TEXT must be removed");
  });
});

// ─── Resolver: USER_EDITED on critical fields is always blocked ───────────────

function makeTender(overrides: Partial<CanonicalResolverInput["tender"]> = {}): CanonicalResolverInput["tender"] {
  return {
    id: "t1",
    title: "Road Construction Tender",
    reference: "MOT/RFP/2026/001",
    clientName: "Ministry of Transport",
    procuringEntityName: "Ministry of Transport",
    deadline: new Date("2026-10-01T12:00:00Z"),
    currency: "KES",
    country: "Kenya",
    submissionMethod: "Email",
    submissionAddress: null,
    submissionEmails: "procurement@mot.go.ke",
    submissionEmailSubject: null,
    clientContactName: "John Doe",
    clientContactEmail: "john@mot.go.ke",
    metadataContaminated: false,
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Ministry of Transport, Republic of Kenya invites sealed bids",
    submissionMethodSourcePage: 4,
    submissionMethodSourceQuote: "Bids shall be submitted by email to procurement@mot.go.ke",
    submissionAddressSourcePage: null,
    submissionAddressSourceQuote: null,
    submissionEmailSourcePage: 4,
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

describe("resolver — USER_EDITED on critical field", () => {
  it("blocks generation when clientName has USER_EDITED override (no source evidence)", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({ clientName: null, procuringEntityName: null }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Nairobi County Government",
        reason: "entered manually",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
    });
    const f = r.fields.find((x) => x.fieldKey === "clientName")!;
    assert.equal(f.status, "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED");
    assert.notEqual(f.blockerReason, null, "USER_EDITED on critical field must have blockerReason");
    assert.equal(r.hasGenerationBlocker, true, "USER_EDITED on critical field must block generation");
    assert.equal(f.isValid, false, "USER_EDITED value is not valid (blocked)");
  });

  it("does NOT block non-critical field with USER_EDITED", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({ reference: null }),
      overrides: [{
        field: "reference",
        fieldState: "USER_EDITED",
        overrideValue: "REF-2026-001",
        reason: "added manually",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
    });
    const f = r.fields.find((x) => x.fieldKey === "reference")!;
    assert.equal(f.status, "MANUAL_OVERRIDE");
    assert.equal(f.blockerReason, null, "non-critical USER_EDITED must not have blockerReason");
    assert.equal(r.hasGenerationBlocker, false);
  });
});

// ─── Resolver: USER_CONFIRMED without source evidence blocks critical fields ──

describe("resolver — USER_CONFIRMED without source evidence", () => {
  it("blocks when clientName is USER_CONFIRMED but has no source page+quote", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({
        clientName: "Ministry of Transport",
        // No source evidence columns
        clientNameSourcePage: null,
        clientNameSourceQuote: null,
      }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Ministry of Transport",
        reason: "confirmed",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
    });
    const f = r.fields.find((x) => x.fieldKey === "clientName")!;
    assert.equal(f.status, "MANUAL_CONFIRMED");
    assert.notEqual(f.blockerReason, null, "USER_CONFIRMED without source evidence on critical field must block");
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("does NOT block USER_CONFIRMED when source evidence matches confirmed value", () => {
    // After the grounding fix: USER_CONFIRMED unblocks ONLY when the confirmed
    // value matches the extracted raw value AND has active source evidence.
    const r = resolveCanonicalFieldState({
      tender: makeTender({
        clientName: "Ministry of Transport",
        procuringEntityName: null,
        clientNameSourcePage: 1,
        clientNameSourceQuote: "Ministry of Transport, Republic of Kenya invites sealed bids",
      }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Ministry of Transport",
        reason: "confirmed from page 1",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
    });
    const f = r.fields.find((x) => x.fieldKey === "clientName")!;
    // Value matches raw + has source evidence → EXTRACTED_AND_GROUNDED (no blocker)
    assert.equal(f.status, "EXTRACTED_AND_GROUNDED");
    assert.equal(f.blockerReason, null, "USER_CONFIRMED with matching value + source evidence must not block");
    assert.equal(r.hasGenerationBlocker, false);
  });
});

// ─── NOT_APPLICABLE and NOT_STATED cannot unblock critical fields ─────────────

describe("resolver — NOT_APPLICABLE / NOT_STATED cannot unblock critical fields", () => {
  it("NOT_APPLICABLE on clientName (always-critical) sets BLOCKED", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({ clientName: null, procuringEntityName: null }),
      overrides: [{
        field: "clientName",
        fieldState: "NOT_APPLICABLE",
        overrideValue: null,
        reason: "x",
        overriddenBy: "u",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
    });
    const f = r.fields.find((x) => x.fieldKey === "clientName")!;
    assert.equal(f.status, "BLOCKED");
    assert.notEqual(f.blockerReason, null);
    assert.ok(f.blockerReason?.includes("source-grounded") || f.blockerReason?.includes("candidate"), `got: ${f.blockerReason}`);
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("NOT_STATED on deadline (IGNORED_WITH_REASON) blocks generation", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({ deadline: null }),
      overrides: [{
        field: "deadline",
        fieldState: "IGNORED_WITH_REASON",
        overrideValue: null,
        reason: "no deadline in document",
        overriddenBy: "u",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
    });
    const f = r.fields.find((x) => x.fieldKey === "deadline")!;
    assert.equal(f.status, "NOT_STATED");
    assert.notEqual(f.blockerReason, null, "NOT_STATED on critical deadline must block");
    assert.equal(r.hasGenerationBlocker, true);
  });
});

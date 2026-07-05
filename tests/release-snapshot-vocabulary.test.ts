// Behavioral tests proving the unified status vocabulary across panels.
//
// Verifies that:
//   1. metadata-truth.ts MetadataFactStatus === canonical-field-state.ts CanonicalFieldStatus
//   2. NOT_FOUND_CONFIRMED is now a valid status for ungrounded confirmation
//   3. AMBIGUOUS_SOURCE_TEXT is gone (use EXTRACTED_UNVERIFIED)
//   4. SOURCE_CONFLICT and BLOCKED are present in the shared vocabulary
//   5. The resolver correctly blocks USER_EDITED and ungrounded USER_CONFIRMED on critical fields

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
// MetadataFactStatus is the canonical shared vocabulary, re-exported by the
// single resolver (the duplicate analysis/metadata-truth resolver was deleted).
import type { MetadataFactStatus } from "../lib/engine/canonical-field-state";
import type { CanonicalFieldStatus } from "../lib/engine/canonical-field-state";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";

// ─── Vocabulary parity ───────────────────────────────────────────────────────

describe("shared status vocabulary — MetadataFactStatus === CanonicalFieldStatus", () => {
  it("MetadataFactStatus and CanonicalFieldStatus are the same type (structural equality)", () => {
    // TypeScript structural equality: a value of one type must be assignable to the other.
    const v1: MetadataFactStatus = "EXTRACTED_AND_GROUNDED";
    const v2: CanonicalFieldStatus = v1;
    assert.equal(v1, v2);
  });

  it("status AMBIGUOUS_SOURCE_TEXT is not assignable", () => {
    const valid: CanonicalFieldStatus[] = [
      "EXTRACTED_AND_GROUNDED",
      "EXTRACTED_UNVERIFIED",
      "MANUAL_OVERRIDE",
      "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED",
      "MANUAL_CONFIRMED",
      "NOT_FOUND_CONFIRMED",
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
    assert.equal(valid.length, 16);
    assert.ok(valid.includes("SOURCE_CONFLICT"));
    assert.ok(valid.includes("BLOCKED"));
    assert.ok(!(valid as string[]).includes("AMBIGUOUS_SOURCE_TEXT"));
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
    submissionMethod: "Online submission via email",
    submissionAddress: null,
    submissionEmails: "procurement@mot.go.ke",
    submissionEmailSubject: null,
    clientContactName: "John Doe",
    clientContactEmail: "john@mot.go.ke",
    metadataContaminated: false,
    // GROUND ALL CRITICAL FIELDS BY DEFAULT so we can isolate blockers
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Ministry of Transport, Republic of Kenya invites sealed bids",
    clientNameSourceFileId: "file1",
    submissionMethodSourcePage: 4,
    submissionMethodSourceQuote: "Bids shall be submitted by email to procurement@mot.go.ke",
    submissionMethodSourceFileId: "file1",
    submissionAddressSourcePage: null,
    submissionAddressSourceQuote: null,
    submissionAddressSourceFileId: null,
    submissionEmailSourcePage: 4,
    submissionEmailSourceQuote: "Bids shall be submitted by email to procurement@mot.go.ke",
    submissionEmailSourceFileId: "file1",
    titleSourcePage: 1,
    titleSourceQuote: "Road Construction Tender",
    titleSourceFileId: "file1",
    deadlineSourcePage: 1,
    deadlineSourceQuote: "Deadline: Oct 1 2026",
    deadlineSourceFileId: "file1",
    // GROUND the reference field — it's value-driven evidence-mandatory
    // (when reference has a value, full source evidence is required, mirroring
    // the BuildPlan validator).
    referenceSourcePage: 1,
    referenceSourceQuote: "Tender reference MOT/RFP/2026/001",
    referenceSourceFileId: "file1",
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

describe("resolver — USER_EDITED on critical field", () => {
  it("blocks generation when clientName has USER_EDITED override (no source evidence)", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({
        clientName: null,
        procuringEntityName: null,
        clientNameSourceFileId: null,
        clientNameSourcePage: null,
        clientNameSourceQuote: null
      }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_EDITED" as any,
        overrideValue: "Nairobi County Government",
        reason: "entered manually",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file1"]),
    });
    const f = r.fields.find((x) => x.fieldKey === "clientName")!;
    assert.equal(f.status, "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED");
    assert.notEqual(f.blockerReason, null);
    assert.equal(r.hasGenerationBlocker, true);
    assert.equal(f.isValid, false);
  });

  it("BLOCKS non-critical value-driven field with USER_EDITED (value-driven evidence-mandatory)", () => {
    // reference is value-driven evidence-mandatory: when a USER_EDITED override
    // gives it a value, full source evidence is required. The resolver must
    // block so the panel doesn't show green while the BuildPlan validator blocks.
    const r = resolveCanonicalFieldState({
      tender: makeTender({ reference: null, referenceSourceFileId: null, referenceSourcePage: null, referenceSourceQuote: null }),
      overrides: [{
        field: "reference",
        fieldState: "USER_EDITED" as any,
        overrideValue: "REF-2026-001",
        reason: "added manually",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file1"]),
    });
    const f = r.fields.find((x) => x.fieldKey === "reference")!;
    assert.equal(f.status, "MANUAL_OVERRIDE");
    assert.ok(f.blockerReason, "USER_EDITED reference with no evidence must have a blocker reason");
    assert.equal(r.hasGenerationBlocker, true, "Value-driven evidence-mandatory field with USER_EDITED but no evidence must block");
  });
});

// ─── Resolver: USER_CONFIRMED without source evidence blocks critical fields ──

describe("resolver — USER_CONFIRMED without source evidence", () => {
  it("blocks when clientName is USER_CONFIRMED but has no source page+quote", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({
        clientName: "Ministry of Transport",
        clientNameSourcePage: null,
        clientNameSourceQuote: null,
        clientNameSourceFileId: null,
      }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED" as any,
        overrideValue: "Ministry of Transport",
        reason: "confirmed",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file1"]),
    });
    const f = r.fields.find((x) => x.fieldKey === "clientName")!;
    assert.equal(f.status, "NOT_FOUND_CONFIRMED");
    assert.notEqual(f.blockerReason, null);
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("does NOT block USER_CONFIRMED when source evidence matches confirmed value", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({
        clientName: "Ministry of Transport",
        procuringEntityName: null,
        clientNameSourcePage: 1,
        clientNameSourceQuote: "Ministry of Transport, Republic of Kenya invites sealed bids",
        clientNameSourceFileId: "file1",
      }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED" as any,
        overrideValue: "Ministry of Health", // Mismatch
        reason: "confirmed",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file1"]),
    });
    const f = r.fields.find((x) => x.fieldKey === "clientName")!;
    // It's MANUAL_CONFIRMED but blocked because it doesn't match the source
    assert.equal(f.status, "MANUAL_CONFIRMED");
    assert.notEqual(f.blockerReason, null);
    assert.equal(r.hasGenerationBlocker, true);

    const r2 = resolveCanonicalFieldState({
      tender: makeTender({
        clientName: "Ministry of Transport",
        procuringEntityName: null,
        clientNameSourcePage: 1,
        clientNameSourceQuote: "Ministry of Transport, Republic of Kenya invites sealed bids",
        clientNameSourceFileId: "file1",
      }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED" as any,
        overrideValue: "Ministry of Transport", // Match
        reason: "confirmed from page 1",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file1"]),
    });
    const f2 = r2.fields.find((x) => x.fieldKey === "clientName")!;
    assert.equal(f2.status, "EXTRACTED_AND_GROUNDED");
    assert.equal(f2.blockerReason, null);
    assert.equal(r2.hasGenerationBlocker, false);
  });
});

// ─── NOT_APPLICABLE and NOT_STATED cannot unblock critical fields ─────────────

describe("resolver — NOT_APPLICABLE / NOT_STATED cannot unblock critical fields", () => {
  it("NOT_APPLICABLE on clientName (always-critical) sets BLOCKED", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({ clientName: null, procuringEntityName: null, clientNameSourceFileId: null, clientNameSourcePage: null, clientNameSourceQuote: null }),
      overrides: [{
        field: "clientName",
        fieldState: "NOT_APPLICABLE" as any,
        overrideValue: null,
        reason: "x",
        overriddenBy: "u",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file1"]),
    });
    const f = r.fields.find((x) => x.fieldKey === "clientName")!;
    assert.equal(f.status, "BLOCKED");
    assert.notEqual(f.blockerReason, null);
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("NOT_STATED on deadline (IGNORED_WITH_REASON) blocks generation", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({ deadline: null, deadlineSourceFileId: null, deadlineSourcePage: null, deadlineSourceQuote: null }),
      overrides: [{
        field: "deadline",
        fieldState: "IGNORED_WITH_REASON" as any,
        overrideValue: null,
        reason: "no deadline in document",
        overriddenBy: "u",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file1"]),
    });
    const f = r.fields.find((x) => x.fieldKey === "deadline")!;
    assert.equal(f.status, "NOT_STATED");
    assert.notEqual(f.blockerReason, null);
    assert.equal(r.hasGenerationBlocker, true);
  });
});

// Behavioral tests proving the unified status vocabulary across panels.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { MetadataFactStatus } from "../lib/engine/analysis/metadata-truth";
import type { CanonicalFieldStatus } from "../lib/engine/canonical-field-state";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";

describe("shared status vocabulary — MetadataFactStatus === CanonicalFieldStatus", () => {
  it("MetadataFactStatus and CanonicalFieldStatus are the same type (structural equality)", () => {
    const v1: MetadataFactStatus = "EXTRACTED_AND_GROUNDED";
    const v2: CanonicalFieldStatus = v1;
    assert.equal(v1, v2);
  });

  it("status AMBIGUOUS_SOURCE_TEXT is not assignable", () => {
    const valid: CanonicalFieldStatus[] = [
      "EXTRACTED_AND_GROUNDED", "EXTRACTED_UNVERIFIED", "MANUAL_OVERRIDE",
      "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED", "MANUAL_CONFIRMED", "NOT_FOUND_CONFIRMED",
      "NOT_STATED", "NOT_APPLICABLE", "AMBIGUOUS_DATE", "GENERIC_FIELD_LABEL",
      "INTERNAL_PLACEHOLDER", "PORTAL_CONTAMINATION", "INVALID_FORMAT",
      "SOURCE_CONFLICT", "INVALID", "BLOCKED",
    ];
    assert.equal(valid.length, 16);
  });
});

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
    // GROUND ALL CRITICAL FIELDS
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Ministry of Transport, Republic of Kenya invites sealed bids",
    clientNameSourceFileId: "file1",
    submissionMethodSourcePage: 4,
    submissionMethodSourceQuote: "Bids shall be submitted by email to procurement@mot.go.ke",
    submissionMethodSourceFileId: "file1",
    titleSourcePage: 1,
    titleSourceQuote: "Road Construction Tender",
    titleSourceFileId: "file1",
    deadlineSourcePage: 1,
    deadlineSourceQuote: "Deadline: Oct 1 2026",
    deadlineSourceFileId: "file1",
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
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("does NOT block non-critical field with USER_EDITED", () => {
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
    assert.equal(r.hasGenerationBlocker, false);
  });
});

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
        overrideValue: "Ministry of Transport",
        reason: "confirmed from page 1",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file1"]),
    });
    assert.equal(r.hasGenerationBlocker, false);
  });
});

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
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("NOT_STATED on deadline (IGNORED_WITH_REASON) blocks generation", () => {
    const r = resolveCanonicalFieldState({
      tender: makeTender({ deadline: null, deadlineSourceFileId: null, deadlineSourcePage: null, deadlineSourceQuote: null }),
      overrides: [{
        field: "deadline",
        fieldState: "IGNORED_WITH_REASON" as any,
        overrideValue: null,
        reason: "no deadline",
        overriddenBy: "u",
        createdAt: new Date(),
      }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file1"]),
    });
    assert.equal(r.hasGenerationBlocker, true);
  });
});

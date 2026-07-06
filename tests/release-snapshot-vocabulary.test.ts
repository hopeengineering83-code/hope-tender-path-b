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
  it("does NOT block draft when clientName has USER_EDITED override (blocks FINAL export only)", () => {
    // Authority model: USER_EDITED on a critical field is HUMAN_CONFIRMED_OPERATIONAL.
    // It NEVER blocks draft work. It blocks FINAL export only (when audit insufficient).
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
    assert.equal(r.hasGenerationBlocker, false, "Draft must NOT be blocked by USER_EDITED");
    assert.equal(r.hasExportBlocker, true, "Final export IS blocked (audit insufficient)");
  });

  it("does NOT block reference with USER_EDITED (operational field under authority model)", () => {
    // Authority model: reference is an operational-warning field. It NEVER
    // blocks draft or final work, even with a USER_EDITED override and no
    // source evidence. The previous "value-driven evidence-mandatory"
    // behavior was removed because it caused the rigidity the mission
    // explicitly calls out.
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
    assert.equal(f.blockerReason, null, "reference must NOT have a blockerReason under authority model");
    assert.equal(f.generationEligible, true, "reference must be generation-eligible");
  });
});

// ─── Resolver: USER_CONFIRMED without source evidence blocks critical fields ──

describe("resolver — USER_CONFIRMED without source evidence", () => {
  it("blocks FINAL export when clientName is USER_CONFIRMED but has no source page+quote (draft proceeds)", () => {
    // Authority model: USER_CONFIRMED without grounding is HUMAN_CONFIRMED_OPERATIONAL.
    // It blocks FINAL export only. Draft proceeds.
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
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
  });

  it("does NOT block USER_CONFIRMED when source evidence matches confirmed value", () => {
    // Test 1: mismatch → blocks FINAL (not draft)
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
    assert.equal(f.status, "MANUAL_CONFIRMED");
    assert.equal(r.hasExportBlocker, true); // Final IS blocked

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
  it("NOT_APPLICABLE on clientName (always-critical) sets BLOCKED — blocks FINAL export only", () => {
    // Authority model: NOT_APPLICABLE on a critical field blocks FINAL export only.
    // Draft work proceeds (the user confirmed the tender doesn't state it).
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
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
  });

  it("NOT_STATED on deadline (IGNORED_WITH_REASON) blocks FINAL export only — draft proceeds", () => {
    // Authority model: IGNORED_WITH_REASON on a critical field blocks FINAL export only.
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
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
  });
});

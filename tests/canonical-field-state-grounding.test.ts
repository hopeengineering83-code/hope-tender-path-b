import assert from "node:assert";
import { describe, it } from "node:test";
import { resolveCanonicalFieldState } from "../lib/engine/canonical-field-state";

describe("canonical field state grounding enforcement", () => {
  it("EXTRACTED_UNVERIFIED status should block FINAL export for critical fields (draft proceeds)", () => {
    // Authority model: ungrounded critical field blocks FINAL export only.
    // Draft work proceeds so the user can analyze, extract, match, and draft.
    const tender = {
      id: "t1",
      deadline: new Date("2026-12-12"),
      deadlineSourceFileId: null,
      deadlineSourcePage: null,
      deadlineSourceQuote: null,
    };

    const result = resolveCanonicalFieldState({
      tender: tender as any,
      overrides: [],
      activeTenderFileIds: new Set(),
      hasExtractedRequirements: false
    });
    const deadlineField = result.fields.find(f => f.fieldKey === "deadline");

    assert.strictEqual(deadlineField?.status, "EXTRACTED_UNVERIFIED");
    assert.strictEqual(result.hasExportBlocker, true, "Critical field without grounding must block final export");
    assert.ok(deadlineField?.blockerReason?.includes("Critical fields remain blocked until source-grounded"), "Should have correct blocker reason");
  });

  it("EXTRACTED_UNVERIFIED status should NOT block non-critical fields (non-value-driven)", () => {
    // Use 'country' — a non-critical field that is NOT value-driven
    // evidence-mandatory. (reference IS value-driven: when it has a value but
    // no evidence, it blocks — mirroring the BuildPlan validator.)
    const tender = {
      id: "t1",
      country: "Ethiopia",
    };

    const result = resolveCanonicalFieldState({
      tender: tender as any,
      overrides: [],
      activeTenderFileIds: new Set(),
      hasExtractedRequirements: false
    });
    const countryField = result.fields.find(f => f.fieldKey === "country");

    assert.strictEqual(countryField?.status, "EXTRACTED_UNVERIFIED");
    assert.strictEqual(countryField?.generationEligible, true, "Non-critical field without grounding should not block");
    assert.strictEqual(countryField?.blockerReason, null);
  });

  it("reference with VALUE but no evidence does NOT block (operational field under authority model)", () => {
    // Authority model: reference is an operational-warning field. It NEVER
    // blocks draft or final work. A user can enter a reference number
    // manually without it becoming a hard blocker.
    //
    // The previous "value-driven evidence-mandatory" behavior was removed
    // because it caused the rigidity the mission explicitly calls out:
    //   "reference number becomes a hard blocker merely because it exists
    //    without source evidence"
    const tender = {
      id: "t1",
      reference: "RFP-123",
      referenceSourceFileId: null,
      referenceSourcePage: null,
      referenceSourceQuote: null,
    };

    const result = resolveCanonicalFieldState({
      tender: tender as any,
      overrides: [],
      activeTenderFileIds: new Set(),
      hasExtractedRequirements: false
    });
    const refField = result.fields.find(f => f.fieldKey === "reference");

    // The reference field itself must NOT have a blocker (it's operational).
    assert.strictEqual(refField?.blockerReason, null, "reference must NOT have a blockerReason under authority model");
    assert.strictEqual(refField?.generationEligible, true, "reference must be generation-eligible");
    assert.strictEqual(refField?.exportEligible, true, "reference must be export-eligible");
    // NOTE: result.hasExportBlocker may still be true due to OTHER critical
    // fields (clientName, title, deadline, etc.) being missing/ungrounded
    // in this minimal tender. The authority model only guarantees that the
    // REFERENCE field itself doesn't contribute to the block.
  });

  it("NOT_FOUND_CONFIRMED should block FINAL export for critical fields (draft proceeds)", () => {
    // Authority model: USER_CONFIRMED without grounding is HUMAN_CONFIRMED_OPERATIONAL.
    // It blocks FINAL export only (when audit insufficient). Draft proceeds.
    const tender = {
      id: "t1",
      deadline: new Date("2026-12-12"),
      deadlineSourceFileId: null,
      deadlineSourcePage: null,
      deadlineSourceQuote: null,
    };

    const result = resolveCanonicalFieldState({
      tender: tender as any,
      overrides: [
        { field: "deadline", fieldState: "USER_CONFIRMED" as any, overrideValue: "2026-12-12", reason: "Manually confirmed", overriddenBy: "u1", createdAt: new Date() }
      ],
      activeTenderFileIds: new Set(),
      hasExtractedRequirements: false
    });
    const deadlineField = result.fields.find(f => f.fieldKey === "deadline");

    assert.strictEqual(deadlineField?.status, "NOT_FOUND_CONFIRMED");
    assert.strictEqual(result.hasExportBlocker, true, "USER_CONFIRMED without grounding must block final export for critical fields");
    assert.ok(deadlineField?.blockerReason?.includes("was manually confirmed but has no active tender-source evidence"), "Should have correct blocker reason");
  });

  it("MANUAL_CONFIRMED (grounded) should NOT block critical fields", () => {
    const tender = {
      id: "t1",
      deadline: new Date("2026-12-12"),
      deadlineSourceFileId: "file-1",
      deadlineSourcePage: 3,
      deadlineSourceQuote: "The deadline for submission is 12 Dec 2026.",
    };

    const result = resolveCanonicalFieldState({
      tender: tender as any,
      overrides: [
        { field: "deadline", fieldState: "USER_CONFIRMED" as any, overrideValue: "2026-12-12", reason: "Manually confirmed", overriddenBy: "u1", createdAt: new Date() }
      ],
      activeTenderFileIds: new Set(["file-1"]),
      hasExtractedRequirements: false
    });
    const deadlineField = result.fields.find(f => f.fieldKey === "deadline");

    // Value matches raw + has source evidence → EXTRACTED_AND_GROUNDED (no blocker)
    assert.strictEqual(deadlineField?.status, "EXTRACTED_AND_GROUNDED");
    assert.strictEqual(deadlineField?.generationEligible, true);
    assert.strictEqual(deadlineField?.blockerReason, null);
  });
});

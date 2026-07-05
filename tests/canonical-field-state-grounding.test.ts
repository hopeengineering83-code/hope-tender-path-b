import assert from "node:assert";
import { describe, it } from "node:test";
import { resolveCanonicalFieldState } from "../lib/engine/canonical-field-state";

describe("canonical field state grounding enforcement", () => {
  it("EXTRACTED_UNVERIFIED status should block critical fields", () => {
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
    assert.strictEqual(deadlineField?.generationEligible, false, "Critical field without grounding must block generation");
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

  it("reference with VALUE but no evidence SHOULD block (value-driven evidence-mandatory)", () => {
    // Mirrors the BuildPlan validator: when reference has a value, full source
    // evidence is required. The resolver must block so the panel doesn't show
    // green while the gate blocks.
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

    assert.strictEqual(refField?.status, "EXTRACTED_UNVERIFIED");
    assert.strictEqual(refField?.generationEligible, false, "Value-driven evidence-mandatory field with value but no evidence must block");
    assert.ok(refField?.blockerReason?.includes("Value-driven evidence-mandatory"), "Should have value-driven blocker reason");
  });

  it("NOT_FOUND_CONFIRMED should block critical fields", () => {
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
    assert.strictEqual(deadlineField?.generationEligible, false, "USER_CONFIRMED without grounding must block critical fields");
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

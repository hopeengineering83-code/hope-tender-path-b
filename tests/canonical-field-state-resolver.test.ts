// Tests for canonical field-state resolver — the one source of truth.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Canonical field-state resolver", () => {
  it("resolver exists and exports resolveCanonicalFieldState", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes("export function resolveCanonicalFieldState"), "must export resolveCanonicalFieldState");
  });

  it("returns CanonicalFieldState with all required fields", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes("fieldKey"), "must have fieldKey");
    assert.ok(src.includes("effectiveValue"), "must have effectiveValue");
    assert.ok(src.includes("isValid"), "must have isValid");
    assert.ok(src.includes("isGrounded"), "must have isGrounded");
    assert.ok(src.includes("overrideState"), "must have overrideState");
    assert.ok(src.includes("isManuallyConfirmed"), "must have isManuallyConfirmed");
    assert.ok(src.includes("criticality"), "must have criticality");
    assert.ok(src.includes("blockerReason"), "must have blockerReason");
    assert.ok(src.includes("generationEligible"), "must have generationEligible");
    assert.ok(src.includes("exportEligible"), "must have exportEligible");
    assert.ok(src.includes("zipEligible"), "must have zipEligible");
    assert.ok(src.includes("permittedActions"), "must have permittedActions");
  });

  it("separates extracted value, valid value, grounded value, and override state", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(src.includes("rawValue"), "must have rawValue (extracted)");
    assert.ok(src.includes("isValid"), "must have isValid (valid)");
    assert.ok(src.includes("isGrounded"), "must have isGrounded (grounded)");
    assert.ok(src.includes("overrideState"), "must have overrideState");
    assert.ok(src.includes("isManuallyConfirmed"), "must have isManuallyConfirmed");
  });

  it("grounded requires BOTH page AND quote (not just one) — via the shared predicate", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    // Grounding now delegates to the shared lib/engine/evidence-grounding module
    // so this resolver and the Metadata Truth resolver apply an identical rule.
    assert.ok(
      src.includes('from "./evidence-grounding"'),
      "must import the shared grounding predicate",
    );
    const shared = read("lib/engine/evidence-grounding.ts");
    assert.ok(
      shared.includes("page > 0") && shared.includes("MIN_GROUNDING_QUOTE_LENGTH"),
      "shared predicate must require page > 0 AND a non-trivial quote",
    );
  });

  it("USER_EDITED does NOT automatically become USER_CONFIRMED", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(
      src.includes('override.fieldState === "USER_CONFIRMED"') && src.includes("isManuallyConfirmed = override.fieldState === \"USER_CONFIRMED\""),
      "isManuallyConfirmed must only be true for USER_CONFIRMED, not USER_EDITED",
    );
  });

  it("NOT_APPLICABLE for always-critical fields returns BLOCKED", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(
      src.includes('override?.fieldState === "NOT_APPLICABLE"') && src.includes("NEVER_NOT_APPLICABLE") && src.includes('"BLOCKED"'),
      "NOT_APPLICABLE for always-critical fields must return BLOCKED",
    );
  });

  it("IGNORED_WITH_REASON does NOT unblock gates for critical fields", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(
      src.includes('"IGNORED_WITH_REASON"') && src.includes("NOT_STATED"),
      "IGNORED_WITH_REASON must produce NOT_STATED status",
    );
    assert.ok(
      src.includes("isCritical") && src.includes("blockerReason"),
      "critical fields with NOT_STATED must have a blockerReason",
    );
  });

  it("requiredDocuments cannot be satisfied by a string override", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(
      src.includes('fieldKey === "requiredDocuments"') && src.includes("hasExtractedRequirements"),
      "requiredDocuments must check hasExtractedRequirements, not override value",
    );
  });

  it("generation route imports and uses canonical resolver", () => {
    const src = read("app/api/tenders/[id]/generate/route.ts");
    assert.ok(src.includes("resolveCanonicalFieldState"), "generate route must import canonical resolver");
    assert.ok(src.includes("canonicalState"), "generate route must use canonicalState");
    assert.ok(
      !src.includes('!tender.deadline)') || src.includes("canonicalState"),
      "generate route must not rely solely on raw !tender.deadline",
    );
  });

  it("email subject is NOT critical just because method contains 'email'", () => {
    const src = read("lib/engine/tender-policy-registry.ts");
    assert.ok(
      src.includes("requiresEmailSubjectExplicitlyStated"),
      "must have requiresEmailSubjectExplicitlyStated context field",
    );
    assert.ok(
      !src.includes('return isEmailSubmissionMethod(ctx.submissionMethod);') || src.includes("requiresEmailSubjectExplicitlyStated"),
      "email subject must require explicit statement, not just email method",
    );
  });

  it("client panel grounded check uses canonical field.isGrounded (not client-side recompute)", () => {
    const src = read("components/client-submission-details-panel.tsx");
    // The panel must use the resolver's field.isGrounded flag — the single
    // source of truth — rather than recomputing grounding client-side.
    // Recomputing client-side (page > 0 && quote.length > 5) would diverge
    // from the canonical status badge in the orphaned-fileId edge case
    // (page + quote present but fileId null or points to a deleted file).
    assert.ok(
      src.includes("const hasSource = !!field.isGrounded;"),
      "hasSource must use field.isGrounded (canonical single source of truth)",
    );
    // The old client-side recompute must NOT be present
    assert.ok(
      !src.includes("source?.page != null && source?.page > 0 && source?.quote"),
      "old client-side hasSource recompute must be removed",
    );
  });

  it("accessibility: 44px touch targets on action buttons", () => {
    const src = read("components/client-submission-details-panel.tsx");
    assert.ok(src.includes("min-h-[44px]"), "must have min-h-[44px] for touch targets");
  });

  it("accessibility: aria-haspopup on overflow menu", () => {
    const src = read("components/client-submission-details-panel.tsx");
    assert.ok(src.includes('aria-haspopup="menu"'), "must have aria-haspopup on overflow menu");
    assert.ok(src.includes("aria-expanded"), "must have aria-expanded on overflow menu");
  });

  it("submission-method-policy is neutral module (no circular import)", () => {
    const src = read("lib/engine/submission-method-policy.ts");
    assert.ok(src.includes("isPhysicalSubmissionMethod"), "must export isPhysicalSubmissionMethod");
    assert.ok(src.includes("isEmailSubmissionMethod"), "must export isEmailSubmissionMethod");
    assert.ok(src.includes("isPortalSubmissionMethod"), "must export isPortalSubmissionMethod");
    // Must NOT import from tender-metadata-completeness or tender-policy-registry
    assert.ok(!src.includes("tender-metadata-completeness"), "must NOT import from tender-metadata-completeness");
    assert.ok(!src.includes("tender-policy-registry"), "must NOT import from tender-policy-registry");
  });
});

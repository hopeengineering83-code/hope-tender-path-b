// Tests proving UI panels use the source-driven requiredForFinal field.
//
// PR #974 added requiredForFinal to CanonicalFieldState. This test suite
// proves client-submission-details-panel.tsx reads requiredForFinal instead
// of (or in addition to) the legacy criticality === "always-critical" label.
// (metadata-completion-panel.tsx and metadata-truth-panel.tsx, the other two
// panels originally covered here, were deleted as superseded dead code --
// both were read-only summaries of the same fields client-submission-details-panel.tsx
// fully subsumes.)
//
// What these tests prove:
//   1. Each panel reads requiredForFinal (with legacy fallback for safety)
//   2. A tender-derived required field (e.g. submissionEmails on email
//      tender) is now displayed as "Critical" even though it's NOT in
//      the legacy ALWAYS_CRITICAL_FIELDS set
//   3. The fallback `?? (field.criticality === "always-critical")` ensures
//      backward compat for snapshots that don't have requiredForFinal yet

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// "metadata-completion-panel.tsx uses requiredForFinal" removed --
// components/metadata-completion-panel.tsx was deleted as superseded dead
// code (a read-only summary of the same snapshot.metadata.fields data that
// client-submission-details-panel.tsx's ClientSubmissionDetailsPanel fully
// subsumes). Its requiredForFinal coverage lives on in section 2 below.

// ─── 2. client-submission-details-panel.tsx uses requiredForFinal ──────────

describe("UI panels — client-submission-details-panel uses requiredForFinal", () => {
  it("reads field.requiredForFinal in the field iteration", () => {
    const src = read("components/client-submission-details-panel.tsx");
    assert.ok(
      src.includes("field.requiredForFinal"),
      "must read field.requiredForFinal",
    );
    assert.ok(
      src.includes('?? (field.criticality === "always-critical")'),
      "must fall back to legacy criticality for backward compat",
    );
  });

  it("does NOT use criticality === 'always-critical' as the sole driver", () => {
    const src = read("components/client-submission-details-panel.tsx");
    assert.ok(
      !src.includes('const isCritical = field.criticality === "always-critical";'),
      "must not use criticality as the sole driver",
    );
  });
});

// "metadata-truth-panel.tsx uses requiredForFinal" removed --
// components/metadata-truth-panel.tsx was deleted as superseded dead code
// (a read-only summary of the same snapshot.metadata.fields data that
// client-submission-details-panel.tsx's ClientSubmissionDetailsPanel fully
// subsumes). Its requiredForFinal coverage lives on in section 2 above.

// ─── 4. Source-driven requiredForFinal is tender-derived (not universal) ────

describe("UI panels — requiredForFinal is tender-derived", () => {
  it("canonical-field-state computes requiredForFinal via isFactRequiredForFinal", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    assert.ok(
      src.includes("isFactRequiredForFinal(matchingFact, sourceDrivenDetail)"),
      "must compute requiredForFinal via isFactRequiredForFinal",
    );
    assert.ok(
      src.includes("const requiredForFinal = isCritical || sourceDrivenRequired"),
      "must OR legacy criticality with source-driven requirement",
    );
  });

  it("canonical-field-state handles evaluationCriteria ↔ evaluationMethodology key mismatch", () => {
    const src = read("lib/engine/canonical-field-state.ts");
    // The lookup must fall back to evaluationMethodology when evaluationCriteria is not found
    assert.ok(
      src.includes('fieldKey === "evaluationCriteria" && f.key === "evaluationMethodology"'),
      "must handle the evaluationCriteria ↔ evaluationMethodology key mismatch",
    );
  });
});

// ─── 5. Source-driven fieldDefs covers all canonical fieldKeys ─────────────

describe("UI panels — source-driven fieldDefs covers all canonical fields", () => {
  it("source-driven-tender-detail has fieldDefs for all canonical fieldKeys", () => {
    const src = read("lib/engine/source-driven-tender-detail.ts");
    // These are the fields canonical-field-state iterates. Each must have
    // a matching fact in source-driven-tender-detail so the matchingFact
    // lookup succeeds and requiredForFinal has a source-driven signal.
    const canonicalFields = [
      "clientName", "title", "reference", "deadline", "country", "currency",
      "submissionMethod", "submissionEndpoint", "submissionAddress",
      "submissionEmails", "submissionEmailSubject", "requiredDocuments",
      "evaluationCriteria", "clientContactName", "clientContactEmail",
      "clientContactPhone", "clientCity", "clientAddress", "clientWebsite",
      "clientRepresentative", "legalClientName", "donorAgency",
      "implementingAgency", "preBidChannel", "preBidMeetingDate",
      "preBidMeetingLocation", "pageLimit", "bidBondAmount",
      "mandatorySiteVisit", "validityDays", "numberOfCopiesRequired",
      "budget",
    ];
    for (const field of canonicalFields) {
      assert.ok(
        src.includes(`key: "${field}"`),
        `source-driven fieldDefs must include "${field}" so matchingFact lookup succeeds`,
      );
    }
  });
});

// ─── 6. Operation gate now enforces audit sufficiency for USER_CONFIRMED ───

describe("UI panels — operation gate audit sufficiency", () => {
  it("operation gate imports MIN_CRITICAL_REASON_LENGTH from tender-fact-authority", () => {
    const src = read("lib/engine/tender-operation-gate.ts");
    assert.ok(
      src.includes("MIN_CRITICAL_REASON_LENGTH"),
      "operation gate must import MIN_CRITICAL_REASON_LENGTH for audit check",
    );
    assert.ok(
      src.includes('from "./tender-fact-authority"'),
      "must import from tender-fact-authority",
    );
  });

  it("operation gate enforces audit sufficiency for USER_CONFIRMED on critical fields", () => {
    const src = read("lib/engine/tender-operation-gate.ts");
    assert.ok(
      src.includes("audit is incomplete"),
      "must surface audit incompleteness as a blocker",
    );
    assert.ok(
      src.includes("override.fieldState === \"USER_CONFIRMED\" || override.fieldState === \"USER_EDITED\""),
      "must check USER_CONFIRMED and USER_EDITED overrides",
    );
    assert.ok(
      src.includes("hasReason") && src.includes("hasConfirmationBasis"),
      "must check both reason and confirmationBasis",
    );
  });

  it("operation gate OperationGateInput overrides type includes reason and confirmationBasis", () => {
    const src = read("lib/engine/tender-operation-gate.ts");
    assert.ok(
      src.includes("reason?: string | null"),
      "OperationGateInput overrides must include reason field",
    );
    assert.ok(
      src.includes("confirmationBasis?: string | null"),
      "OperationGateInput overrides must include confirmationBasis field",
    );
  });
});

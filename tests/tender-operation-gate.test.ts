// Tests for the operation-aware tender gate resolver.
//
// The operation gate applies only the rules relevant to each operation:
//   ANALYSIS                   — never blocked by metadata
//   DRAFT_GENERATION           — never blocked by optional metadata
//   SUPPORT_PACKAGE_GENERATION — never blocked by optional metadata
//   REVIEW_EXPORT              — never blocked by optional metadata
//   FINAL_SUBMISSION_READY     — strict (source-grounded required facts, BuildPlan confirmed)
//
// Key principles tested:
//   1. Missing optional metadata NEVER blocks non-final operations
//   2. Placeholder values become warnings (not blockers) for non-final ops
//   3. FINAL_SUBMISSION_READY enforces critical fields, requirements, BuildPlan
//   4. Submission endpoint validation is operation-aware (EMAIL → email,
//      PHYSICAL → address, PORTAL → no endpoint required, HYBRID → at least one)
//   5. Contamination is a warning for non-final ops, blocker for FINAL
//   6. OCR_REQUIRED / REGEX_FALLBACK_FROM_WEAK_EXTRACTION are warnings for
//      non-final ops, blockers for FINAL

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  resolveTenderOperationGate,
  type OperationGateInput,
  type TenderOperation,
} from "../lib/engine/tender-operation-gate";

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeTender(overrides: Partial<OperationGateInput["tender"]> = {}): OperationGateInput["tender"] {
  return {
    id: "tender-1",
    title: "Test Tender",
    reference: "REF-001",
    clientName: "Ministry of Test",
    deadline: new Date("2024-12-31"),
    submissionMethod: "Email submission",
    submissionEmails: "test@example.com",
    submissionAddress: null,
    country: "Ethiopia",
    metadataContaminated: false,
    analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
    ...overrides,
  };
}

function makeInput(
  operation: TenderOperation,
  overrides: Partial<OperationGateInput> = {},
): OperationGateInput {
  return {
    tender: makeTender(),
    requirements: [{ priority: "MANDATORY", sourceTenderFileId: "file-1" }],
    overrides: [],
    buildPlan: { ok: true, items: [] },
    operation,
    ...overrides,
  };
}

// ─── 1. ANALYSIS — never blocked by metadata ────────────────────────────────

describe("operation gate — ANALYSIS", () => {
  it("is OK with full metadata", () => {
    const r = resolveTenderOperationGate(makeInput("ANALYSIS"));
    assert.equal(r.ok, true);
    assert.equal(r.operation, "ANALYSIS");
    assert.equal(r.blockers.length, 0);
  });

  it("is OK even when all optional metadata is missing", () => {
    const r = resolveTenderOperationGate(makeInput("ANALYSIS", {
      tender: makeTender({
        clientName: null,
        reference: null,
        deadline: null,
        submissionMethod: null,
        submissionEmails: null,
        country: null,
      }),
    }));
    assert.equal(r.ok, true, "ANALYSIS must never be blocked by missing metadata");
    assert.equal(r.blockers.length, 0);
  });

  it("is OK with contaminated metadata (warning only)", () => {
    const r = resolveTenderOperationGate(makeInput("ANALYSIS", {
      tender: makeTender({ metadataContaminated: true }),
    }));
    assert.equal(r.ok, true, "contamination is a warning, not a blocker, for ANALYSIS");
    assert.ok(r.warnings.some((w) => w.includes("contaminated")));
  });

  it("is OK with OCR_REQUIRED extraction status (warning only)", () => {
    const r = resolveTenderOperationGate(makeInput("ANALYSIS", {
      tender: makeTender({ analysisExtractionStatus: "OCR_REQUIRED" }),
    }));
    assert.equal(r.ok, true);
    assert.ok(r.warnings.length > 0);
  });
});

// ─── 2. DRAFT_GENERATION — never blocked by optional metadata ───────────────

describe("operation gate — DRAFT_GENERATION", () => {
  it("is OK with full metadata", () => {
    const r = resolveTenderOperationGate(makeInput("DRAFT_GENERATION"));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
  });

  it("is OK when clientName is missing (optional for draft)", () => {
    const r = resolveTenderOperationGate(makeInput("DRAFT_GENERATION", {
      tender: makeTender({ clientName: null }),
    }));
    assert.equal(r.ok, true, "missing clientName must not block DRAFT_GENERATION");
    assert.equal(r.blockers.length, 0);
  });

  it("is OK when submissionMethod is missing (optional for draft)", () => {
    const r = resolveTenderOperationGate(makeInput("DRAFT_GENERATION", {
      tender: makeTender({ submissionMethod: null, submissionEmails: null }),
    }));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
  });

  it("is OK when deadline is missing (optional for draft)", () => {
    const r = resolveTenderOperationGate(makeInput("DRAFT_GENERATION", {
      tender: makeTender({ deadline: null }),
    }));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
  });

  it("is OK when requirements are missing (optional for draft)", () => {
    const r = resolveTenderOperationGate(makeInput("DRAFT_GENERATION", {
      requirements: [],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
  });

  it("is OK when BuildPlan is not confirmed (optional for draft)", () => {
    const r = resolveTenderOperationGate(makeInput("DRAFT_GENERATION", {
      buildPlan: null,
    }));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
  });

  it("treats placeholder values as warnings, not blockers", () => {
    const r = resolveTenderOperationGate(makeInput("DRAFT_GENERATION", {
      tender: makeTender({ clientName: "TBD", reference: "N/A" }),
    }));
    assert.equal(r.ok, true);
    assert.ok(r.warnings.length > 0 || r.placeholderFields.length > 0);
  });
});

// ─── 3. SUPPORT_PACKAGE_GENERATION — never blocked by optional metadata ─────

describe("operation gate — SUPPORT_PACKAGE_GENERATION", () => {
  it("is OK with full metadata", () => {
    const r = resolveTenderOperationGate(makeInput("SUPPORT_PACKAGE_GENERATION"));
    assert.equal(r.ok, true);
  });

  it("is OK when all optional metadata is missing", () => {
    const r = resolveTenderOperationGate(makeInput("SUPPORT_PACKAGE_GENERATION", {
      tender: makeTender({
        clientName: null,
        reference: null,
        deadline: null,
        submissionMethod: null,
        submissionEmails: null,
      }),
      requirements: [],
      buildPlan: null,
    }));
    assert.equal(r.ok, true, "SUPPORT_PACKAGE_GENERATION must not be blocked by missing optional metadata");
    assert.equal(r.blockers.length, 0);
  });
});

// ─── 4. REVIEW_EXPORT — never blocked by optional metadata ──────────────────

describe("operation gate — REVIEW_EXPORT", () => {
  it("is OK with full metadata", () => {
    const r = resolveTenderOperationGate(makeInput("REVIEW_EXPORT"));
    assert.equal(r.ok, true);
  });

  it("is OK when optional metadata is missing (review export is non-final)", () => {
    const r = resolveTenderOperationGate(makeInput("REVIEW_EXPORT", {
      tender: makeTender({
        clientName: null,
        deadline: null,
      }),
    }));
    assert.equal(r.ok, true, "REVIEW_EXPORT must not be blocked by missing optional metadata");
    assert.equal(r.blockers.length, 0);
  });

  it("is OK without a confirmed BuildPlan (review export is non-final)", () => {
    const r = resolveTenderOperationGate(makeInput("REVIEW_EXPORT", {
      buildPlan: null,
    }));
    assert.equal(r.ok, true);
  });
});

// ─── 5. FINAL_SUBMISSION_READY — strict gate ────────────────────────────────

describe("operation gate — FINAL_SUBMISSION_READY (strict)", () => {
  it("is OK when all required facts are present and grounded", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY"));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
  });

  it("blocks when clientName is missing", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ clientName: null }),
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("clientName")));
  });

  it("blocks when title is missing", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ title: null }),
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("title")));
  });

  it("blocks when deadline is missing", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ deadline: null }),
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("deadline")));
  });

  it("blocks when submissionMethod is missing", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ submissionMethod: null }),
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("submissionMethod")));
  });

  it("blocks when no requirements are extracted", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      requirements: [],
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("requirements")));
  });

  it("blocks when BuildPlan is not confirmed", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      buildPlan: null,
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("Build Plan")));
  });

  it("blocks when BuildPlan is present but not ok", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      buildPlan: { ok: false, items: [] },
    }));
    assert.equal(r.ok, false);
  });

  it("blocks when critical field contains placeholder", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ clientName: "TBD" }),
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("clientName")));
  });

  it("blocks when metadata is contaminated", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ metadataContaminated: true }),
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("contaminated")));
  });

  it("blocks when OCR_REQUIRED extraction status", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ analysisExtractionStatus: "OCR_REQUIRED" }),
    }));
    assert.equal(r.ok, false);
  });
});

// ─── 6. Submission endpoint validation (operation-aware) ────────────────────

describe("operation gate — submission endpoint validation", () => {
  it("EMAIL submission: FINAL requires submissionEmails", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: "Email submission",
        submissionEmails: null,
        submissionAddress: null,
      }),
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("email")));
  });

  it("EMAIL submission: DRAFT does NOT require submissionEmails", () => {
    const r = resolveTenderOperationGate(makeInput("DRAFT_GENERATION", {
      tender: makeTender({
        submissionMethod: "Email submission",
        submissionEmails: null,
        submissionAddress: null,
      }),
    }));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
  });

  it("PHYSICAL submission: FINAL requires submissionAddress", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: "Sealed envelope by hand",
        submissionEmails: null,
        submissionAddress: null,
      }),
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("address")));
  });

  it("PHYSICAL submission: DRAFT does NOT require submissionAddress", () => {
    const r = resolveTenderOperationGate(makeInput("DRAFT_GENERATION", {
      tender: makeTender({
        submissionMethod: "Sealed envelope by hand",
        submissionEmails: null,
        submissionAddress: null,
      }),
    }));
    assert.equal(r.ok, true);
  });

  it("PORTAL submission: FINAL does NOT require email OR address", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: "Submit through the e-procurement portal",
        submissionEmails: null,
        submissionAddress: null,
      }),
    }));
    // Portal: no email/address required — portal URL is a valid endpoint
    // Other blockers may exist (e.g. if BuildPlan missing) but NOT endpoint
    const endpointBlockers = r.blockers.filter((b) => b.includes("email") || b.includes("address"));
    assert.equal(endpointBlockers.length, 0, "PORTAL must not require email or address");
  });

  it("HYBRID submission: FINAL requires at least one endpoint", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: "Email or sealed envelope",
        submissionEmails: null,
        submissionAddress: null,
      }),
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("endpoint")));
  });

  it("HYBRID submission: FINAL is OK when email endpoint is present", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: "Email or sealed envelope",
        submissionEmails: "test@example.com",
        submissionAddress: null,
      }),
    }));
    assert.equal(r.ok, true);
  });

  it("HYBRID submission: FINAL is OK when address endpoint is present", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: "Email or sealed envelope",
        submissionEmails: null,
        submissionAddress: "123 Main Street",
      }),
    }));
    assert.equal(r.ok, true);
  });

  it("UNKNOWN submission method: FINAL warns but does not block on endpoint", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: null,
        submissionEmails: null,
        submissionAddress: null,
      }),
    }));
    // submissionMethod null → blockers will include submissionMethod critical check
    assert.equal(r.ok, false);
    // But there should be no endpoint-specific blocker
    const endpointBlockers = r.blockers.filter((b) => b.includes("endpoint"));
    assert.equal(endpointBlockers.length, 0);
  });
});

// ─── 7. Override-aware ──────────────────────────────────────────────────────

describe("operation gate — overrides", () => {
  it("FINAL: USER_CONFIRMED override on critical field WITH audit resolves the blocker", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ clientName: null }),
      overrides: [
        {
          field: "clientName",
          fieldState: "USER_CONFIRMED",
          overrideValue: "Ministry of Test",
          reason: "Confirmed via phone call to procurement office",
          confirmationBasis: "PHONE_CALL",
        },
      ],
    }));
    assert.equal(r.ok, true, "USER_CONFIRMED override with audit should resolve the missing clientName blocker");
  });

  it("FINAL: USER_CONFIRMED override on critical field WITHOUT audit does NOT resolve the blocker", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ clientName: null }),
      overrides: [
        { field: "clientName", fieldState: "USER_CONFIRMED", overrideValue: "Ministry of Test" },
      ],
    }));
    assert.equal(r.ok, false, "USER_CONFIRMED override without audit should NOT resolve the blocker");
    assert.ok(r.blockers.some((b) => b.includes("audit is incomplete")), "should mention incomplete audit");
  });

  it("FINAL: USER_CONFIRMED override with reason but no confirmationBasis does NOT resolve", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ clientName: null }),
      overrides: [
        {
          field: "clientName",
          fieldState: "USER_CONFIRMED",
          overrideValue: "Ministry of Test",
          reason: "Confirmed via phone call to procurement office",
        },
      ],
    }));
    assert.equal(r.ok, false, "USER_CONFIRMED override without confirmationBasis should NOT resolve");
  });

  it("FINAL: USER_EDITED override on submissionEmails (non-critical for FINAL CRITICAL_FINAL_FIELDS) resolves EMAIL endpoint blocker", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: "Email submission",
        submissionEmails: null,
      }),
      overrides: [
        { field: "submissionEmails", fieldState: "USER_EDITED", overrideValue: "manual@example.com" },
      ],
    }));
    assert.equal(r.ok, true, "USER_EDITED override on submissionEmails should resolve endpoint blocker");
  });

  it("FINAL: NOT_APPLICABLE override does NOT resolve critical field blocker", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ clientName: null }),
      overrides: [
        { field: "clientName", fieldState: "NOT_APPLICABLE" },
      ],
    }));
    // NOT_APPLICABLE is not a resolving state for critical fields
    assert.equal(r.ok, false);
  });

  it("FINAL: IGNORED_WITH_REASON override on submissionEmails does NOT resolve the EMAIL endpoint blocker", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: "Email submission",
        submissionEmails: null,
      }),
      overrides: [
        { field: "submissionEmails", fieldState: "IGNORED_WITH_REASON", reason: "Tender source never states an email address" },
      ],
    }));
    // An audited absence is not a value — the endpoint requirement must still block.
    assert.equal(r.ok, false, "IGNORED_WITH_REASON should NOT resolve the missing submission email endpoint");
    assert.ok(r.blockers.some((b) => b.includes("Email submission method requires")));
  });

  it("FINAL: IGNORED_WITH_REASON override on submissionAddress does NOT resolve the PHYSICAL endpoint blocker", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: "Physical delivery",
        submissionAddress: null,
      }),
      overrides: [
        { field: "submissionAddress", fieldState: "IGNORED_WITH_REASON", reason: "Tender source never states a delivery address" },
      ],
    }));
    assert.equal(r.ok, false, "IGNORED_WITH_REASON should NOT resolve the missing submission address endpoint");
    assert.ok(r.blockers.some((b) => b.includes("Physical submission method requires")));
  });

  it("FINAL: USER_EDITED override on submissionEmails resolves the HYBRID endpoint blocker (parity with EMAIL/PHYSICAL)", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: "Email or sealed envelope",
        submissionEmails: null,
        submissionAddress: null,
      }),
      overrides: [
        { field: "submissionEmails", fieldState: "USER_EDITED", overrideValue: "manual@example.com" },
      ],
    }));
    assert.equal(r.ok, true, "USER_EDITED override on submissionEmails should resolve the HYBRID endpoint blocker");
  });

  it("FINAL: IGNORED_WITH_REASON override does NOT resolve the HYBRID endpoint blocker", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        submissionMethod: "Email or sealed envelope",
        submissionEmails: null,
        submissionAddress: null,
      }),
      overrides: [
        { field: "submissionEmails", fieldState: "IGNORED_WITH_REASON", reason: "Tender source never states an email address" },
        { field: "submissionAddress", fieldState: "IGNORED_WITH_REASON", reason: "Tender source never states a delivery address" },
      ],
    }));
    assert.equal(r.ok, false, "IGNORED_WITH_REASON on both endpoints should NOT resolve the HYBRID endpoint blocker");
  });
});

// ─── 8. Placeholder handling ────────────────────────────────────────────────

describe("operation gate — placeholder handling", () => {
  it("DRAFT: optional field with placeholder value is a warning, not a blocker", () => {
    const r = resolveTenderOperationGate(makeInput("DRAFT_GENERATION", {
      tender: makeTender({
        reference: "TBD",
        country: "N/A",
      }),
    }));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
    // Placeholder fields should be tracked
    assert.ok(r.placeholderFields.includes("reference") || r.warnings.some((w) => w.includes("reference")));
  });

  it("FINAL: critical field with placeholder value is a blocker", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ clientName: "TBD" }),
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("clientName")));
  });

  it("FINAL: critical field with 'Not specified' is a blocker", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({ clientName: "Not specified" }),
    }));
    assert.equal(r.ok, false);
  });
});

// ─── 9. Architectural: operation gate is the single authority ───────────────

describe("operation gate — architectural guarantees", () => {
  it("returns operation field on every result", () => {
    for (const op of ["ANALYSIS", "DRAFT_GENERATION", "SUPPORT_PACKAGE_GENERATION", "REVIEW_EXPORT", "FINAL_SUBMISSION_READY"] as const) {
      const r = resolveTenderOperationGate(makeInput(op));
      assert.equal(r.operation, op);
    }
  });

  it("non-final operations never return blockers from missing metadata", () => {
    for (const op of ["ANALYSIS", "DRAFT_GENERATION", "SUPPORT_PACKAGE_GENERATION", "REVIEW_EXPORT"] as const) {
      const r = resolveTenderOperationGate(makeInput(op, {
        tender: makeTender({
          clientName: null,
          reference: null,
          deadline: null,
          submissionMethod: null,
          submissionEmails: null,
          country: null,
        }),
        requirements: [],
        buildPlan: null,
      }));
      assert.equal(r.ok, true, `${op} must be OK with missing metadata`);
      assert.equal(r.blockers.length, 0, `${op} must have no blockers`);
    }
  });

  it("FINAL_SUBMISSION_READY has at least one blocker when all critical fields are missing", () => {
    const r = resolveTenderOperationGate(makeInput("FINAL_SUBMISSION_READY", {
      tender: makeTender({
        title: null,
        clientName: null,
        deadline: null,
        submissionMethod: null,
      }),
      requirements: [],
      buildPlan: null,
    }));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.length >= 4, "should have multiple blockers");
  });
});

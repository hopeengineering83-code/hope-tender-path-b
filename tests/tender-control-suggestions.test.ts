// H — Controls Ledger suggestion derivation + Accept/Reject wiring.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deriveControlSuggestions,
  isHighConfidenceSuggestion,
  type SuggestionDerivationInput,
} from "../lib/engine/tender-control-suggestions";

function baseInput(over: Partial<SuggestionDerivationInput> = {}): SuggestionDerivationInput {
  return {
    metadataStatus: { criticalMissing: [] },
    analysisStatus: { source: "AI_VERIFIED" },
    sourceReferenceStatus: { ungroundedMandatoryCount: 0, totalMandatoryCount: 5 },
    planStatus: { hasExplicitPlan: true, totalRequired: 10, totalMissing: 0, totalOutsidePlan: 0 },
    evidenceStatus: { totalRequirements: 10, requirementsWithLinkedEvidence: 8 },
    counts: { finalExportCandidates: 5, qualityFailedCandidates: 0, outsidePlanRows: 0 },
    providerStatus: { hasAnyProvider: true, hasCooledDownProvider: false },
    officialOriginalStatus: { required: 0, attached: 0 },
    ...over,
  };
}

describe("deriveControlSuggestions — every blocker category from the audit task", () => {
  it("returns empty when everything is healthy", () => {
    assert.deepEqual(deriveControlSuggestions(baseInput()), []);
  });

  it("AI_PROVIDERS_NOT_CONFIGURED when hasAnyProvider is false", () => {
    const out = deriveControlSuggestions(baseInput({ providerStatus: { hasAnyProvider: false, hasCooledDownProvider: false } }));
    assert.ok(out.some((s) => s.code === "AI_PROVIDERS_NOT_CONFIGURED" && s.severity === "HIGH"));
  });

  it("AI_PROVIDERS_COOLING when hasCooledDownProvider is true and providers ARE configured", () => {
    const out = deriveControlSuggestions(baseInput({ providerStatus: { hasAnyProvider: true, hasCooledDownProvider: true } }));
    assert.ok(out.some((s) => s.code === "AI_PROVIDERS_COOLING" && s.severity === "MEDIUM"));
    // Should NOT also flag "not configured" — that's a distinct precondition.
    assert.ok(!out.some((s) => s.code === "AI_PROVIDERS_NOT_CONFIGURED"));
  });

  it("REGEX_FALLBACK_UNAPPROVED on any of the known regex-fallback markers", () => {
    for (const src of ["REGEX_FALLBACK_AI_ERROR", "REGEX_FALLBACK", "DETERMINISTIC_FALLBACK", "UNKNOWN_FALLBACK", "AI_PROVIDERS_EXHAUSTED"]) {
      const out = deriveControlSuggestions(baseInput({ analysisStatus: { source: src } }));
      assert.ok(out.some((s) => s.code === "REGEX_FALLBACK_UNAPPROVED"), `should suggest for source: ${src}`);
    }
  });

  it("METADATA_INCOMPLETE names the missing fields", () => {
    const out = deriveControlSuggestions(baseInput({ metadataStatus: { criticalMissing: ["deadline", "evaluationCriteria", "submissionMethod"] } }));
    const s = out.find((s) => s.code === "TENDER_FACTS_INCOMPLETE");
    assert.ok(s);
    assert.match(s!.description, /deadline/);
    assert.match(s!.description, /evaluationCriteria/);
  });

  it("SOURCE_REFS_MISSING when ungroundedMandatoryCount > 0", () => {
    const out = deriveControlSuggestions(baseInput({ sourceReferenceStatus: { ungroundedMandatoryCount: 3, totalMandatoryCount: 5 } }));
    assert.ok(out.some((s) => s.code === "SOURCE_REFS_MISSING"));
  });

  it("MANDATORY_COVERAGE_ZERO when totalRequirements > 0 AND coverage = 0", () => {
    const out = deriveControlSuggestions(baseInput({ evidenceStatus: { totalRequirements: 7, requirementsWithLinkedEvidence: 0 } }));
    assert.ok(out.some((s) => s.code === "MANDATORY_COVERAGE_ZERO" && s.severity === "HIGH"));
  });

  it("SUBMISSION_PLAN_NOT_BUILT when no explicit plan AND zero plan rows", () => {
    const out = deriveControlSuggestions(baseInput({ planStatus: { hasExplicitPlan: false, totalRequired: 0, totalMissing: 0, totalOutsidePlan: 0 } }));
    assert.ok(out.some((s) => s.code === "SUBMISSION_PLAN_NOT_BUILT"));
  });

  it("PLANNED_DOCS_NOT_GENERATED when plan exists with missing rows", () => {
    const out = deriveControlSuggestions(baseInput({ planStatus: { hasExplicitPlan: true, totalRequired: 10, totalMissing: 4, totalOutsidePlan: 0 } }));
    const s = out.find((x) => x.code === "PLANNED_DOCS_NOT_GENERATED");
    assert.ok(s);
    assert.match(s!.title, /4 planned/);
  });

  it("OUTSIDE_PLAN_DOCS when outsidePlanRows > 0", () => {
    const out = deriveControlSuggestions(baseInput({ counts: { finalExportCandidates: 5, qualityFailedCandidates: 0, outsidePlanRows: 6 } }));
    assert.ok(out.some((s) => s.code === "OUTSIDE_PLAN_DOCS"));
  });

  it("NO_ACTIVE_EXPORT_CANDIDATES when finalExportCandidates is 0", () => {
    const out = deriveControlSuggestions(baseInput({ counts: { finalExportCandidates: 0, qualityFailedCandidates: 0, outsidePlanRows: 0 } }));
    assert.ok(out.some((s) => s.code === "NO_ACTIVE_EXPORT_CANDIDATES" && s.severity === "HIGH"));
  });

  it("MISSING_OFFICIAL_ORIGINALS when required > attached", () => {
    const out = deriveControlSuggestions(baseInput({ officialOriginalStatus: { required: 3, attached: 1 } }));
    const s = out.find((x) => x.code === "MISSING_OFFICIAL_ORIGINALS");
    assert.ok(s);
    assert.match(s!.title, /2 official original/);
  });

  it("QUALITY_FAILED_DOCS when qualityFailedCandidates > 0", () => {
    const out = deriveControlSuggestions(baseInput({ counts: { finalExportCandidates: 1, qualityFailedCandidates: 2, outsidePlanRows: 0 } }));
    assert.ok(out.some((s) => s.code === "QUALITY_FAILED_DOCS" && s.severity === "HIGH"));
  });

  it("every suggestion carries a stable id 'suggestion:<code>'", () => {
    const out = deriveControlSuggestions(baseInput({
      metadataStatus: { criticalMissing: ["deadline"] },
      analysisStatus: { source: "REGEX_FALLBACK_AI_ERROR" },
    }));
    for (const s of out) {
      assert.equal(s.id, `suggestion:${s.code}`);
      assert.equal(s.status, "SUGGESTED");
      assert.equal(s.createdBy, null);
    }
  });

  it("Pharo-style worst case yields a comprehensive set", () => {
    const out = deriveControlSuggestions({
      metadataStatus: { criticalMissing: ["deadline", "evaluationCriteria"] },
      analysisStatus: { source: "REGEX_FALLBACK_AI_ERROR" },
      sourceReferenceStatus: { ungroundedMandatoryCount: 4, totalMandatoryCount: 4 },
      planStatus: { hasExplicitPlan: false, totalRequired: 0, totalMissing: 0, totalOutsidePlan: 0 },
      evidenceStatus: { totalRequirements: 10, requirementsWithLinkedEvidence: 0 },
      counts: { finalExportCandidates: 0, qualityFailedCandidates: 0, outsidePlanRows: 15 },
      providerStatus: { hasAnyProvider: true, hasCooledDownProvider: true },
      officialOriginalStatus: { required: 2, attached: 0 },
    });
    const codes = out.map((s) => s.code);
    for (const expected of [
      "AI_PROVIDERS_COOLING",
      "REGEX_FALLBACK_UNAPPROVED",
      "TENDER_FACTS_INCOMPLETE",
      "SOURCE_REFS_MISSING",
      "MANDATORY_COVERAGE_ZERO",
      "SUBMISSION_PLAN_NOT_BUILT",
      "OUTSIDE_PLAN_DOCS",
      "NO_ACTIVE_EXPORT_CANDIDATES",
      "MISSING_OFFICIAL_ORIGINALS",
    ]) {
      assert.ok(codes.includes(expected as never), `Pharo case missing: ${expected}`);
    }
  });
});

describe("isHighConfidenceSuggestion — bulk-accept eligibility", () => {
  it("HIGH-severity, deterministic categories ARE high-confidence", () => {
    for (const code of [
      "AI_PROVIDERS_NOT_CONFIGURED",
      "REGEX_FALLBACK_UNAPPROVED",
      "TENDER_FACTS_INCOMPLETE",
      "MANDATORY_COVERAGE_ZERO",
      "NO_ACTIVE_EXPORT_CANDIDATES",
      "MISSING_OFFICIAL_ORIGINALS",
      "QUALITY_FAILED_DOCS",
    ] as const) {
      assert.equal(isHighConfidenceSuggestion({ code, severity: "HIGH", type: "TASK", title: "", description: "", nextAction: "", id: "", status: "SUGGESTED", createdAt: "", createdBy: null }), true);
    }
  });
  it("MEDIUM-severity is NEVER high-confidence (avoid bulk-accepting weak signals)", () => {
    assert.equal(isHighConfidenceSuggestion({ code: "AI_PROVIDERS_COOLING", severity: "MEDIUM", type: "RISK", title: "", description: "", nextAction: "", id: "", status: "SUGGESTED", createdAt: "", createdBy: null }), false);
    assert.equal(isHighConfidenceSuggestion({ code: "OUTSIDE_PLAN_DOCS", severity: "MEDIUM", type: "TASK", title: "", description: "", nextAction: "", id: "", status: "SUGGESTED", createdAt: "", createdBy: null }), false);
  });
});

describe("Reject endpoint contract — source level", () => {
  const src = readFileSync("app/api/tenders/[id]/controls/suggestions/reject/route.ts", "utf8");
  it("validates the suggestion code against a known set", () => {
    assert.match(src, /KNOWN_CODES/);
    assert.match(src, /INVALID_SUGGESTION_CODE/);
  });
  it("requires ADMIN or PROPOSAL_MANAGER", () => {
    assert.match(src, /requireRole\("ADMIN",\s*"PROPOSAL_MANAGER"\)/);
  });
  it("writes a TENDER_CONTROL_SUGGESTION_REJECTED audit entry with the code", () => {
    assert.match(src, /action:\s*"TENDER_CONTROL_SUGGESTION_REJECTED"/);
    assert.match(src, /suggestionCode:\s*code/);
  });
});

describe("Controls GET hides previously-rejected suggestions on subsequent loads", () => {
  const src = readFileSync("app/api/tenders/[id]/controls/route.ts", "utf8");
  it("reads TENDER_CONTROL_SUGGESTION_REJECTED audit rows and filters by suggestionCode", () => {
    assert.match(src, /action:\s*"TENDER_CONTROL_SUGGESTION_REJECTED"/);
    assert.match(src, /suggestionCode/);
    assert.match(src, /rejectedCodes/);
    assert.match(src, /\.filter\(\(s\)\s*=>\s*!rejectedCodes\.has\(s\.code\)\)/);
  });
});

describe("Panel wires Accept / Reject / Accept-all", () => {
  const src = "" /* deleted */;
  it("renders the suggestions block when the API returned any", () => {
    assert.match(src, /data\.suggestedControls\.length > 0/);
    assert.match(src, /Suggested controls/);
  });
  it("Accept posts to the existing controls endpoint with the suggested payload", () => {
    assert.match(src, /async function acceptSuggestion/);
    assert.match(src, /\/api\/tenders\/\$\{tenderId\}\/controls/);
  });
  it("Reject posts to the new suggestions/reject endpoint", () => {
    assert.match(src, /\/api\/tenders\/\$\{tenderId\}\/controls\/suggestions\/reject/);
    assert.match(src, /code:\s*s\.code/);
  });
  it("Accept-all only targets HIGH-confidence codes", () => {
    assert.match(src, /HIGH_CONFIDENCE_CODES\.includes\(s\.code\)/);
    assert.match(src, /Accept all high-confidence/);
  });
});

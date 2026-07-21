// Tests for the canonical readiness helper's pure logic.
//
// The async getFinalSubmissionReadiness() function reads Prisma and is
// covered at the integration layer (Vercel preview + manual smoke). This
// file exercises only the pure helpers exported via __testing__ so it can
// run in the standard `npm test` flow without a live database.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  __testing__,
  ADVISORY_GAP_PREFIX,
  buildAdvisoryGapTitle,
  parseAdvisoryGapTitle,
  isAdvisoryCode,
} from "../lib/engine/final-submission-readiness";

const { severityForReasons, nextActionForReason, derivePlanStatus, applyAdvisoryResolutions, buildMessage, detectMessageType, mandatoryEvidenceCoverageRatio } = __testing__;

describe("final-submission-readiness — severityForReasons", () => {
  it("returns HIGH for missing-content reasons", () => {
    assert.equal(severityForReasons(["fileContent is missing"]), "HIGH");
    assert.equal(severityForReasons(["DOCUMENTS_MISSING_CONTENT"]), "HIGH");
  });
  it("returns HIGH for official-original / placeholder / planned reasons", () => {
    assert.equal(severityForReasons(["ORIGINAL_REQUIRED"]), "HIGH");
    assert.equal(severityForReasons(["[CONTROL_RECORD_ONLY] control row"]), "HIGH");
    assert.equal(severityForReasons(["PLANNED"]), "HIGH");
    assert.equal(severityForReasons(["REPLACE_WITH_ORIGINAL"]), "HIGH");
    assert.equal(severityForReasons(["NOT_EXPORTABLE"]), "HIGH");
    assert.equal(severityForReasons(["PDF_CONVERSION_REQUIRED"]), "HIGH");
  });
  it("returns MEDIUM for validation/review/quick-draft reasons", () => {
    assert.equal(severityForReasons(["validationStatus is FAILED"]), "MEDIUM");
    assert.equal(severityForReasons(["reviewStatus is PENDING"]), "MEDIUM");
    assert.equal(severityForReasons(["QUICK_DRAFT"]), "MEDIUM");
  });
  it("returns LOW for unknown reasons", () => {
    assert.equal(severityForReasons(["something else"]), "LOW");
  });
});

describe("final-submission-readiness — nextActionForReason", () => {
  it("guides users to attach original for tender-issued forms", () => {
    assert.match(nextActionForReason("ORIGINAL_REQUIRED"), /Attach.*original/i);
    assert.match(nextActionForReason("REPLACE_WITH_ORIGINAL"), /Attach.*original/i);
  });
  it("guides users to generate when planned/control", () => {
    assert.match(nextActionForReason("[CONTROL_RECORD_ONLY] x"), /Generate.*final file|attach.*original/i);
    assert.match(nextActionForReason("PLANNED"), /Generate.*final file|attach.*original/i);
  });
  it("guides users to fix missing content", () => {
    assert.match(nextActionForReason("fileContent is missing"), /Regenerate.*upload.*missing/i);
    assert.match(nextActionForReason("MISSING_CONTENT"), /Regenerate.*upload.*missing/i);
  });
  it("guides users to complete validation/review", () => {
    assert.match(nextActionForReason("validationStatus is FAILED"), /validation/i);
    assert.match(nextActionForReason("reviewStatus is PENDING"), /review/i);
  });
});

describe("final-submission-readiness — derivePlanStatus", () => {
  it("NO_PLAN_NO_DOCS when both are empty", () => {
    assert.equal(derivePlanStatus({ requiredPlanCount: 0, finalCandidateCount: 0, missingCount: 0, extraCount: 0, nameMismatch: false, orderMismatch: false }), "NO_PLAN_NO_DOCS");
  });
  it("NO_PLAN_WITH_ACTIVE_DOCS when docs exist without plan", () => {
    assert.equal(derivePlanStatus({ requiredPlanCount: 0, finalCandidateCount: 3, missingCount: 0, extraCount: 0, nameMismatch: false, orderMismatch: false }), "NO_PLAN_WITH_ACTIVE_DOCS");
  });
  it("PLAN_MATCHED when counts align with no mismatches", () => {
    assert.equal(derivePlanStatus({ requiredPlanCount: 3, finalCandidateCount: 3, missingCount: 0, extraCount: 0, nameMismatch: false, orderMismatch: false }), "PLAN_MATCHED");
  });
  it("PLAN_MISSING_DOCS when planned files are missing", () => {
    assert.equal(derivePlanStatus({ requiredPlanCount: 3, finalCandidateCount: 1, missingCount: 2, extraCount: 0, nameMismatch: false, orderMismatch: false }), "PLAN_MISSING_DOCS");
  });
  it("PLAN_EXTRA_DOCS when docs exceed plan", () => {
    assert.equal(derivePlanStatus({ requiredPlanCount: 2, finalCandidateCount: 5, missingCount: 0, extraCount: 3, nameMismatch: false, orderMismatch: false }), "PLAN_EXTRA_DOCS");
  });
  it("PLAN_NAME_MISMATCH when names diverge but counts align", () => {
    assert.equal(derivePlanStatus({ requiredPlanCount: 2, finalCandidateCount: 2, missingCount: 0, extraCount: 0, nameMismatch: true, orderMismatch: false }), "PLAN_NAME_MISMATCH");
  });
  it("DERIVED_PLAN_UNCONFIRMED when a derived plan matches counts but lacks tender-issued scope", () => {
    assert.equal(derivePlanStatus({ requiredPlanCount: 2, finalCandidateCount: 2, missingCount: 0, extraCount: 0, nameMismatch: false, orderMismatch: false, hasExplicitScope: false }), "DERIVED_PLAN_UNCONFIRMED");
  });
});

describe("final-submission-readiness — applyAdvisoryResolutions", () => {
  it("drops resolved advisories from the response", () => {
    const advisory = { category: "DONOR_ESMP_MISSING", severity: "MEDIUM", title: "ESMP missing", recommendedAction: "Add ESMP" };
    const resolved = new Map([["DONOR_ESMP_MISSING", { resolved: true, note: "NOT_REQUIRED_BY_TOR" }]]);
    assert.equal(applyAdvisoryResolutions([advisory], resolved).length, 0);
  });
  it("keeps unresolved advisories with their original action text", () => {
    const advisory = { category: "DONOR_LOGFRAME_MISSING", severity: "MEDIUM", title: "Logframe missing", recommendedAction: "Add logframe" };
    const out = applyAdvisoryResolutions([advisory], new Map());
    assert.equal(out.length, 1);
    assert.equal(out[0].code, "DONOR_LOGFRAME_MISSING");
    assert.equal(out[0].resolved, false);
  });
  it("safely handles undefined input", () => {
    assert.equal(applyAdvisoryResolutions(undefined, new Map()).length, 0);
  });
});

describe("final-submission-readiness — advisory code helpers", () => {
  it("buildAdvisoryGapTitle / parseAdvisoryGapTitle round-trip", () => {
    const code = "DONOR_ESMP_MISSING";
    const title = buildAdvisoryGapTitle(code);
    assert.equal(title, `${ADVISORY_GAP_PREFIX}${code}`);
    assert.equal(parseAdvisoryGapTitle(title), code);
  });
  it("isAdvisoryCode distinguishes ADVISORY-prefixed titles", () => {
    assert.equal(isAdvisoryCode("ADVISORY:X"), true);
    assert.equal(isAdvisoryCode("Some regular gap title"), false);
  });
  it("parseAdvisoryGapTitle returns null for non-advisory titles", () => {
    assert.equal(parseAdvisoryGapTitle("Some regular gap"), null);
  });
});

describe("final-submission-readiness — buildMessage", () => {
  it("ok=true returns the green message", () => {
    assert.match(buildMessage({ ok: true, documentBlockers: [], tenderLevelBlockers: [], advisoryWarnings: [] }), /Export gate passed/);
  });
  it("ok=false lists separate categories rather than one paragraph", () => {
    const msg = buildMessage({
      ok: false,
      documentBlockers: [{ documentId: "1", name: "x", fileName: "x.docx", reasons: ["r"], severity: "HIGH", nextActions: [] }],
      tenderLevelBlockers: [{ category: "X", severity: "HIGH", title: "x" }],
      advisoryWarnings: [{ category: "DONOR_X", severity: "MEDIUM", title: "x", code: "DONOR_X" }],
    });
    assert.match(msg, /1 document is not ready/i);
    assert.match(msg, /1 tender-level blocker/i);
    assert.match(msg, /1 advisory warning/i);
  });
});

describe("final-submission-readiness — detectMessageType", () => {
  it("counts missing-content failures distinctly", () => {
    const out = detectMessageType([
      { documentId: "1", name: "a", fileName: "a.docx", reasons: ["fileContent is missing"] },
      { documentId: "2", name: "b", fileName: "b.docx", reasons: ["DOCUMENTS_MISSING_CONTENT: missing"] },
    ]);
    assert.equal(out.missingContent, 2);
  });
  it("counts hygiene issues distinctly", () => {
    const out = detectMessageType([
      { documentId: "1", name: "a", fileName: "a.docx", reasons: ["AI/meta-preparation trace text"] },
      { documentId: "2", name: "b", fileName: "b.docx", reasons: ["Placeholder or unresolved"] },
      { documentId: "3", name: "c", fileName: "c.docx", reasons: ["pricing language detected"] },
    ]);
    assert.ok(out.hygiene >= 3);
  });
  it("counts original-required failures distinctly", () => {
    const out = detectMessageType([
      { documentId: "1", name: "a", fileName: "a.docx", reasons: ["ORIGINAL_REQUIRED: tender-issued original"] },
    ]);
    assert.equal(out.originalRequired, 1);
  });
});

describe("final-submission-readiness — mandatory evidence coverage truth", () => {
  it("selected/unconfirmed evidence suggestions do not count without complianceMatrix rows", () => {
    const ratio = mandatoryEvidenceCoverageRatio([
      { priority: "MANDATORY", complianceMatrixRows: [] },
    ]);
    assert.equal(ratio, 0);
  });

  it("sourceConfidence without a complianceMatrix row does not count as FULL/SUBSTANTIAL coverage", () => {
    const ratio = mandatoryEvidenceCoverageRatio([
      { priority: "MANDATORY", sourceConfidence: 0.95, complianceMatrixRows: [] } as { priority: string; sourceConfidence: number; complianceMatrixRows: [] },
    ]);
    assert.equal(ratio, 0);
  });

  it("confirmed FULL/SUBSTANTIAL complianceMatrix rows increase coverage", () => {
    const ratio = mandatoryEvidenceCoverageRatio([
      { priority: "MANDATORY", complianceMatrixRows: [{ supportLevel: "FULL" }] },
      { priority: "MANDATORY", complianceMatrixRows: [{ supportLevel: "SUBSTANTIAL" }] },
      { priority: "MANDATORY", complianceMatrixRows: [{ supportLevel: "PARTIAL" }] },
      { priority: "OPTIONAL", complianceMatrixRows: [{ supportLevel: "FULL" }] },
    ]);
    assert.equal(ratio, 2 / 3);
  });
});

describe("final-submission-readiness — CLIENT_NAME_MISSING blocker (source-level)", () => {
  const source = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");

  it("source contains CLIENT_NAME_MISSING blocker code", () => {
    assert.match(source, /CLIENT_NAME_MISSING/);
  });

  it("source checks clientName for empty/whitespace condition", () => {
    assert.match(source, /effectiveClientName/);
    assert.match(source, /CLIENT_NAME_MISSING/);
  });

  it("CLIENT_NAME_MISSING uses HIGH severity matching the contamination blocker pattern", () => {
    // The blocker must use "HIGH" severity (same as METADATA_CONTAMINATED)
    const blockIndex = source.indexOf("CLIENT_NAME_MISSING");
    const blockContext = source.slice(blockIndex, blockIndex + 200);
    assert.ok(blockContext.includes("HIGH"), "CLIENT_NAME_MISSING blocker must use HIGH severity");
  });

  it("does not push CLIENT_NAME_MISSING when checkFullExportReadiness's own CLIENT_NAME_REQUIRED already covers it", () => {
    // Confirmed by a real Playwright screenshot: checkFullExportReadiness
    // (export-readiness.ts) seeds tenderLevelBlockers with CLIENT_NAME_REQUIRED
    // for the same empty-clientName condition this later check independently
    // re-flagged as CLIENT_NAME_MISSING — both landed in the same
    // tenderLevelBlockers array and rendered as two unrelated red warnings for
    // one real issue. Guarded here at the source so every consumer (not just
    // the Tender Release State wrapper) gets the deduped list.
    assert.match(source, /!tenderLevelBlockers\.some\(\(b\) => b\.category === "CLIENT_NAME_REQUIRED"\)/);
  });

  it("does not emit the synthetic __tender__ document blocker when NO_ACTIVE_GENERATED_DOCUMENTS already covers it", () => {
    // Confirmed by a real cross-page comparison against a live seeded
    // tender: app/dashboard/documents/page.tsx (which calls
    // getFinalSubmissionReadiness via /export-readiness directly, not
    // through the Tender Release State wrapper) showed 10 blockers, while
    // the tender workspace/command-center/report (which go through
    // lib/engine/tender-release-state.ts's reconcileBlockers) showed 9 for
    // the exact same tender at the exact same moment. checkExportReadiness's
    // synthetic __tender__ document failure and
    // checkFullExportReadiness's own NO_ACTIVE_GENERATED_DOCUMENTS
    // tenderLevelBlocker both fire from the identical docs.length === 0
    // condition. Guarded here at the source so every direct consumer
    // agrees, not just the wrapper.
    assert.match(source, /hasNoActiveDocumentsTenderBlocker/);
    assert.match(source, /failure\.documentId === "__tender__"/);
  });
});

describe("final-submission-readiness — Prisma select includes extended entity fields", () => {
  const source = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");

  // These fields were previously omitted from the Prisma select, causing
  // assessTenderMetadataCompleteness to always receive undefined for them.
  // The entity-collision check (implementingAgency vs clientName) also silently
  // never fired. Adding them to the select makes the readiness gate see actual
  // DB values rather than silently treating them as missing.

  it("select includes legalClientName", () => {
    assert.match(source, /legalClientName:\s*true/);
  });

  it("select includes donorAgency", () => {
    assert.match(source, /donorAgency:\s*true/);
  });

  it("select includes implementingAgency", () => {
    assert.match(source, /implementingAgency:\s*true/);
  });

  it("select includes clientAddress", () => {
    assert.match(source, /clientAddress:\s*true/);
  });

  it("select includes category so tenderCategory can be derived without as-any cast", () => {
    assert.match(source, /category:\s*true/);
  });

  it("no longer uses (tender as any) or (tender as Record<string, unknown>) casts for entity fields", () => {
    assert.doesNotMatch(source, /\(tender as any\)\.(category|legalClientName|donorAgency|implementingAgency|clientAddress)/);
    assert.doesNotMatch(source, /\(tender as Record<string, unknown>\)\.(procuringEntityName|legalClientName|donorAgency|implementingAgency|clientAddress)/);
  });

  it("analysisExtractionStatus is accessed directly (no cast needed — it is in select)", () => {
    assert.doesNotMatch(source, /tender as \{ analysisExtractionStatus\?/);
    assert.match(source, /tender\.analysisExtractionStatus/);
  });
});

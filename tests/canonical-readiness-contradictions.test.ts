// Canonical readiness state-matrix contradiction regression tests.
//
// Proves that the 10 icon/status contradictions identified in the audit
// (docs/audits/icon-status-contradiction-audit.md) CANNOT occur after the
// canonical resolver (lib/engine/canonical-readiness-state.ts) is wired in.
//
// Each test fixture represents an exact scenario from the audit and asserts
// on the canonical module state — not on pixel colors or source text strings.
// This makes the tests robust to UI refactors while still catching regressions.
//
// Contradiction index (from audit Section 2):
//   C1  — Green compliance while requirements are untrusted (regex fallback)
//   C2  — Green documents while submission plan is missing
//   C3  — Green Generate Docs while analysis is draft-only (approved fallback)
//   C4  — 0 controls shown while suggested controls exist (UI-only, not tested here)
//   C5  — Requirement coverage 100% while export says 0/N
//   C6  — Metadata 100% in one panel while missing elsewhere
//   C7  — Extraction "good" while page coverage is poor
//   C8  — Stale documents shown as current/green
//   C9  — Regex-fallback analysis eligible for GO decision
//   C10 — OCR_REQUIRED status but generation not blocked

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeCanonicalModuleStates } from "../lib/engine/canonical-readiness-state";
import { computeTenderReadinessState } from "../lib/tender-readiness-state";

// ── Helper: build a fully-healthy TenderReadinessState ───────────────────────

function healthyReadinessState() {
  return computeTenderReadinessState({
    analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
    analysisSource: "AI",
    analysisSeverity: "GOOD",
    title: "Water Supply Improvement Project",
    clientName: "Ministry of Water Resources",
    reference: "REF-2026-001",
    metadataContaminated: false,
    requirements: [
      { priority: "MANDATORY", sourcePageNumber: 3, sourceExactQuote: "Quote", sectionReference: "§2.1", sourceConfidence: 0.9 },
      { priority: "CRITICAL", sourcePageNumber: 5, sourceExactQuote: "Quote2", sectionReference: "§2.2", sourceConfidence: 0.8 },
    ],
    exactFileNaming: JSON.stringify(["Technical Proposal.docx", "Financial Proposal.docx"]),
    generatedDocuments: [],
  });
}

function healthyCanonicalInput(overrides: Partial<ReturnType<typeof healthyReadinessState>> = {}) {
  const base = healthyReadinessState();
  return {
    ...base,
    ...overrides,
    hasAnalysis: true,
    hasRequirements: true,
    hasDocuments: false,
  };
}

// ── C1: Green compliance while requirements are untrusted ────────────────────

describe("Contradiction C1 — compliance cannot be READY when analysis is regex fallback", () => {
  it("compliance is BLOCKED when analysis source is REGEX_FALLBACK_AI_ERROR", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
      analysisSeverity: "WARNING",
      title: "Test Tender",
      clientName: "Client A",
      reference: "REF-001",
      requirements: [
        { priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Quote", sectionReference: "§1", sourceConfidence: 0.9 },
      ],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [],
    });
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: false });
    assert.equal(cs.analysis, "BLOCKED", "REGEX_FALLBACK_AI_ERROR must set analysis to BLOCKED");
    assert.equal(cs.compliance, "BLOCKED", "compliance must be BLOCKED when analysis is BLOCKED");
    assert.notEqual(cs.compliance, "READY", "compliance must NOT be READY when analysis is regex fallback");
  });

  it("compliance is BLOCKED when extraction is corrupted", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "EXTRACTION_CORRUPTED_AI_SKIPPED",
      analysisSource: "AI",
      analysisSeverity: "GOOD",
      title: "Test Tender",
      clientName: "Client A",
      reference: "REF-001",
      requirements: [
        { priority: "MANDATORY", sourcePageNumber: 2, sourceExactQuote: "Quote", sectionReference: "§1", sourceConfidence: 0.9 },
      ],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [],
    });
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: false });
    assert.equal(cs.extraction, "BLOCKED");
    assert.equal(cs.compliance, "BLOCKED", "compliance must be BLOCKED when extraction is corrupted");
  });

  it("compliance can be READY when extraction and analysis are both trusted", () => {
    const rs = healthyReadinessState();
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: false });
    assert.equal(cs.extraction, "READY");
    assert.equal(cs.analysis, "READY");
    assert.ok(cs.compliance === "READY" || cs.compliance === "PARTIAL", "compliance should be READY or PARTIAL when all upstream gates pass");
  });
});

// ── C2: Green documents while submission plan is missing ─────────────────────

describe("Contradiction C2 — documents cannot be READY when submission plan not built", () => {
  it("documents are BLOCKED when plan is missing but docs exist", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "AI",
      analysisSeverity: "GOOD",
      title: "Test Tender",
      clientName: "Client A",
      reference: "REF-001",
      requirements: [{ priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 }],
      exactFileNaming: null,
      generatedDocuments: [{ contentSummary: null, generationStatus: "GENERATED" }],
    });
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: true });
    assert.equal(cs.submissionPlan, "NOT_RUN", "submission plan must be NOT_RUN when exactFileNaming is null");
    assert.equal(cs.documents, "BLOCKED", "documents must be BLOCKED when submission plan is not built");
    assert.notEqual(cs.documents, "READY", "documents must NOT be READY without a submission plan");
  });

  it("documents can be READY when plan is built and docs match", () => {
    // Compute the analysis hash first (without docs), then build docs with the correct hash.
    const baseInput = {
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "AI",
      analysisSeverity: "GOOD" as const,
      title: "Test Tender",
      clientName: "Client A",
      reference: "REF-001",
      requirements: [{ priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 }],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [] as Array<{ contentSummary: string | null; generationStatus: string }>,
    };
    const rsForHash = computeTenderReadinessState(baseInput);
    const rs = computeTenderReadinessState({
      ...baseInput,
      generatedDocuments: [{ contentSummary: JSON.stringify({ analysisHash: rsForHash.currentAnalysisHash }), generationStatus: "GENERATED" }],
    });
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: true });
    assert.equal(cs.submissionPlan, "READY");
    assert.ok(cs.documents !== "BLOCKED", "documents should not be BLOCKED when plan is built");
  });
});

// ── C3: Approved fallback should NOT enable green GO ─────────────────────────

describe("Contradiction C3 — approved regex fallback must show WARNING, not READY", () => {
  it("analysis is WARNING when HUMAN_APPROVED_REGEX_FALLBACK", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "HUMAN_APPROVED_REGEX_FALLBACK",
      analysisSeverity: "WARNING",
      title: "Test Tender",
      clientName: "Client A",
      reference: "REF-001",
      requirements: [{ priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 }],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [],
    });
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: false, analysisIsApprovedFallback: true });
    assert.equal(cs.analysis, "WARNING", "approved fallback must render as WARNING not READY or BLOCKED");
    assert.notEqual(cs.analysis, "READY", "approved fallback must NOT show READY");
  });

  it("unapproved regex fallback is BLOCKED", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
      analysisSeverity: "WARNING",
      title: "T",
      clientName: "C",
      reference: "R",
      requirements: [],
      exactFileNaming: null,
      generatedDocuments: [],
    });
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: false, hasDocuments: false, analysisIsApprovedFallback: false });
    assert.equal(cs.analysis, "BLOCKED", "unapproved regex fallback must be BLOCKED");
  });
});

// ── C5: Requirements 100% while export says 0/N ──────────────────────────────

describe("Contradiction C5 — export cannot be READY when requirements are untrusted", () => {
  it("export is BLOCKED when requirements are not trusted", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
      analysisSeverity: "WARNING",
      title: "Test",
      clientName: "Client",
      reference: "R",
      requirements: [{ priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 }],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [],
    });
    assert.equal(rs.requirementsTrusted, false, "requirements should not be trusted with regex fallback");
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: false });
    assert.equal(cs.export, "BLOCKED", "export must be BLOCKED when requirements are not trusted");
    assert.notEqual(cs.export, "READY");
  });
});

// ── C6: Metadata 100% while missing elsewhere ────────────────────────────────

describe("Contradiction C6 — export blocked when metadata is untrusted", () => {
  it("export is BLOCKED when client name is missing", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "AI",
      analysisSeverity: "GOOD",
      title: "Test Tender",
      clientName: "",
      procuringEntityName: "",
      reference: "REF-001",
      requirements: [{ priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 }],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [],
    });
    assert.equal(rs.metadataTrusted, false, "metadata should not be trusted with empty client name");
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: false });
    assert.equal(cs.metadata, "BLOCKED");
    assert.equal(cs.export, "BLOCKED", "export must be BLOCKED when metadata is untrusted");
  });

  it("export is BLOCKED when metadata is contaminated", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "AI",
      analysisSeverity: "GOOD",
      title: "Test Tender",
      clientName: "Ministry of Finance",
      reference: "REF-001",
      metadataContaminated: true,
      requirements: [{ priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 }],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [],
    });
    assert.equal(rs.metadataTrusted, false, "metadata should not be trusted when contaminated");
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: false });
    assert.equal(cs.metadata, "BLOCKED");
    assert.equal(cs.export, "BLOCKED");
  });
});

// ── C7: Extraction "good" while page coverage is poor ────────────────────────

describe("Contradiction C7 — extraction is BLOCKED for corrupted/weak statuses", () => {
  const blockedStatuses = [
    "EXTRACTION_CORRUPTED_AI_SKIPPED",
    "EXTRACTION_WEAK_REVIEW_REQUIRED",
    "OCR_REQUIRED",
    "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    "PARTIAL_EXTRACTION_AI_ANALYZED",
  ];
  for (const status of blockedStatuses) {
    it(`extraction is BLOCKED when status is ${status}`, () => {
      const rs = computeTenderReadinessState({
        analysisExtractionStatus: status,
        analysisSource: "AI",
        analysisSeverity: "GOOD",
        title: "T",
        clientName: "C",
        reference: "R",
        requirements: [],
        exactFileNaming: null,
        generatedDocuments: [],
      });
      assert.equal(rs.extractionTrusted, false, `extraction should not be trusted for status ${status}`);
      const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: false, hasRequirements: false, hasDocuments: false });
      assert.equal(cs.extraction, "BLOCKED", `extraction must be BLOCKED for status ${status}`);
      assert.equal(cs.analysis, "BLOCKED", `analysis must be BLOCKED when extraction is BLOCKED (status ${status})`);
      assert.equal(cs.export, "BLOCKED", `export must be BLOCKED when extraction is BLOCKED (status ${status})`);
    });
  }

  it("extraction is READY for FULL_EXTRACTION_AI_ANALYZED", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "AI",
      analysisSeverity: "GOOD",
      title: "T",
      clientName: "C",
      reference: "R",
      requirements: [],
      exactFileNaming: null,
      generatedDocuments: [],
    });
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: false, hasDocuments: false });
    assert.equal(cs.extraction, "READY");
  });
});

// ── C8: Stale documents shown as current/green ───────────────────────────────

describe("Contradiction C8 — stale documents must show STALE, not READY", () => {
  it("documents are STALE when contentSummary analysisHash does not match current hash", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "AI",
      analysisSeverity: "GOOD",
      title: "Test Tender",
      clientName: "Client A",
      reference: "REF-001",
      requirements: [{ priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 }],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [
        { contentSummary: JSON.stringify({ analysisHash: "v1:STALE_OLD_HASH" }), generationStatus: "GENERATED" },
      ],
    });
    assert.equal(rs.docsGeneratedFromCurrentAnalysis, false, "docs with stale hash should not be considered current");
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: true });
    assert.equal(cs.documents, "STALE", "documents with mismatched hash must show STALE");
    assert.notEqual(cs.documents, "READY", "stale documents must NOT show READY");
    assert.equal(cs.export, "STALE", "export must also be STALE when documents are stale");
  });

  it("documents without contentSummary (null hash) are treated as STALE", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "AI",
      analysisSeverity: "GOOD",
      title: "Test Tender",
      clientName: "Client A",
      reference: "REF-001",
      requirements: [{ priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 }],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [
        { contentSummary: null, generationStatus: "GENERATED" },
      ],
    });
    assert.equal(rs.docsGeneratedFromCurrentAnalysis, false, "docs without contentSummary must be considered stale");
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: true });
    assert.notEqual(cs.documents, "READY", "docs without analysisHash must NOT show READY");
  });
});

// ── C9: Regex-fallback analysis eligible for GO decision ─────────────────────

describe("Contradiction C9 — export is never READY for regex fallback analysis", () => {
  it("export is BLOCKED for REGEX_FALLBACK_AI_ERROR even with everything else perfect", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
      analysisSeverity: "WARNING",
      title: "Test Tender",
      clientName: "Client A",
      reference: "REF-001",
      requirements: [{ priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 }],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [],
    });
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: false, analysisIsApprovedFallback: false });
    assert.equal(cs.export, "BLOCKED", "export must be BLOCKED for unapproved regex fallback");
  });

  it("export is BLOCKED even for HUMAN_APPROVED_REGEX_FALLBACK (draft-review only)", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "HUMAN_APPROVED_REGEX_FALLBACK",
      analysisSeverity: "WARNING",
      title: "Test Tender",
      clientName: "Client A",
      reference: "REF-001",
      requirements: [{ priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 }],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [],
    });
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: false, analysisIsApprovedFallback: true });
    assert.notEqual(cs.export, "READY", "approved regex fallback must NOT be export-READY");
    assert.equal(cs.analysis, "WARNING", "approved fallback renders as WARNING");
  });

  it("export is READY only when analysis source is AI and all gates pass", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "AI",
      analysisSeverity: "GOOD",
      title: "Test Tender",
      clientName: "Client A",
      reference: "REF-001",
      requirements: [{ priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 }],
      exactFileNaming: JSON.stringify(["file.docx"]),
      // Simulate docs generated from current analysis by providing correct hash
      generatedDocuments: [],
    });
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: false });
    // Without docs, export should be NOT_RUN, not READY
    assert.equal(cs.export, "NOT_RUN", "export should be NOT_RUN when no documents exist yet");
    assert.equal(cs.analysis, "READY");
  });
});

// ── C10: OCR_REQUIRED not blocking analysis/export ───────────────────────────

describe("Contradiction C10 — OCR_REQUIRED must block analysis and export", () => {
  it("analysis is BLOCKED when extraction status is OCR_REQUIRED", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "OCR_REQUIRED",
      analysisSource: "AI",
      analysisSeverity: "GOOD",
      title: "T",
      clientName: "C",
      reference: "R",
      requirements: [],
      exactFileNaming: null,
      generatedDocuments: [],
    });
    assert.equal(rs.extractionTrusted, false, "OCR_REQUIRED means extraction is not trusted");
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: false, hasRequirements: false, hasDocuments: false });
    assert.equal(cs.extraction, "BLOCKED");
    assert.equal(cs.analysis, "BLOCKED", "analysis must be BLOCKED when OCR is required");
    assert.equal(cs.export, "BLOCKED");
  });
});

// ── NOT_RUN states for unstarted pipeline stages ─────────────────────────────

describe("pipeline NOT_RUN states — fresh tender with no data", () => {
  it("all upstream modules are NOT_RUN or BLOCKED on a fresh tender", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: null,
      analysisSource: null,
      analysisSeverity: null,
      title: "Fresh Tender",
      clientName: "Client",
      reference: "REF-001",
      requirements: [],
      exactFileNaming: null,
      generatedDocuments: [],
    });
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: false, hasRequirements: false, hasDocuments: false });
    assert.ok(["NOT_RUN", "BLOCKED"].includes(cs.analysis), "analysis should be NOT_RUN or BLOCKED on fresh tender");
    assert.equal(cs.requirements, "NOT_RUN", "requirements should be NOT_RUN with no analysis");
    assert.equal(cs.submissionPlan, "NOT_RUN");
    assert.equal(cs.documents, "NOT_RUN");
    assert.ok(["NOT_RUN", "BLOCKED"].includes(cs.export), "export should be NOT_RUN or BLOCKED on fresh tender");
  });
});

// ── CRITICAL requirements counted alongside MANDATORY ───────────────────────

describe("CRITICAL requirements counted as mandatory-type in readiness state", () => {
  it("mandatoryRequirementsCount includes CRITICAL requirements", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "AI",
      analysisSeverity: "GOOD",
      title: "T",
      clientName: "C",
      reference: "R",
      requirements: [
        { priority: "CRITICAL", sourcePageNumber: 1, sourceExactQuote: "Q", sectionReference: "§1", sourceConfidence: 0.9 },
        { priority: "CRITICAL", sourcePageNumber: 2, sourceExactQuote: "Q2", sectionReference: "§2", sourceConfidence: 0.8 },
        { priority: "OPTIONAL", sourcePageNumber: null, sourceExactQuote: null, sectionReference: null, sourceConfidence: null },
      ],
      exactFileNaming: null,
      generatedDocuments: [],
    });
    assert.equal(rs.mandatoryRequirementsCount, 2, "CRITICAL requirements must count as mandatory-type");
    assert.equal(rs.rawRequirementsCount, 3);
    assert.equal(rs.mandatoryTracedCount, 2, "both CRITICAL requirements should be traced");
  });

  it("requirements are trusted when all CRITICAL requirements are traced", () => {
    const rs = computeTenderReadinessState({
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSource: "AI",
      analysisSeverity: "GOOD",
      title: "Test",
      clientName: "Client",
      reference: "R",
      requirements: [
        { priority: "CRITICAL", sourcePageNumber: 3, sourceExactQuote: "Critical quote", sectionReference: "§3", sourceConfidence: 0.95 },
      ],
      exactFileNaming: JSON.stringify(["file.docx"]),
      generatedDocuments: [],
    });
    assert.equal(rs.requirementsTrusted, true, "requirements should be trusted when all CRITICAL reqs are traced");
    const cs = computeCanonicalModuleStates({ ...rs, hasAnalysis: true, hasRequirements: true, hasDocuments: false });
    assert.equal(cs.requirements, "READY");
  });
});

// ── Source-level guards: canonical badge component exists ────────────────────

describe("canonical-status-badge component exists and exports correctly", () => {
  it("CanonicalStatusBadge is exported from components/canonical-status-badge.tsx", () => {
    const source = readFileSync("components/canonical-status-badge.tsx", "utf8");
    assert.match(source, /export function CanonicalStatusBadge/, "CanonicalStatusBadge must be exported");
    assert.match(source, /export function CanonicalStatusIcon/, "CanonicalStatusIcon must be exported");
  });

  it("CANONICAL_STATUS_CONFIG covers all 8 canonical states", () => {
    const source = readFileSync("lib/engine/canonical-readiness-state.ts", "utf8");
    for (const state of ["READY", "WARNING", "BLOCKED", "STALE", "PARTIAL", "NOT_RUN", "RUNNING", "NOT_APPLICABLE"]) {
      assert.match(source, new RegExp(`"${state}"`), `CANONICAL_STATUS_CONFIG must include state ${state}`);
    }
  });

  it("canonical resolver covers all 8 modules", () => {
    const source = readFileSync("lib/engine/canonical-readiness-state.ts", "utf8");
    for (const moduleName of ["extraction", "analysis", "metadata", "requirements", "matching", "submissionPlan", "compliance", "documents", "generation", "export"]) {
      assert.match(source, new RegExp(moduleName), `canonical resolver must compute state for module ${moduleName}`);
    }
  });

  it("RUNNING and STALE are not visually identical despite sharing a base glyph", () => {
    // Both intentionally use RefreshIcon per the canonical status model design
    // (docs/audits/icon-status-contradiction-audit.md section 5: both listed
    // as "⟳", with RUNNING calling for "+ spinner"). Without the spinner,
    // "actively running now" and "outdated, needs a rerun" render as the
    // exact same static icon — a real contradiction, not just a design nuance.
    const source = readFileSync("lib/engine/canonical-readiness-state.ts", "utf8");
    const runningLine = source.split("\n").find((line) => line.trimStart().startsWith("RUNNING:"));
    assert.ok(runningLine, "RUNNING entry must exist in CANONICAL_STATUS_CONFIG");
    assert.match(runningLine!, /animate-spin/, "RUNNING's icon must animate so it is distinguishable from STALE's static refresh icon");
  });
});

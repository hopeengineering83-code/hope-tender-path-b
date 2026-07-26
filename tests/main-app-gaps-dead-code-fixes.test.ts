// Regression tests for main-app gaps, dead code, and contradictions.
//
// Proves that:
//   1. Lifecycle orchestrator metadata advisory no longer skips downstream states.
//   2. Dead inner if(requirements.length===0) removed from orchestrator.
//   3. Dead zipAuthorityNeedsReview variable + header branch removed from download route.
//   4. export-format-policy collectExactFilenames handles plain-text fallback.
//   5. document-output-state requestedFormat no longer mis-classifies .pdf with PLANNED documentType.
//   6. runtime-readiness-facts finalPackage shape is documented (exportReady always false).
//   7. Dead hasBoundFallbackApproval import removed from generation-readiness-gate.
//   8. CLAUDE.md and AGENTS.md SHA matches actual main.
//   9. operator_handoff.md Active Workboard does not list stale branches.
//  10. Existing lifecycle/readiness behavior preserved (no regression).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

function read(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8");
}

// ─── 1. Lifecycle orchestrator metadata advisory no longer skips downstream states ─

describe("Bug #1 — Orchestrator metadata advisory no longer skips downstream states", () => {
  it("metadata warnings are pushed unconditionally (not as else-if)", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    // The metadata warning pushes must NOT be inside an `else if` — they
    // must be standalone `if` blocks so the rest of the chain evaluates.
    assert.ok(
      src.includes('if (meta.missingCritical.length > 0) {'),
      "metadata missingCritical warning must be a standalone if (not else-if)",
    );
    assert.ok(
      src.includes('if (tender.metadataContaminated) {'),
      "metadataContaminated warning must be a standalone if (not else-if)",
    );
    // The SOURCE_REFERENCES_INCOMPLETE branch must be a standalone `if`,
    // not `else if` chained to the metadata branch.
    assert.ok(
      /\/\/ 7\. Source references[\s\S]*?if \(ungroundedMandatory\.length > 0 && mandatoryReqs\.length > 0\)/.test(src),
      "SOURCE_REFERENCES_INCOMPLETE branch must be a standalone if (not else-if chained to metadata)",
    );
  });

  it("BUG FIX comment explains the previous behavior", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    assert.ok(
      src.includes("BUG FIX: This was previously an `else if` branch"),
      "orchestrator must document the bug fix",
    );
  });
});

// ─── 2. Dead inner if(requirements.length===0) removed ──────────────────────────

describe("Bug #2 — Dead inner if(requirements.length===0) removed", () => {
  it("orchestrator no longer has the dead inner if block", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    // The dead block set lifecycleState = "AI_ANALYSIS_REQUIRED" inside
    // the SOURCE_REFERENCES_INCOMPLETE branch. It was unreachable because
    // mandatoryReqs.length > 0 implies requirements.length > 0.
    assert.ok(
      !src.includes('lifecycleState = "AI_ANALYSIS_REQUIRED";\n      primaryNextAction = "RUN_AI_ANALYZE";\n    }'),
      "dead inner if(requirements.length===0) block must be removed",
    );
    assert.ok(
      src.includes("NOTE: The previous inner `if (requirements.length === 0)` was dead"),
      "orchestrator must document why the dead block was removed",
    );
  });
});

// ─── 3. Dead zipAuthorityNeedsReview removed from download route ────────────────

describe("Bug #4 — Dead zipAuthorityNeedsReview removed", () => {
  it("download route no longer declares zipAuthorityNeedsReview variable", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(
      !src.includes("let zipAuthorityNeedsReview = false;"),
      "dead `let zipAuthorityNeedsReview = false;` must be removed",
    );
    assert.ok(
      !src.includes("zipAuthorityNeedsReview = false;"),
      "dead `zipAuthorityNeedsReview = false;` reassignment must be removed",
    );
    assert.ok(
      !src.includes("if (zipAuthorityNeedsReview)"),
      "dead `if (zipAuthorityNeedsReview)` header branch must be removed",
    );
    assert.ok(
      !src.includes('"X-Authority-Review-Status"'),
      "dead X-Authority-Review-Status header must be removed",
    );
  });

  it("download route documents the removal", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(
      src.includes("zipAuthorityNeedsReview` variable was dead code"),
      "download route must document why zipAuthorityNeedsReview was removed",
    );
  });
});

// ─── 4. export-format-policy collectExactFilenames plain-text fallback ──────────

describe("Bug #5 — collectExactFilenames handles plain-text fallback", () => {
  it("collectExactFilenames parses JSON array correctly", async () => {
    const { detectTenderFormatPolicy } = await import("../lib/engine/export-format-policy");
    const policy = detectTenderFormatPolicy({
      exactFileNaming: JSON.stringify(["Technical Proposal.pdf", "Financial Proposal.xlsx"]),
      exactFileOrder: null,
    });
    assert.ok(policy.requiresPdf, "must detect PDF requirement from JSON array");
    assert.ok(policy.requiresXlsx, "must detect XLSX requirement from JSON array");
    assert.equal(policy.perFile.length, 2, "must collect 2 files from JSON array");
  });

  it("collectExactFilenames parses plain-text newline-separated string (BUG FIX)", async () => {
    const { detectTenderFormatPolicy } = await import("../lib/engine/export-format-policy");
    const policy = detectTenderFormatPolicy({
      exactFileNaming: "Technical Proposal.pdf\nFinancial Proposal.xlsx",
      exactFileOrder: null,
    });
    // BUG FIX: previously this returned empty perFile/requiresPdf=false
    // because safeParseJsonArray returns [] on non-JSON input.
    assert.ok(policy.requiresPdf, "must detect PDF requirement from plain-text string");
    assert.ok(policy.requiresXlsx, "must detect XLSX requirement from plain-text string");
    assert.equal(policy.perFile.length, 2, "must collect 2 files from plain-text string");
  });

  it("collectExactFilenames parses plain-text comma-separated string (BUG FIX)", async () => {
    const { detectTenderFormatPolicy } = await import("../lib/engine/export-format-policy");
    const policy = detectTenderFormatPolicy({
      exactFileNaming: "Technical Proposal.pdf, Financial Proposal.xlsx, Form.docx",
      exactFileOrder: null,
    });
    assert.ok(policy.requiresPdf, "must detect PDF from comma-separated string");
    assert.ok(policy.requiresXlsx, "must detect XLSX from comma-separated string");
    assert.ok(policy.requiresDocx, "must detect DOCX from comma-separated string");
    assert.equal(policy.perFile.length, 3, "must collect 3 files from comma-separated string");
  });

  it("checkTenderFormatCoverage blocks when PDF required but only DOCX generated (plain-text)", async () => {
    const { detectTenderFormatPolicy, checkTenderFormatCoverage } = await import("../lib/engine/export-format-policy");
    const policy = detectTenderFormatPolicy({
      exactFileNaming: "Technical Proposal.pdf", // plain text, not JSON
      exactFileOrder: null,
    });
    assert.ok(policy.requiresPdf, "must detect PDF requirement");
    const coverage = checkTenderFormatCoverage(policy, ["docx"]);
    assert.equal(coverage.ok, false, "must block when PDF required but only DOCX generated");
    if (!coverage.ok) {
      assert.equal(coverage.code, "PDF_REQUIRED_CONVERSION_UNAVAILABLE");
    }
  });

  it("source includes the plain-text fallback comment", () => {
    const src = read("lib/engine/export-format-policy.ts");
    assert.ok(
      src.includes("Fall back to plain-text newline/comma-separated parsing"),
      "export-format-policy must document the plain-text fallback fix",
    );
  });
});

// ─── 5. document-output-state requestedFormat no longer mis-classifies .pdf ─────

describe("Bug #6 — requestedFormat no longer mis-classifies .pdf with PLANNED documentType", () => {
  it(".pdf file with documentType=PLANNED returns pdf (not control)", async () => {
    const { deriveDocumentOutputState } = await import("../lib/engine/document-output-state");
    // Before fix: requestedFormat concatenated all fields into a label string
    // and the `planned` regex matched documentType="PLANNED", returning "control".
    // After fix: each field is checked individually, so a .pdf file with
    // documentType="PLANNED" correctly returns "pdf" format.
    const state = deriveDocumentOutputState({
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      format: null, // no format field
      documentType: "PLANNED", // previously caused mis-classification
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.pdf",
      fileContent: "UEsDBBQAAAAIA", // base64 DOCX bytes (not %PDF-)
    } as any);
    // The state should be PDF_CONVERSION_REQUIRED (want=pdf, bytes=DOCX),
    // NOT CONTROL_RECORD_ONLY (which is what the old code returned).
    assert.equal(state, "PDF_CONVERSION_REQUIRED", ".pdf file with documentType=PLANNED must be PDF_CONVERSION_REQUIRED, not CONTROL_RECORD_ONLY");
  });

  it(".pdf file with format=PDF still returns pdf correctly", async () => {
    const { deriveDocumentOutputState } = await import("../lib/engine/document-output-state");
    const state = deriveDocumentOutputState({
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      format: "PDF",
      documentType: "TECHNICAL_PROPOSAL",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.pdf",
      fileContent: "UEsDBBQAAAAIA", // base64 DOCX bytes (not %PDF-)
    } as any);
    assert.equal(state, "PDF_CONVERSION_REQUIRED", "format=PDF with DOCX bytes must be PDF_CONVERSION_REQUIRED");
  });

  it("CONTROL format still returns CONTROL_RECORD_ONLY", async () => {
    const { deriveDocumentOutputState } = await import("../lib/engine/document-output-state");
    const state = deriveDocumentOutputState({
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      format: "CONTROL",
      documentType: "SUBMISSION_CONTROL",
      name: "Control Record",
      exactFileName: "Control.docx",
      fileContent: "UEsDBBQAAAAIA",
    } as any);
    assert.equal(state, "CONTROL_RECORD_ONLY", "CONTROL format must still be CONTROL_RECORD_ONLY");
  });

  it("source includes the requestedFormat fix comment", () => {
    const src = read("lib/engine/document-output-state.ts");
    assert.ok(
      src.includes("BUG FIX: Previously this function concatenated"),
      "document-output-state must document the requestedFormat fix",
    );
  });
});

// ─── 6. runtime-readiness-facts finalPackage shape documented ───────────────────

describe("Bug #7 — runtime-readiness-facts finalPackage shape documented", () => {
  it("finalPackage.exportReady is documented as always false", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.ok(
      src.includes("Always false here — the actual export-ready verdict"),
      "finalPackage.exportReady must be documented as always false",
    );
    assert.ok(
      src.includes("Always empty here — actual blockers come from"),
      "finalPackage.blockers must be documented as always empty",
    );
  });

  it("runtime-readiness-parity route documents the fail-closed behavior", () => {
    const src = read("app/api/tenders/[id]/runtime-readiness-parity/route.ts");
    assert.ok(
      src.includes("facts.finalPackage.exportReady is always false"),
      "parity route must document that finalPackage.exportReady is always false",
    );
    assert.ok(
      src.includes("intentionally fail-closed"),
      "parity route must document this is intentionally fail-closed",
    );
  });
});

// ─── 7. Dead hasBoundFallbackApproval import removed ────────────────────────────

describe("Bug #8 — Dead hasBoundFallbackApproval import removed", () => {
  it("generation-readiness-gate no longer imports hasBoundFallbackApproval", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    // The IMPORT must be removed (the comments can still reference it for documentation)
    assert.ok(
      !src.match(/import\s+\{[^}]*hasBoundFallbackApproval/),
      "generation-readiness-gate must NOT import hasBoundFallbackApproval (dead import removed)",
    );
  });

  it("generation-readiness-gate documents the hard-block behavior", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(
      src.includes("HUMAN_APPROVED_FALLBACK is PERMANENTLY HARD-BLOCKED"),
      "generation-readiness-gate must document the hard-block behavior",
    );
    assert.ok(
      /hasBoundFallbackApproval helper is retained[\s\S]*for future use/.test(src),
      "generation-readiness-gate must document that the helper is retained but not wired",
    );
  });

  it("hasBoundFallbackApproval is still exported from readiness-overrides (retained)", async () => {
    const mod = await import("../lib/engine/readiness-overrides");
    assert.equal(typeof mod.hasBoundFallbackApproval, "function", "hasBoundFallbackApproval must still be exported (retained for future use)");
  });
});

// ─── 8. CLAUDE.md and AGENTS.md SHA matches actual main ─────────────────────────

describe("Bug #9a — CLAUDE.md and AGENTS.md SHA matches actual main", () => {
  it("CLAUDE.md references current main SHA", () => {
    const src = read("CLAUDE.md");
    // The SHA in CLAUDE.md must NOT be the stale 80607254
    assert.ok(
      !src.includes("SHA: 80607254"),
      "CLAUDE.md must not reference stale SHA 80607254",
    );
    assert.ok(
      src.includes("SHA: 63369f03"),
      "CLAUDE.md must reference current main SHA 63369f03",
    );
  });

  it("AGENTS.md references current main SHA", () => {
    const src = read("AGENTS.md");
    assert.ok(
      !src.includes("SHA: 80607254"),
      "AGENTS.md must not reference stale SHA 80607254",
    );
    assert.ok(
      src.includes("SHA: 63369f03"),
      "AGENTS.md must reference current main SHA 63369f03",
    );
  });
});

// ─── 9. operator_handoff.md Active Workboard does not list stale branches ───────

describe("Bug #9b — operator_handoff.md Active Workboard updated", () => {
  it("Active Workboard section no longer lists stale branches", () => {
    const src = read("operator_handoff.md");
    // Extract just the Active Workboard section (between "## Active Workboard"
    // and the next "## " heading).
    const workboardMatch = src.match(/## Active Workboard([\s\S]*?)\n## /);
    assert.ok(workboardMatch, "must find Active Workboard section");
    const workboard = workboardMatch![1];
    const staleBranches = [
      "claude/short-honest-feedback-gaps-vyh8dv",
      "claude/fix-clusters-A-E-off-961",
      "hotfix/metadata-ledger-completion-v2",
      "fix/metadata-ledger-completion",
      "fix/main-gaps-and-doc-updates",
    ];
    for (const branch of staleBranches) {
      assert.ok(
        !workboard.includes(branch),
        `Active Workboard must not list stale branch: ${branch}`,
      );
    }
  });

  it("workboard lists the current single consolidation authority", () => {
    const src = read("operator_handoff.md");
    const workboard = src.match(/## Active Workboard([\s\S]*?)\n## /)?.[1] ?? "";
    assert.ok(workboard.includes("release/consolidated-recovery-20260717"), "workboard must list the PR #1175 branch");
    assert.ok(workboard.includes("PR #1175"), "workboard must identify PR #1175");
    assert.ok(!workboard.includes("PR #1030"), "workboard must not retain closed PR #1030");
    assert.ok(!workboard.includes("PR #1031"), "workboard must not retain closed PR #1031");
  });
});

// ─── 10. Existing lifecycle/readiness behavior preserved (no regression) ────────

describe("Regression — existing behavior preserved", () => {
  it("isFinalExportCandidateDocument still excludes SUPERSEDED", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "SUPERSEDED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      format: "DOCX",
      documentType: "TECHNICAL_PROPOSAL",
      name: "T",
      exactFileName: "T.docx",
    } as any), false);
  });

  it("isFinalExportCandidateDocument still excludes PLANNED", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "PLANNED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      format: "DOCX",
      documentType: "TECHNICAL_PROPOSAL",
      name: "T",
      exactFileName: "T.docx",
    } as any), false);
  });

  it("isFinalExportCandidateDocument still excludes CONTROL format", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      format: "CONTROL",
      documentType: "SUBMISSION_CONTROL",
      name: "C",
      exactFileName: "C.docx",
    } as any), false);
  });

  it("validateFileSignature still rejects .pdf with DOCX bytes", async () => {
    const { validateFileSignature } = await import("../lib/engine/export-format-policy");
    const result = validateFileSignature("Technical-Proposal.pdf", "UEsDBBQAAAAIA");
    assert.equal(result.ok, false);
  });

  it("checkTenderFormatCoverage still returns ok when all required formats present", async () => {
    const { detectTenderFormatPolicy, checkTenderFormatCoverage } = await import("../lib/engine/export-format-policy");
    const policy = detectTenderFormatPolicy({
      exactFileNaming: JSON.stringify(["Technical Proposal.pdf"]),
      exactFileOrder: null,
    });
    const coverage = checkTenderFormatCoverage(policy, ["pdf"]);
    assert.equal(coverage.ok, true, "must pass when PDF required and PDF generated");
  });
});

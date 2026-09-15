// Mutation guards for the final gap-closure commit. Each test verifies a
// specific protection that was added to close the remaining gaps. If anyone
// reverts any of these protections, the corresponding test fails.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ─── Gap A: auto-finalize route calls the central gate ──────────────────────

describe("Gap A — auto-finalize route calls the central gate", () => {
  const src = readFileSync("app/api/tenders/[id]/auto-finalize/route.ts", "utf8");

  it("imports assertTenderReadyForGenerationAndExport", () => {
    assert.match(src, /import \{ assertTenderReadyForGenerationAndExport \}/);
  });

  it("calls the central gate with purpose final-zip before finalizing", () => {
    assert.match(src, /assertTenderReadyForGenerationAndExport\(\{[\s\S]*?purpose:\s*"final-zip"/);
  });

  it("blocks with 422 when the central gate fails", () => {
    assert.match(src, /if \(!centralGate\.ok\)[\s\S]*?status:\s*422/);
  });

  it("routes a missing source-verified plan to Run Engine, not confirmation", () => {
    assert.match(src, /centralGate\.blockerCode === "BUILD_PLAN_NOT_CONFIRMED" \? "RUN_ENGINE"/);
    assert.doesNotMatch(src, /centralGate\.blockerCode === "BUILD_PLAN_NOT_CONFIRMED" \? "BUILD_SUBMISSION_PLAN"/);
  });
});

// ─── Gap C: approve-analysis route clarifies audit-only ─────────────────────

describe("Gap C — approve-analysis route clarifies audit-only", () => {
  const src = readFileSync("app/api/tenders/[id]/approve-analysis/route.ts", "utf8");

  it("response includes auditOnly: true", () => {
    assert.match(src, /auditOnly:\s*true/);
  });

  it("response message says approval does NOT authorize release", () => {
    assert.match(src, /does NOT authorize generation, export, download, regeneration, AI proposal, missing-file generation, or ZIP/i);
  });
});

// ─── Gap C2: recovery-command-actions label clarifies audit-only ────────────

describe("Gap C2 — recovery-command-actions label clarifies audit-only", () => {
  const src = readFileSync("lib/recovery-command-actions.ts", "utf8");

  it("APPROVE_FALLBACK_WITH_NOTE label says audit-only", () => {
    assert.match(src, /label:\s*"Approve Fallback Analysis \(audit-only — does NOT authorize release\)"/);
  });
});

// ─── Gap D: tender-generation-readiness fails closed ────────────────────────

describe("Gap D — tender-generation-readiness fails closed", () => {
  const src = readFileSync("lib/tender-generation-readiness.ts", "utf8");

  it("does NOT use fail-open .catch(() => ({ ok: true }))", () => {
    assert.ok(
      !/\.catch\(\(\)\s*=>\s*\(\{\s*ok:\s*true/.test(src),
      "tender-generation-readiness MUST NOT use fail-open .catch(() => ({ ok: true }))",
    );
  });

  it("uses try/catch with ok:false on error (fail-closed)", () => {
    assert.match(src, /catch\s*\{[\s\S]*?ok:\s*false/);
  });
});

// ─── Gap E: export-readiness blocks HUMAN_APPROVED_REGEX_FALLBACK ────────────

describe("Gap E — export-readiness blocks HUMAN_APPROVED_REGEX_FALLBACK", () => {
  const src = readFileSync("lib/engine/export-readiness.ts", "utf8");

  it("imports the canonical analysis-source resolver", () => {
    assert.match(src, /import \{ resolveCanonicalAnalysisSource \} from "\.\/analysis-source"/);
  });

  it("calls the canonical analysis-source resolver", () => {
    // resolveCanonicalAnalysisSource replaces the notes-only detector, which
    // reported ANALYSIS_SOURCE_UNKNOWN for tenders whose AI Analyze had
    // genuinely succeeded (the proof lives in AiJob rows, not tender.notes).
    assert.match(src, /resolveCanonicalAnalysisSource\(prisma, tenderId, tender\)/);
  });

  it("still resolves approval semantics through detectAnalysisSourceWithApproval", () => {
    // The audit-only approval lookup must survive the resolver-first change:
    // the canonical resolver falls back to the approval-aware detector, so
    // HUMAN_APPROVED_REGEX_FALLBACK is still detected and still blocks.
    const analysisSrc = readFileSync("lib/engine/analysis-source.ts", "utf8");
    assert.match(
      analysisSrc,
      /export async function resolveCanonicalAnalysisSource[\s\S]*?return detectAnalysisSourceWithApproval\(client, tenderId, tender\);/,
    );
  });

  it("blocks HUMAN_APPROVED_REGEX_FALLBACK with ANALYSIS_FALLBACK_AUDIT_ONLY", () => {
    assert.match(src, /analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK"[\s\S]*?ANALYSIS_FALLBACK_AUDIT_ONLY/);
  });

  it("blocks REGEX_FALLBACK_AI_ERROR with ANALYSIS_REGEX_FALLBACK_UNAPPROVED", () => {
    assert.match(src, /analysisSource === "REGEX_FALLBACK_AI_ERROR"[\s\S]*?ANALYSIS_REGEX_FALLBACK_UNAPPROVED/);
  });

  it("blocks UNKNOWN with ANALYSIS_SOURCE_UNKNOWN", () => {
    assert.match(src, /analysisSource === "UNKNOWN"[\s\S]*?ANALYSIS_SOURCE_UNKNOWN/);
  });
});

// ─── Gap F: ai-analyze route filters validTenderFileIds to ACTIVE files ─────

describe("Gap F — ai-analyze route filters validTenderFileIds to ACTIVE files", () => {
  const src = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");

  it("validTenderFileIds filters by deletionStatus ACTIVE (streaming path)", () => {
    // The streaming path must filter to ACTIVE files only.
    const streamingSection = src.slice(0, src.indexOf("extractionReports = tenderRecord.files.map"));
    assert.match(
      streamingSection,
      /validTenderFileIds\s*=\s*new Set\([\s\S]*?filter\(\(f\)\s*=>\s*\(f\.deletionStatus\s*\?\?\s*"ACTIVE"\)\s*===\s*"ACTIVE"\)/,
    );
  });

  it("validTenderFileIds filters by deletionStatus ACTIVE (normal path)", () => {
    // The normal (non-streaming) path must also filter to ACTIVE files only.
    // Verify the filter pattern appears more than once (both paths).
    const matches = src.match(/filter\(\(f\)\s*=>\s*\(f\.deletionStatus\s*\?\?\s*"ACTIVE"\)\s*===\s*"ACTIVE"\)/g);
    assert.ok(matches && matches.length >= 2, `Expected >= 2 ACTIVE-file filters (streaming + normal), got ${matches?.length ?? 0}`);
  });
});

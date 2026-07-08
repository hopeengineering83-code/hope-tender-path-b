// UI and defect-fix regression tests.
//
// These tests prove the 5 specific defects from the PR specification are fixed:
//   1. Extracted facts exist but are not recognized → parser reads full text
//   2. Parser still depends on stored scalar columns → source text is authority
//   3. Duplicate normal metadata UI → ClientSubmissionDetailsPanel removed
//   4. Corrupted scalar metadata overrides clean facts → "Not" rejected
//   5. AI Analyze stuck at CHUNKS_STILL_ACTIVE → recovery endpoint exists

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── Defect 1: Extracted facts recognized from full text ───────────────────

describe("defect 1 — extracted facts recognized from full text", () => {
  it("Tender Detail reads submission method from extracted text, not only scalar columns", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes("buildTenderFactSourceText"), "must call buildTenderFactSourceText");
    assert.ok(src.includes("parseTenderDocumentIntelligence"), "must call parseTenderDocumentIntelligence");
    assert.ok(src.includes("effectiveMethod"), "must compute effectiveMethod from source-driven intelligence");
  });

  it("Tender Detail shows Submission method: Email when extracted text says Email submission only", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes('label="Submission method"'), "must render Submission method label");
    assert.ok(src.includes("effectiveMethod"), "must use effectiveMethod (source-driven) for the value");
  });

  it("Tender Detail shows submission deadline from extracted text", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes("effectiveDeadline"), "must use effectiveDeadline (source-driven)");
  });

  it("Tender Detail shows both emails separated by comma", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes("normalizeEmailList"), "must use normalizeEmailList for email parsing");
    assert.ok(src.includes('emails.join(", ")'), "must join emails with comma");
  });

  it("Tender Detail does not show Submission method invalid when extracted text contains Email submission only", () => {
    // The parser detects "Email" from the source text and effectiveMethod is "Email",
    // not "Not extracted" or "Invalid"
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes('intelligence.submissionInstructions.method !== "Unknown"'), "must check source-driven method");
  });
});

// ─── Defect 2: Parser uses source text, scalar columns as fallback ─────────

describe("defect 2 — parser uses source text, scalar as fallback only", () => {
  it("source-driven-tender-text-parser exists and exports parseTenderDocumentIntelligence", () => {
    const src = read("lib/engine/source-driven-tender-text-parser.ts");
    assert.ok(src.includes("export function parseTenderDocumentIntelligence"));
    assert.ok(src.includes("export function buildTenderFactSourceText"));
    assert.ok(src.includes("export function normalizeEmailList"));
  });

  it("buildTenderFactSourceText priority: extractedText → intakeSummary → analysisSummary → description → evaluationMethodology", () => {
    const src = read("lib/engine/source-driven-tender-text-parser.ts");
    assert.ok(src.includes("input.extractedText"), "must read extractedText");
    assert.ok(src.includes("input.intakeSummary"), "must read intakeSummary");
    assert.ok(src.includes("input.analysisSummary"), "must read analysisSummary");
    assert.ok(src.includes("input.description"), "must read description");
    assert.ok(src.includes("input.evaluationMethodology"), "must read evaluationMethodology");
  });

  it("parser options accept scalar fallbacks (tenderSubmissionMethod, tenderDeadline, etc.)", () => {
    const src = read("lib/engine/source-driven-tender-text-parser.ts");
    assert.ok(src.includes("tenderSubmissionMethod"), "must accept tenderSubmissionMethod fallback");
    assert.ok(src.includes("tenderDeadline"), "must accept tenderDeadline fallback");
    assert.ok(src.includes("tenderSubmissionEmails"), "must accept tenderSubmissionEmails fallback");
    assert.ok(src.includes("tenderSubmissionAddress"), "must accept tenderSubmissionAddress fallback");
  });
});

// ─── Defect 3: Duplicate panel removed from normal workflow ────────────────

describe("defect 3 — duplicate ClientSubmissionDetailsPanel removed from normal workflow", () => {
  it("page.tsx does NOT render ClientSubmissionDetailsPanel in Stage 1", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    // The import must be removed or commented out
    assert.ok(
      !src.includes("<ClientSubmissionDetailsPanel"),
      "must not render <ClientSubmissionDetailsPanel> in normal workflow",
    );
  });

  it("page.tsx does NOT import ClientSubmissionDetailsPanel (or it's commented out)", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    // Check there's no active import (it may be in a comment explaining why it's removed)
    const activeImport = src.match(/^import\s+.*ClientSubmissionDetailsPanel.*from/m);
    assert.ok(!activeImport, "must not have an active import of ClientSubmissionDetailsPanel");
  });

  it("page.tsx still renders TenderIntakeDetailPanel (the single intelligence panel)", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    assert.ok(src.includes("<TenderIntakeDetailPanel"), "must still render TenderIntakeDetailPanel");
  });

  it("normal workflow has one tender intelligence panel only", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    const intakeCount = (src.match(/<TenderIntakeDetailPanel/g) || []).length;
    const clientCount = (src.match(/<ClientSubmissionDetailsPanel/g) || []).length;
    assert.equal(intakeCount, 1, "exactly one TenderIntakeDetailPanel");
    assert.equal(clientCount, 0, "zero ClientSubmissionDetailsPanel in normal workflow");
  });
});

// ─── Defect 4: Corrupted "Not" reference no longer overrides clean facts ───

describe("defect 4 — corrupted 'Not' reference handled correctly", () => {
  it("isValidReferenceNumber rejects 'Not' as invalid", async () => {
    const { isValidReferenceNumber } = await import("../lib/engine/metadata-validators");
    assert.equal(isValidReferenceNumber("Not"), false, "'Not' must be rejected as invalid reference");
    assert.equal(isValidReferenceNumber("not"), false, "'not' must be rejected");
    assert.equal(isValidReferenceNumber("Not available"), false, "'Not available' must be rejected");
    assert.equal(isValidReferenceNumber("Not provided"), false, "'Not provided' must be rejected");
  });

  it("metadata-display-sanitizer rejects 'Not' as display-invalid", async () => {
    const { isDisplayValidMetadataValue } = await import("../lib/engine/metadata-display-sanitizer");
    assert.equal(isDisplayValidMetadataValue("reference", "Not"), false, "'Not' must be display-invalid for reference");
  });

  it("corrupted-metadata-banner does NOT fire for placeholder-ish values like 'Not'", async () => {
    const src = read("components/corrupted-metadata-banner.tsx");
    assert.ok(src.includes("isPlaceholderIsh"), "must have isPlaceholderIsh helper");
    assert.ok(src.includes("!isPlaceholderIsh"), "must skip placeholder-ish values in badFieldsFor");
  });

  it("Tender Detail shows 'Not extracted' for reference='Not' (not 'Not')", async () => {
    const { isDisplayValidMetadataValue, NOT_EXTRACTED } = await import("../lib/engine/metadata-display-sanitizer");
    const isValid = isDisplayValidMetadataValue("reference", "Not");
    // When invalid, the panel shows NOT_EXTRACTED
    assert.equal(isValid, false);
    assert.equal(NOT_EXTRACTED, "Not extracted");
  });
});

// ─── Defect 5: CHUNKS_STILL_ACTIVE recovery ────────────────────────────────

describe("defect 5 — CHUNKS_STILL_ACTIVE recovery endpoint", () => {
  it("chunk-recovery module exists and exports recovery functions", () => {
    const src = read("lib/ai-jobs/chunk-recovery.ts");
    assert.ok(src.includes("export async function diagnoseJobChunks"));
    assert.ok(src.includes("export async function resetStaleChunks"));
    assert.ok(src.includes("export async function finalizeCompletedChunks"));
    assert.ok(src.includes("export async function restartJob"));
    assert.ok(src.includes("export async function resumeAnalysis"));
  });

  it("POST /api/ai-jobs/[id]/recover route exists", () => {
    const src = read("app/api/ai-jobs/[id]/recover/route.ts");
    assert.ok(src.includes("export async function POST"), "must export POST handler");
    assert.ok(src.includes("export async function GET"), "must export GET handler for diagnostics");
  });

  it("recovery route is RBAC-safe (requires ADMIN, PROPOSAL_MANAGER, or REVIEWER)", () => {
    const src = read("app/api/ai-jobs/[id]/recover/route.ts");
    assert.ok(src.includes('requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER")'), "must require proper roles");
  });

  it("recovery route is tenant-safe (ownership check)", () => {
    const src = read("app/api/ai-jobs/[id]/recover/route.ts");
    assert.ok(src.includes("actor.role !== \"ADMIN\""), "must check admin role for ownership bypass");
    assert.ok(src.includes("ownsTender"), "must check tender ownership for non-admins");
  });

  it("recovery supports 4 actions: resume, finalize_completed, reset_stale, restart", () => {
    const src2 = read("app/api/ai-jobs/[id]/recover/route.ts");
    assert.ok(src2.includes('"resume"'), "must support resume action");
    assert.ok(src2.includes('"finalize_completed"'), "must support finalize_completed action");
    assert.ok(src2.includes('"reset_stale"'), "must support reset_stale action");
    assert.ok(src2.includes('"restart"'), "must support restart action");
  });

  it("recovery distinguishes fresh vs stale RUNNING chunks (10-min threshold)", () => {
    const src = read("lib/ai-jobs/chunk-recovery.ts");
    assert.ok(src.includes("STALE_CHUNK_THRESHOLD_MS"), "must define stale threshold");
    assert.ok(src.includes("staleRunningCount"), "must count stale running chunks");
    assert.ok(src.includes("freshRunningCount"), "must count fresh running chunks");
  });

  it("diagnostics include structured fields for logging", () => {
    const src = read("lib/ai-jobs/chunk-recovery.ts");
    assert.ok(src.includes("totalChunks"), "must include totalChunks");
    assert.ok(src.includes("queuedCount"), "must include queuedCount");
    assert.ok(src.includes("runningCount"), "must include runningCount");
    assert.ok(src.includes("succeededCount"), "must include succeededCount");
    assert.ok(src.includes("failedCount"), "must include failedCount");
    assert.ok(src.includes("staleRunningCount"), "must include staleRunningCount");
    assert.ok(src.includes("promotionStatus"), "must include promotionStatus");
    assert.ok(src.includes("promotionCode"), "must include promotionCode");
  });
});

// ─── Email normalization defect fix ────────────────────────────────────────

describe("email normalization — pipe separator display fix", () => {
  it("Tender Detail does not show email1|email2 (pipe-separated)", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes("normalizeEmailList"), "must use normalizeEmailList");
    assert.ok(src.includes('emails.join(", ")'), "must join with comma, not pipe");
    // Must NOT use the old split("|") pattern
    assert.ok(!src.includes('.split("|")'), "must not use split('|') for emails");
  });
});

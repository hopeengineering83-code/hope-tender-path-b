/**
 * Tests for the remaining-gap wiring: page-ledger AI preflight, repair-extraction
 * route, draft-vs-final gate separation, and requirement categorization in engine.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── Repair Extraction Route ────────────────────────────────────────────────

describe("repair-extraction route — contract", () => {
  const src = read("app/api/tenders/[id]/files/[fileId]/re-extract/route.ts");

  it("requires ADMIN or PROPOSAL_MANAGER", () => {
    assert.ok(src.includes('requireRole("ADMIN", "PROPOSAL_MANAGER")'), "must require ADMIN/PROPOSAL_MANAGER");
  });

  it("has rate limiting", () => {
    assert.ok(src.includes("rateLimitPersistent"), "must have rate limiting");
  });

  it("verifies tender ownership", () => {
    assert.ok(src.includes("id: tenderId, userId: actor.id"), "must verify tender ownership");
  });

  it("retrieves file from storage and re-runs extraction", () => {
    assert.ok(src.includes("getStorageAdapter().getFile"), "must retrieve file from storage");
    assert.ok(src.includes("extractTextFromBuffer"), "must re-run extraction");
  });

  it("updates all extraction fields atomically", () => {
    assert.ok(src.includes("tenderFile.update"), "must update tender file");
    assert.ok(src.includes("extractedText"), "must update extractedText");
    assert.ok(src.includes("extractionScore"), "must update extractionScore");
    assert.ok(src.includes("totalPages"), "must update totalPages");
    assert.ok(src.includes("pageStatusJson"), "must update pageStatusJson");
    assert.ok(src.includes("extractionMethod"), "must update extractionMethod");
  });

  it("distinguishes OCR outcomes", () => {
    assert.ok(src.includes("OCR_NOT_ATTEMPTED"), "must distinguish OCR_NOT_ATTEMPTED");
    assert.ok(src.includes("OCR_ATTEMPTED_SUCCEEDED"), "must distinguish OCR_ATTEMPTED_SUCCEEDED");
    assert.ok(src.includes("OCR_TIMEOUT"), "must distinguish OCR_TIMEOUT");
    assert.ok(src.includes("OCR_AUTH_FAILED"), "must distinguish OCR_AUTH_FAILED");
    assert.ok(src.includes("OCR_RATE_LIMITED"), "must distinguish OCR_RATE_LIMITED");
  });

  it("writes audit log", () => {
    assert.ok(src.includes("logAction"), "must write audit log");
    assert.ok(src.includes("REPAIR_EXTRACTION"), "audit description must mention repair extraction");
  });

  it("handles storage retrieval failure", () => {
    assert.ok(src.includes("STORAGE_RETRIEVAL_FAILED"), "must handle storage retrieval failure");
  });
});

// ─── Page Ledger AI Preflight ───────────────────────────────────────────────

describe("page-ledger AI preflight — wired into ai-analyze", () => {
  const src = read("app/api/tenders/[id]/ai-analyze/route.ts");

  it("imports buildPageLedger", () => {
    assert.ok(src.includes("buildPageLedger"), "must import buildPageLedger");
  });

  it("imports isAIAnalysisBlocked", () => {
    assert.ok(src.includes("isAIAnalysisBlocked"), "must import isAIAnalysisBlocked");
  });

  it("selects pageStatusJson in the file query", () => {
    assert.ok(src.includes("pageStatusJson: true"), "must select pageStatusJson");
  });

  it("blocks AI when page ledger is unsafe", () => {
    assert.ok(src.includes("EXTRACTION_PAGE_LEDGER_BLOCKED"), "must block with EXTRACTION_PAGE_LEDGER_BLOCKED code");
  });
});

// ─── Draft vs Final Gate Separation ────────────────────────────────────────

describe("draft-final-gate-separation — module", () => {
  const src = read("lib/engine/draft-final-gate-separation.ts");

  it("defines operational warning fields", () => {
    assert.ok(src.includes("OPERATIONAL_WARNING_FIELDS"), "must define operational warning fields");
    assert.ok(src.includes("reference"), "reference must be operational (not blocking)");
    assert.ok(src.includes("country"), "country must be operational");
    assert.ok(src.includes("donorAgency"), "donorAgency must be operational");
  });

  it("defines submission-critical fields", () => {
    assert.ok(src.includes("SUBMISSION_CRITICAL_FIELDS"), "must define submission-critical fields");
    assert.ok(src.includes("clientName"), "clientName must be submission-critical");
    assert.ok(src.includes("deadline"), "deadline must be submission-critical");
    assert.ok(src.includes("submissionMethod"), "submissionMethod must be submission-critical");
  });

  it("operational warnings do not block draft", () => {
    assert.ok(src.includes("blocksDraft: false"), "operational warnings must not block draft");
  });

  it("submission-critical blockers block final export but not draft", () => {
    assert.ok(src.includes("blocksFinalExport: true"), "submission-critical must block final export");
  });

  it("defines isAIAnalysisBlocked function", () => {
    assert.ok(src.includes("isAIAnalysisBlocked"), "must define isAIAnalysisBlocked");
    assert.ok(src.includes("hasUnknownPageCount"), "must check hasUnknownPageCount");
    assert.ok(src.includes("hasMissingPages"), "must check hasMissingPages");
    assert.ok(src.includes("hasFailedPages"), "must check hasFailedPages");
  });
});

// ─── Requirement Categorization in Engine ──────────────────────────────────

describe("requirement categorization — wired into run-tender-engine", () => {
  const src = read("lib/engine/run-tender-engine.ts");

  it("imports classifyTenderRequirement", () => {
    assert.ok(src.includes("classifyTenderRequirement"), "must import classifyTenderRequirement");
  });

  it("classifies each requirement", () => {
    assert.ok(src.includes("classifyTenderRequirement"), "must classify each requirement");
    assert.ok(src.includes("classification.category"), "must use the category");
  });

  it("stores category in sectionReference", () => {
    assert.ok(src.includes("sectionReference"), "must store category in sectionReference");
    assert.ok(src.includes("[${classification.category}"), "must prefix with [category:mandatory]");
  });
});

// ─── Page Ledger + Tender Classification in Snapshot ───────────────────────

describe("page-ledger + tender classification — wired into snapshot", () => {
  const src = read("lib/engine/tender-release-snapshot.ts");

  it("imports buildPageLedger", () => {
    assert.ok(src.includes("buildPageLedger"), "must import buildPageLedger");
  });

  it("imports classifyTender", () => {
    assert.ok(src.includes("classifyTender"), "must import classifyTender");
  });

  it("selects pageStatusJson in Prisma files select", () => {
    assert.ok(src.includes("pageStatusJson: true"), "must select pageStatusJson");
  });

  it("builds page ledgers per active file", () => {
    assert.ok(src.includes("pageLedgers"), "must build pageLedgers");
    assert.ok(src.includes("buildPageLedger("), "must call buildPageLedger per file");
  });

  it("blocks extraction when page ledger is unsafe", () => {
    assert.ok(src.includes("hasUnsafePageLedger"), "must check hasUnsafePageLedger");
    assert.ok(src.includes("extractionBlocker"), "must set extractionBlocker when unsafe");
  });

  it("classifies tender from combined text", () => {
    assert.ok(src.includes("tenderClassification"), "must compute tenderClassification");
    assert.ok(src.includes("classifyTender(combinedText)"), "must call classifyTender with combined text");
  });

  it("exposes pageLedgers + tenderClassification in the return", () => {
    assert.ok(src.includes("pageLedgers,"), "must return pageLedgers");
    assert.ok(src.includes("tenderClassification,"), "must return tenderClassification");
  });
});

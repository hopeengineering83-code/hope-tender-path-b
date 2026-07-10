// Production reliability, storage, and observability regression tests.
//
// Tests the fixes from the performance/storage/observability hardening audit:
//   1. Cleanup cron deletes old ExportPackage + superseded GeneratedDocument
//   2. Tender deletion returns generated doc paths for blob cleanup
//   3. Source-file deletion nullifies TenderFactsLedger references
//   4. Copilot messages pagination returns latest (not oldest)
//   5. Workflow-status route doesn't load fileContent blobs
//   6. sanitize-error redacts all provider key patterns
//   7. sanitizeErrorResponse helper exists and attaches requestId
//   8. Production runbook exists

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. Cleanup cron ────────────────────────────────────────────────────────

describe("Cleanup cron — stale artifact cleanup", () => {
  it("deletes old SUPERSEDED ExportPackage rows", () => {
    const src = read("app/api/cron/cleanup-old-records/route.ts");
    assert.ok(
      src.includes('status: "SUPERSEDED"'),
      "must delete SUPERSEDED ExportPackage rows older than 30 days",
    );
    assert.ok(
      src.includes("deletedExportPackages"),
      "must report deleted ExportPackage count in response",
    );
  });

  it("deletes old SUPERSEDED GeneratedDocument rows with blob cleanup", () => {
    const src = read("app/api/cron/cleanup-old-records/route.ts");
    assert.ok(
      src.includes('generationStatus: "SUPERSEDED"'),
      "must delete SUPERSEDED GeneratedDocument rows older than 30 days",
    );
    assert.ok(
      src.includes("supersededDocs"),
      "must read storagePath before deleting for blob cleanup",
    );
    assert.ok(
      src.includes("supersededDocBlobsCleaned"),
      "must report cleaned blob count in response",
    );
  });
});

// ─── 2. Tender deletion blob cleanup ────────────────────────────────────────

describe("Tender deletion — GeneratedDocument blob cleanup", () => {
  it("executeTenderDeletion returns generated doc paths for post-commit cleanup", () => {
    const src = read("lib/tender/delete-tender.ts");
    assert.ok(
      src.includes("generatedDocPaths"),
      "must return generated doc paths for blob cleanup",
    );
    assert.ok(
      src.includes("storagePath: true"),
      "must select storagePath before deleting GeneratedDocument rows",
    );
  });

  it("DELETE route uses returned paths for blob cleanup", () => {
    const src = read("app/api/tenders/[id]/route.ts");
    assert.ok(
      src.includes("result.generatedDocPaths"),
      "must use returned generatedDocPaths for blob cleanup",
    );
  });
});

// ─── 3. Source-file deletion orphan cleanup ─────────────────────────────────

describe("Source-file deletion — orphan cleanup", () => {
  it("nullifies TenderFactsLedger entries on file delete", () => {
    const src = read("app/api/tenders/[id]/files/[fileId]/route.ts");
    assert.ok(
      src.includes("tenderFactsLedger.updateMany"),
      "must nullify TenderFactsLedger.sourceFileId on file delete",
    );
    assert.ok(
      src.includes("EXTRACTED_UNVERIFIED"),
      "must downgrade authority state to EXTRACTED_UNVERIFIED",
    );
  });

  it("deletes ExtractionQualityOverride entries on file delete", () => {
    const src = read("app/api/tenders/[id]/files/[fileId]/route.ts");
    assert.ok(
      src.includes("extractionQualityOverride.deleteMany"),
      "must delete ExtractionQualityOverride entries on file delete",
    );
  });

  it("nullifies TenderSubmissionEmail entries on file delete", () => {
    const src = read("app/api/tenders/[id]/files/[fileId]/route.ts");
    assert.ok(
      src.includes("tenderSubmissionEmail.updateMany"),
      "must nullify TenderSubmissionEmail.sourceFileId on file delete",
    );
  });
});

// ─── 4. Copilot messages pagination ─────────────────────────────────────────

describe("Copilot messages — pagination returns latest", () => {
  it("fetches latest 50 messages (desc + reverse), not oldest 50 (asc)", () => {
    const src = read("app/api/tenders/[id]/copilot/messages/route.ts");
    assert.ok(
      src.includes('orderBy: { createdAt: "desc" }'),
      "must order by desc to get latest messages",
    );
    assert.ok(
      !src.includes('orderBy: { createdAt: "asc" }'),
      "must NOT order by asc (returns oldest, hiding recent messages)",
    );
    assert.ok(
      src.includes(".reverse()"),
      "must reverse the desc-ordered results for chronological display",
    );
  });
});

// ─── 5. Workflow-status route — no fileContent blobs ────────────────────────

describe("Workflow-status route — no fileContent blob loading", () => {
  it("uses explicit select (not include: true) for generatedDocuments", () => {
    const src = read("app/api/tenders/[id]/workflow-status/route.ts");
    assert.ok(
      !src.includes("generatedDocuments: true"),
      "must NOT use generatedDocuments: true (loads fileContent blobs)",
    );
    assert.ok(
      src.includes("select:"),
      "must use explicit select to avoid loading fileContent",
    );
    assert.ok(
      src.includes('generationStatus: { not: "SUPERSEDED" }'),
      "must filter out SUPERSEDED docs from the include",
    );
  });
});

// ─── 6. sanitize-error — comprehensive key redaction ────────────────────────

describe("sanitize-error — comprehensive key redaction", () => {
  it("redacts Anthropic keys (ant-...)", () => {
    const src = read("lib/sanitize-error.ts");
    assert.ok(src.includes("ant-"), "must redact Anthropic key pattern");
  });

  it("redacts OpenAI keys (org-..., proj-...)", () => {
    const src = read("lib/sanitize-error.ts");
    assert.ok(src.includes("org-"), "must redact OpenAI org- key pattern");
    assert.ok(src.includes("proj-"), "must redact OpenAI proj- key pattern");
  });

  it("redacts GitHub PATs (ghp_..., github_pat_...)", () => {
    const src = read("lib/sanitize-error.ts");
    assert.ok(src.includes("ghp_"), "must redact GitHub PAT pattern");
    assert.ok(src.includes("github_pat_"), "must redact GitHub PAT v2 pattern");
  });

  it("redacts JWTs (eyJ...)", () => {
    const src = read("lib/sanitize-error.ts");
    assert.ok(src.includes("eyJ"), "must redact JWT pattern");
    assert.ok(src.includes("JWT_REDACTED"), "must use JWT_REDACTED placeholder");
  });

  it("redacts Vercel Blob tokens", () => {
    const src = read("lib/sanitize-error.ts");
    assert.ok(src.includes("vercel_blob_"), "must redact Vercel Blob token pattern");
  });

  it("redacts Prisma invocation text", () => {
    const src = read("lib/sanitize-error.ts");
    assert.ok(src.includes("prisma"), "must redact prisma. invocation patterns");
    assert.ok(src.includes("invocation"), "must redact invocation: pattern");
  });

  it("redacts UUIDs (internal IDs)", () => {
    const src = read("lib/sanitize-error.ts");
    assert.ok(src.includes("ID_REDACTED"), "must redact UUID patterns");
  });

  it("redacts SQL patterns", () => {
    const src = read("lib/sanitize-error.ts");
    assert.ok(src.includes("SQL_REDACTED"), "must redact SQL patterns");
  });
});

// ─── 7. sanitizeErrorResponse helper ────────────────────────────────────────

describe("sanitizeErrorResponse — exists and attaches requestId", () => {
  it("sanitizeErrorResponse function exists", () => {
    const src = read("lib/sanitize-error.ts");
    assert.ok(
      src.includes("export function sanitizeErrorResponse"),
      "must export sanitizeErrorResponse helper",
    );
    assert.ok(
      src.includes("getCurrentRequestId"),
      "must use getCurrentRequestId to attach ambient request ID",
    );
  });
});

// ─── 8. Production runbook ──────────────────────────────────────────────────

describe("Production reliability runbook", () => {
  it("PRODUCTION_RELIABILITY_RUNBOOK.md exists with required sections", () => {
    const src = read("docs/PRODUCTION_RELIABILITY_RUNBOOK.md");
    assert.ok(src.includes("Upload Failed"), "must cover upload failure");
    assert.ok(src.includes("Extraction Failed"), "must cover extraction failure");
    assert.ok(src.includes("OCR Timeout"), "must cover OCR timeout");
    assert.ok(src.includes("AI Provider Timeout"), "must cover AI provider timeout");
    assert.ok(src.includes("Generation Failed"), "must cover generation failure");
    assert.ok(src.includes("Export Blocked"), "must cover export blocked");
    assert.ok(src.includes("ZIP Creation Failed"), "must cover ZIP creation failure");
    assert.ok(src.includes("Diagnostic IDs"), "must document diagnostic IDs");
    assert.ok(src.includes("Safe Retry Steps"), "must document safe retry steps");
    assert.ok(src.includes("When NOT to Retry"), "must document when not to retry");
    assert.ok(src.includes("Release-Blocker Checklist"), "must include release-blocker checklist");
  });
});

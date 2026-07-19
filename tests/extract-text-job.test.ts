/**
 * Tests for the EXTRACT_TEXT background job — verifies the job type is
 * registered, the handler is wired in, and the worker routes it correctly.
 *
 * The handler itself requires a real DB + storage adapter, so we test it
 * via source-inspection + the pure-function pieces (JobType union, handler
 * registration, worker routing).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { SUPPORTED_JOB_TYPES, parseJobTypeFilter } from "../lib/job-type-policy";
import type { JobType } from "../lib/ai-jobs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── JobType union tests ────────────────────────────────────────────────────

describe("EXTRACT_TEXT job — JobType union + policy", () => {
  it("JobType union includes EXTRACT_TEXT", () => {
    const src = read("lib/ai-jobs.ts");
    assert.ok(src.includes('"EXTRACT_TEXT"'), "JobType union must include EXTRACT_TEXT");
  });

  it("SUPPORTED_JOB_TYPES includes EXTRACT_TEXT", () => {
    assert.ok(
      (SUPPORTED_JOB_TYPES as readonly string[]).includes("EXTRACT_TEXT"),
      "SUPPORTED_JOB_TYPES must include EXTRACT_TEXT",
    );
  });

  it("parseJobTypeFilter accepts EXTRACT_TEXT", () => {
    const result = parseJobTypeFilter("EXTRACT_TEXT");
    assert.ok(result.ok, "parseJobTypeFilter must accept EXTRACT_TEXT");
    assert.equal(result.ok && result.value, "EXTRACT_TEXT");
  });

  it("parseJobTypeFilter rejects unknown job types", () => {
    const result = parseJobTypeFilter("UNKNOWN_JOB_TYPE");
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.code, "INVALID_JOB_TYPE");
  });

  it("EXTRACT_TEXT satisfies the JobType type", () => {
    const jt: JobType = "EXTRACT_TEXT";
    assert.equal(jt, "EXTRACT_TEXT");
  });
});

// ─── Handler registration tests ─────────────────────────────────────────────

describe("EXTRACT_TEXT job — handler registration", () => {
  it("ai-job-handlers.ts imports required modules for EXTRACT_TEXT", () => {
    const src = read("lib/ai-job-handlers.ts");
    assert.ok(src.includes("from \"./storage\""), "must import storage");
    assert.ok(src.includes("from \"./extract-text\""), "must import extract-text");
    assert.ok(src.includes("from \"./extraction-quality\""), "must import extraction-quality");
    assert.ok(src.includes("from \"./engine/auto-fill-tender-metadata\""), "must import canonical metadata auto-fill");
    assert.ok(src.includes("from \"./engine/metadata-source-enrichment\""), "must import metadata-source-enrichment");
    assert.ok(src.includes("from \"./engine/candidate-pipeline\""), "must import candidate-pipeline");
  });

  it("EXTRACT_TEXT handler is registered in the handlers record", () => {
    const src = read("lib/ai-job-handlers.ts");
    assert.ok(src.includes("EXTRACT_TEXT: async (ctx)"), "must register EXTRACT_TEXT handler");
  });

  it("EXTRACT_TEXT handler requires tenderFileId in input", () => {
    const src = read("lib/ai-job-handlers.ts");
    assert.ok(
      src.includes('EXTRACT_TEXT requires tenderFileId in the job input'),
      "must validate tenderFileId is present",
    );
  });

  it("EXTRACT_TEXT handler reads the file from storage", () => {
    const src = read("lib/ai-job-handlers.ts");
    assert.ok(src.includes("getStorageAdapter().getFile"), "must call getFile on storage adapter");
  });

  it("EXTRACT_TEXT handler runs extractTextFromBuffer", () => {
    const src = read("lib/ai-job-handlers.ts");
    assert.ok(src.includes("extractTextFromBuffer(buffer, file.mimeType, file.originalFileName)"), "must call extractTextFromBuffer");
  });

  it("EXTRACT_TEXT handler persists all extraction fields", () => {
    const src = read("lib/ai-job-handlers.ts");
    // The handler must update extractedText, totalPages, extractionScore, etc.
    assert.ok(src.includes("extractedText: extractedText || null"), "must persist extractedText");
    assert.ok(src.includes("totalPages:"), "must persist totalPages");
    assert.ok(src.includes("extractionScore:"), "must persist extractionScore");
    assert.ok(src.includes("extractionMethod:"), "must persist extractionMethod");
    assert.ok(src.includes("pageStatusJson:"), "must persist pageStatusJson");
  });

  it("EXTRACT_TEXT handler distinguishes OCR outcomes", () => {
    const src = read("lib/ai-job-handlers.ts");
    assert.ok(src.includes("OCR_NOT_ATTEMPTED"), "must distinguish OCR_NOT_ATTEMPTED");
    assert.ok(src.includes("OCR_ATTEMPTED_SUCCEEDED"), "must distinguish OCR_ATTEMPTED_SUCCEEDED");
    assert.ok(src.includes("OCR_TIMEOUT"), "must distinguish OCR_TIMEOUT");
    assert.ok(src.includes("OCR_AUTH_FAILED"), "must distinguish OCR_AUTH_FAILED");
    assert.ok(src.includes("OCR_RATE_LIMITED"), "must distinguish OCR_RATE_LIMITED");
  });

  it("EXTRACT_TEXT handler applies inferred metadata before enrichment + candidate classification", () => {
    const src = read("lib/ai-job-handlers.ts");
    assert.ok(src.includes("autoFillTenderMetadata"), "must fill empty metadata through the canonical helper");
    assert.ok(src.includes("const effectiveTender = await prisma.tender.findUnique"), "must re-read effective stored values after auto-fill");
    assert.ok(src.includes("enrichMetadataWithSourceEvidence"), "must call enrichMetadataWithSourceEvidence");
    assert.ok(src.includes("buildCandidatesFromMetadata"), "must call buildCandidatesFromMetadata");
    assert.ok(!src.includes("const draft = combinedText"), "must not compute and discard an inferred metadata draft");
  });

  it("EXTRACT_TEXT handler records step progress", () => {
    const src = read("lib/ai-job-handlers.ts");
    assert.ok(src.includes('stepName: "extract.load"'), "must record extract.load step");
    assert.ok(src.includes('stepName: "extract.storage-read"'), "must record extract.storage-read step");
    assert.ok(src.includes('stepName: "extract.run"'), "must record extract.run step");
    assert.ok(src.includes('stepName: "extract.persist"'), "must record extract.persist step");
    assert.ok(src.includes('stepName: "extract.complete"'), "must record extract.complete step");
  });

  it("EXTRACT_TEXT handler wraps metadata enrichment in try/catch (best-effort)", () => {
    const src = read("lib/ai-job-handlers.ts");
    assert.ok(src.includes("extract.enrich-failed"), "must record enrichment failures");
    assert.ok(src.includes("Tender detail enrichment failed (non-fatal)"), "must log enrichment failures as non-fatal");
  });
});

// ─── Worker routing tests ───────────────────────────────────────────────────

describe("EXTRACT_TEXT job — worker routing", () => {
  it("run-next route includes EXTRACT_TEXT in the break-after-one list", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    assert.ok(
      src.includes('"EXTRACT_TEXT"') && src.includes(".includes(claimed.jobType))"),
      "worker must break after one EXTRACT_TEXT job (long-running)",
    );
  });
});

// ─── Integration: candidate-pipeline + EXTRACT_TEXT ─────────────────────────

describe("EXTRACT_TEXT + candidate-pipeline integration", () => {
  it("candidate-pipeline module exports buildCandidatesFromMetadata", () => {
    const src = read("lib/engine/candidate-pipeline.ts");
    assert.ok(src.includes("export function buildCandidatesFromMetadata"), "candidate-pipeline must export buildCandidatesFromMetadata");
  });

  it("EXTRACT_TEXT handler passes candidateType=regex to the candidate pipeline", () => {
    const src = read("lib/ai-job-handlers.ts");
    assert.ok(
      src.includes('candidateType: "regex"') && src.includes('extractionSourcePrefix: "extract-text-job"'),
      "EXTRACT_TEXT handler must use candidateType=regex and extractionSourcePrefix=extract-text-job",
    );
  });
});

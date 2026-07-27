/**
 * Tests for the EXTRACT_TEXT background job — verifies the job type is
 * registered, the handler is wired in, and the worker routes it correctly.
 *
 * EXTRACT_TEXT's implementation lives in lib/ai-jobs/tender-extraction-service.ts
 * (runTenderFileExtractionJob), deliberately separated from the other job
 * handlers in ai-job-handlers-legacy.ts so upload requests never run
 * extraction/OCR synchronously and a stale or cross-tenant source cannot be
 * processed — see lib/ai-job-handlers.ts's getHandler, which special-cases
 * EXTRACT_TEXT and delegates every other job type to the legacy registry.
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
  const registry = read("lib/ai-job-handlers.ts");
  const service = read("lib/ai-jobs/tender-extraction-service.ts");

  it("ai-job-handlers.ts routes EXTRACT_TEXT to the revision-bound extraction service", () => {
    assert.match(registry, /import \{ runTenderFileExtractionJob \} from "\.\/ai-jobs\/tender-extraction-service"/);
    assert.match(registry, /if \(jobType === "EXTRACT_TEXT"\) \{\s*return runTenderFileExtractionJob as JobHandler;/);
  });

  it("tender-extraction-service.ts imports required modules for EXTRACT_TEXT", () => {
    assert.ok(service.includes('from "../storage"'), "must import storage");
    assert.ok(service.includes('from "../extract-text"'), "must import extract-text");
    assert.ok(service.includes('from "../extraction-quality"'), "must import extraction-quality");
    assert.ok(service.includes('from "../engine/auto-fill-tender-metadata"'), "must import canonical metadata auto-fill");
    assert.ok(service.includes('from "../engine/metadata-source-enrichment"'), "must import metadata-source-enrichment");
    assert.ok(service.includes('from "../engine/candidate-pipeline"'), "must import candidate-pipeline");
  });

  it("EXTRACT_TEXT job handler is exported as runTenderFileExtractionJob", () => {
    assert.match(service, /export async function runTenderFileExtractionJob/);
  });

  it("EXTRACT_TEXT handler requires tenderId, tenderFileId, companyId, and a valid source hash in input", () => {
    assert.match(service, /if \(!ctx\.tenderId \|\| !tenderFileId \|\| !companyId \|\| !\/\^\[a-f0-9\]\{64\}\$\/\.test\(expectedHash\)\) \{/);
    assert.match(service, /throw new Error\("EXTRACT_TEXT_INPUT_INVALID"\);/);
  });

  it("EXTRACT_TEXT handler verifies tenant ownership and returns SUPERSEDED rather than throwing on a stale/foreign source", () => {
    assert.match(service, /where: \{ id: ctx\.tenderId, userId: ctx\.userId \}/);
    assert.match(service, /terminalStatus: "SUPERSEDED"/);
    assert.match(service, /code: "EXTRACTION_SCOPE_SUPERSEDED"/);
    assert.match(service, /code: "SOURCE_REVISION_SUPERSEDED"/);
  });

  it("EXTRACT_TEXT handler reads the file from storage", () => {
    assert.ok(service.includes("getStorageAdapter().getFile"), "must call getFile on storage adapter");
  });

  it("EXTRACT_TEXT handler runs extractTextFromBuffer", () => {
    assert.ok(service.includes("extractTextFromBuffer(buffer, file.mimeType, file.originalFileName)"), "must call extractTextFromBuffer");
  });

  it("EXTRACT_TEXT handler persists all extraction fields", () => {
    assert.ok(service.includes("extractedText: extractedText || null"), "must persist extractedText");
    assert.ok(service.includes("totalPages: metrics!.totalPages"), "must persist totalPages");
    assert.ok(service.includes("extractionScore: metrics!.extractionScore"), "must persist extractionScore");
    assert.ok(service.includes("extractionMethod: metrics!.extractionMethod"), "must persist extractionMethod");
    assert.ok(service.includes("pageStatusJson: metrics!.pageStatusJson"), "must persist pageStatusJson");
  });

  it("EXTRACT_TEXT handler distinguishes OCR outcomes", () => {
    // deriveOcrOutcome() restores the fine-grained OCR-failure-reason
    // categorization (a real diagnostic, not just the coarser persisted
    // text/ocr/mixed/failed extractionMethod) that the pre-split inline
    // EXTRACT_TEXT handler in ai-job-handlers-legacy.ts computed; it is
    // threaded into the job's returned output and completion step message.
    assert.match(service, /function deriveOcrOutcome\(text: string\): string \{/);
    assert.ok(service.includes('"OCR_NOT_ATTEMPTED"'), "must distinguish OCR_NOT_ATTEMPTED");
    assert.ok(service.includes('"OCR_ATTEMPTED_SUCCEEDED"'), "must distinguish OCR_ATTEMPTED_SUCCEEDED");
    assert.ok(service.includes('"OCR_TIMEOUT"'), "must distinguish OCR_TIMEOUT");
    assert.ok(service.includes('"OCR_AUTH_FAILED"'), "must distinguish OCR_AUTH_FAILED");
    assert.ok(service.includes('"OCR_RATE_LIMITED"'), "must distinguish OCR_RATE_LIMITED");
    assert.match(service, /const ocrOutcome = deriveOcrOutcome\(extractedText\);/);
    assert.match(service, /ocrOutcome,\n\s*continuationReason: continuation\.reason,/, );
  });

  it("EXTRACT_TEXT handler applies inferred metadata before enrichment + candidate classification", () => {
    assert.ok(service.includes("autoFillTenderMetadata"), "must fill empty metadata through the canonical helper");
    assert.ok(service.includes("const effectiveTender = await prisma.tender.findUnique"), "must re-read effective stored values after auto-fill");
    assert.ok(service.includes("enrichMetadataWithSourceEvidence"), "must call enrichMetadataWithSourceEvidence");
    assert.ok(service.includes("buildCandidatesFromMetadata"), "must call buildCandidatesFromMetadata");
    assert.ok(!service.includes("const draft = combinedText"), "must not compute and discard an inferred metadata draft");
  });

  it("EXTRACT_TEXT handler records step progress", () => {
    assert.ok(service.includes('stepName: "extract.scope"'), "must record extract.scope step");
    assert.ok(service.includes('stepName: "extract.storage-read"'), "must record extract.storage-read step");
    assert.ok(service.includes('stepName: "extract.run"'), "must record extract.run step");
    assert.ok(service.includes('stepName: "extract.resume"'), "must record extract.resume step when reusing a durable checkpoint");
    assert.ok(service.includes('stepName: "extract.complete"'), "must record extract.complete step");
  });

  it("EXTRACT_TEXT handler treats metadata enrichment as best-effort (non-fatal on failure)", () => {
    const enrichBlockStart = service.indexOf("try {\n    await enrichTenderFromCurrentSources({");
    const enrichBlockEnd = service.indexOf("const continuation = await continueTenderPipelineAfterExtraction", enrichBlockStart);
    assert.ok(enrichBlockStart >= 0 && enrichBlockEnd > enrichBlockStart, "enrichment call site must exist");
    const region = service.slice(enrichBlockStart, enrichBlockEnd);
    assert.match(region, /try \{[\s\S]*catch \(error\) \{/);
    assert.match(region, /logger\.warn\("\[extract-text\] source enrichment failed after durable extraction"/);
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
    const src = read("lib/ai-jobs/tender-extraction-service.ts");
    assert.ok(
      src.includes('candidateType: "regex"') && src.includes('extractionSourcePrefix: "extract-text-job"'),
      "EXTRACT_TEXT handler must use candidateType=regex and extractionSourcePrefix=extract-text-job",
    );
  });
});

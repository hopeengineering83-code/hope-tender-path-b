import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("durable analysis worker grounding guarantees", () => {
  const source = read("lib/ai-jobs/analysis-job-service.ts");

  it("uses the canonical full-quote page resolver for all critical fields", () => {
    assert.match(source, /locateQuoteProvenPage/);
    assert.doesNotMatch(source, /slice\(0, Math\.min\(20/);
    assert.doesNotMatch(source, /idx >= 0 \? idx : 0/);
    for (const field of [
      "tenderTitleSourcePage",
      "deadlineSourcePage",
      "clientNameSourcePage",
      "submissionEmailSourcePage",
      "submissionMethodSourcePage",
      "submissionAddressSourcePage",
    ]) assert.match(source, new RegExp(`guardedMerged\\.${field}`));
  });

  it("preserves contact evidence and re-resolves stale reference file ownership", () => {
    assert.match(source, /existingContactDetailsSourceJson/);
    assert.match(source, /contactDetails\["procurementReferenceNumber"\]/);
    assert.match(source, /attributeMetadataSourceFileId/);
    assert.match(source, /existingFileIdStillActive/);
    assert.match(source, /!refEntry\.fileId \|\| !existingFileIdStillActive/);
    assert.match(source, /reference fileId resolution failed \(non-critical\)/);
  });
});

describe("canonical analysis source merge", () => {
  const source = read("lib/engine/canonical-analysis-update.ts");

  it("preserves file identity only when quotes still match", () => {
    assert.match(source, /function mergeContactDetailsSource/);
    assert.match(source, /quotesMatch/);
    assert.match(source, /quotesMatch \? existingFileId : null/);
    assert.match(source, /existing = \{\}/);
  });
});

describe("metadata evidence clearing", () => {
  const source = read("lib/engine/metadata-source-enrichment.ts");

  it("clears every source column for reference and email-subject fields", () => {
    for (const text of [
      'case "reference":',
      "referenceSourceFileId = null",
      "referenceSourcePage = null",
      "referenceSourceQuote = null",
      'case "submissionEmailSubject":',
      "submissionEmailSubjectSourceFileId = null",
      "submissionEmailSubjectSourcePage = null",
      "submissionEmailSubjectSourceQuote = null",
      "const clear: Record<string, null> = {};",
    ]) assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

describe("source repair clears stale page identity", () => {
  it("writes the resolved page unconditionally", () => {
    const source = read("lib/engine/repair-source-grounding.ts");
    assert.doesNotMatch(source, /page !== null \? \{ sourcePageNumber:/);
    assert.match(source, /sourcePageNumber: repair\.page/);
  });

  it("metadata repair writes nullable page fields unconditionally", () => {
    const source = read("app/api/tenders/[id]/repair-metadata/route.ts");
    assert.doesNotMatch(source, /if \(provenPage != null\)/);
    assert.match(source, /\[evidenceCols\.page\] = provenPage/);
    assert.match(source, /referenceSourcePage = provenPage/);
  });
});

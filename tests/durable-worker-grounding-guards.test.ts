/**
 * Source-inspection tests for the durable AI_ANALYZE worker path
 * (lib/ai-jobs/analysis-job-service.ts).
 *
 * These tests verify that the durable worker (the THIRD promotion path,
 * alongside streaming and non-streaming ai-analyze/route.ts) has the same
 * grounding guarantees:
 *   1. Guards AI-claimed page numbers via locateQuoteProvenPage (fail-closed).
 *   2. Passes existingContactDetailsSourceJson to buildCanonicalAnalysisTenderUpdate.
 *   3. Resolves reference fileId after the transaction.
 *   4. Re-resolves fileId when it points to a deleted/inactive file.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("analysis-job-service.ts — durable worker grounding guarantees", () => {
  const src = read("lib/ai-jobs/analysis-job-service.ts");

  it("imports locateQuoteProvenPage from page-provenance", () => {
    assert.ok(
      src.includes('import { locateQuoteProvenPage } from "../engine/page-provenance";'),
      "durable worker must import the canonical quote→page resolver locateQuoteProvenPage",
    );
  });

  it("SELECT includes totalPages and contactDetailsSourceJson", () => {
    assert.ok(
      src.includes("totalPages: true") && src.includes("contactDetailsSourceJson: true"),
      "durable worker SELECT must include totalPages and contactDetailsSourceJson",
    );
  });

  it("guards AI page numbers via locateQuoteProvenPage (full-quote, fail-closed)", () => {
    // The guard is an inline guardPage function that calls the canonical
    // quote→page resolver. It must NOT use prefix matching or a normalized
    // offset against the original text (the pre-#936 bugs).
    assert.ok(
      src.includes("locateQuoteProvenPage("),
      "durable worker must call locateQuoteProvenPage to guard AI page numbers",
    );
    assert.ok(
      !src.includes("slice(0, Math.min(20"),
      "durable worker must NOT prove pages from a 20-char quote prefix",
    );
    assert.ok(
      !src.includes("idx >= 0 ? idx : 0"),
      "durable worker must NOT fall back to offset 0 for unfound quotes (invents page 1)",
    );
    // Must guard all 6 critical fields
    for (const field of [
      "tenderTitleSourcePage",
      "deadlineSourcePage",
      "clientNameSourcePage",
      "submissionEmailSourcePage",
      "submissionMethodSourcePage",
      "submissionAddressSourcePage",
    ]) {
      assert.ok(
        src.includes(`guardedMerged.${field}`),
        `durable worker must guard ${field}`,
      );
    }
  });

  it("passes existingContactDetailsSourceJson to buildCanonicalAnalysisTenderUpdate", () => {
    assert.ok(
      src.includes("existingContactDetailsSourceJson: existingTender?.contactDetailsSourceJson ?? null"),
      "durable worker must pass existingContactDetailsSourceJson to preserve repair-written fileId",
    );
  });

  it("resolves reference fileId after the transaction", () => {
    assert.ok(
      src.includes('contactDetails["procurementReferenceNumber"]'),
      "durable worker must resolve reference fileId after the transaction",
    );
    assert.ok(
      src.includes("attributeMetadataSourceFileId(refEntry.quote, attrFiles)"),
      "durable worker must call attributeMetadataSourceFileId to resolve reference fileId",
    );
  });

  it("re-resolves fileId when it points to a deleted/inactive file", () => {
    assert.ok(
      src.includes("existingFileIdStillActive"),
      "durable worker must check if existing fileId is still active before skipping re-resolution",
    );
    assert.ok(
      src.includes("!refEntry.fileId || !existingFileIdStillActive"),
      "durable worker must re-resolve when fileId is missing OR points to a deleted file",
    );
  });

  it("wraps reference fileId resolution in try/catch (non-fatal)", () => {
    assert.ok(
      src.includes("reference fileId resolution failed (non-critical)"),
      "durable worker must wrap reference fileId resolution in try/catch so a failure doesn't break the analysis",
    );
  });
});

describe("canonical-analysis-update.ts — mergeContactDetailsSource edge cases", () => {
  const src = read("lib/engine/canonical-analysis-update.ts");

  it("mergeContactDetailsSource function exists", () => {
    assert.ok(
      src.includes("function mergeContactDetailsSource("),
      "mergeContactDetailsSource function must exist",
    );
  });

  it("preserves existing fileId when AI re-emits with same quote", () => {
    assert.ok(
      src.includes("quotesMatch"),
      "mergeContactDetailsSource must check if quotes match before preserving fileId",
    );
  });

  it("drops existing fileId when AI re-emits with different quote", () => {
    assert.ok(
      src.includes("(quotesMatch ? existingFileId : null)"),
      "mergeContactDetailsSource must drop fileId when quotes don't match",
    );
  });

  it("handles malformed existingJson gracefully", () => {
    assert.ok(
      src.includes('try {') && src.includes('} catch {') && src.includes("existing = {}"),
      "mergeContactDetailsSource must handle malformed JSON gracefully",
    );
  });
});

describe("metadata-source-enrichment.ts — clearEvidenceForField coverage", () => {
  const src = read("lib/engine/metadata-source-enrichment.ts");

  it("clearEvidenceForField handles reference", () => {
    assert.ok(
      src.includes('case "reference":') &&
      src.includes("referenceSourceFileId = null") &&
      src.includes("referenceSourcePage = null") &&
      src.includes("referenceSourceQuote = null"),
      "clearEvidenceForField must handle reference (clear referenceSource* columns)",
    );
  });

  it("clearEvidenceForField handles submissionEmailSubject (defensive)", () => {
    assert.ok(
      src.includes('case "submissionEmailSubject":') &&
      src.includes("submissionEmailSubjectSourceFileId = null") &&
      src.includes("submissionEmailSubjectSourcePage = null") &&
      src.includes("submissionEmailSubjectSourceQuote = null"),
      "clearEvidenceForField must handle submissionEmailSubject (defensive for future callers)",
    );
  });

  it("clearEvidenceForField returns empty object for unknown field", () => {
    // The switch has no default case, so unknown fields fall through and
    // return the empty `clear` object. This is safe but could mask typos.
    assert.ok(
      src.includes("const clear: Record<string, null> = {};"),
      "clearEvidenceForField must initialize with an empty object",
    );
  });
});

describe("repair-source-grounding.ts — always writes sourcePageNumber", () => {
  const src = read("lib/engine/repair-source-grounding.ts");

  it("sourcePageNumber is written unconditionally (not just when non-null)", () => {
    // The old code was: ...(bestMatch.page !== null ? { sourcePageNumber: bestMatch.page } : {})
    // The new code is: sourcePageNumber: bestMatch.page,
    assert.ok(
      !src.includes("bestMatch.page !== null ? { sourcePageNumber:"),
      "the old conditional sourcePageNumber write must be removed",
    );
    assert.ok(
      src.includes("sourcePageNumber: bestMatch.page"),
      "sourcePageNumber must be written unconditionally (even when null) to clear stale pages",
    );
  });
});

describe("repair-metadata route — always writes page column", () => {
  const src = read("app/api/tenders/[id]/repair-metadata/route.ts");

  it("page column is written unconditionally (not just when provenPage != null)", () => {
    // The old code was: if (provenPage != null) { ...[evidenceCols.page] = provenPage; }
    // The new code writes it unconditionally.
    assert.ok(
      !src.includes("if (provenPage != null)"),
      "the old conditional page write must be removed",
    );
    assert.ok(
      src.includes("[evidenceCols.page] = provenPage"),
      "page column must be written unconditionally (even when null) to clear stale pages",
    );
  });

  it("referenceSourcePage is written unconditionally", () => {
    assert.ok(
      src.includes("referenceSourcePage = provenPage"),
      "referenceSourcePage must be written unconditionally (even when null)",
    );
  });
});

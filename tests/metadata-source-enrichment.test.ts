/**
 * Regression tests for the metadata-source-enrichment module and its wiring
 * into re-extract-metadata, tender-upload-first, and ai-analyze.
 *
 * The enrichment module closes the structural gap where regex-extracted and
 * AI-extracted metadata values were persisted as bare scalars with zero
 * source evidence — leaving them EXTRACTED_UNVERIFIED forever. The enrichment
 * locates each critical field's value inside an active file's extracted text
 * and produces the source-evidence columns (fileId, page, quote) the canonical
 * resolver reads.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { enrichMetadataWithSourceEvidence } from "../lib/engine/metadata-source-enrichment";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. Behavioral tests for enrichMetadataWithSourceEvidence ────────────────

describe("enrichMetadataWithSourceEvidence — behavioral", () => {
  const files = [
    {
      id: "file-1",
      extractedText: "Page 1\nMinistry of Health\nProcurement Reference: REF-2026-001\nSubmission Deadline: 2026-12-30\nSubmit by email to submit@example.com\nPage 2\nTender Title: Medical Equipment Supply",
      deletionStatus: "ACTIVE",
    },
    {
      id: "file-2",
      extractedText: "Different content not matching",
      deletionStatus: "ACTIVE",
    },
    {
      id: "file-deleted",
      extractedText: "Ministry of Health",
      deletionStatus: "DELETED",
    },
  ];

  it("locates clientName in an active file and returns fileId + page + quote", () => {
    const result = enrichMetadataWithSourceEvidence(
      { clientName: "Ministry of Health" },
      files,
    );
    assert.ok(result.clientNameSourceFileId, "clientNameSourceFileId must be set");
    assert.equal(result.clientNameSourceFileId, "file-1");
    assert.ok(result.clientNameSourcePage !== undefined, "clientNameSourcePage must be set");
    assert.ok(result.clientNameSourceQuote, "clientNameSourceQuote must be set");
    assert.ok(result.clientNameSourceQuote.includes("Ministry of Health"), "quote must contain the value");
  });

  it("locates title in an active file", () => {
    const result = enrichMetadataWithSourceEvidence(
      { title: "Medical Equipment Supply" },
      files,
    );
    assert.equal(result.titleSourceFileId, "file-1");
    assert.ok(result.titleSourcePage !== undefined);
    assert.ok(result.titleSourceQuote?.includes("Medical Equipment Supply"));
  });

  it("locates deadline (ISO date form) in an active file", () => {
    const result = enrichMetadataWithSourceEvidence(
      { deadline: new Date("2026-12-30") },
      files,
    );
    assert.equal(result.deadlineSourceFileId, "file-1");
    assert.ok(result.deadlineSourcePage !== undefined);
    assert.ok(result.deadlineSourceQuote?.includes("2026-12-30"));
  });

  it("locates submissionMethod in an active file", () => {
    const result = enrichMetadataWithSourceEvidence(
      { submissionMethod: "email" },
      files,
    );
    assert.equal(result.submissionMethodSourceFileId, "file-1");
    assert.ok(result.submissionMethodSourceQuote?.includes("email"));
  });

  it("locates submissionAddress (email) in an active file", () => {
    const result = enrichMetadataWithSourceEvidence(
      { submissionAddress: "submit@example.com" },
      files,
    );
    assert.equal(result.submissionAddressSourceFileId, "file-1");
    assert.ok(result.submissionAddressSourceQuote?.includes("submit@example.com"));
  });

  it("locates submissionEmails (array) in an active file", () => {
    const result = enrichMetadataWithSourceEvidence(
      { submissionEmails: ["submit@example.com"] },
      files,
    );
    assert.equal(result.submissionEmailSourceFileId, "file-1");
    assert.ok(result.submissionEmailSourceQuote?.includes("submit@example.com"));
  });

  it("locates submissionEmails (pipe-delimited string) in an active file", () => {
    const result = enrichMetadataWithSourceEvidence(
      { submissionEmails: "submit@example.com" },
      files,
    );
    assert.equal(result.submissionEmailSourceFileId, "file-1");
  });

  it("locates reference and writes contactDetailsSourceJson with fileId", () => {
    const result = enrichMetadataWithSourceEvidence(
      { reference: "REF-2026-001" },
      files,
    );
    assert.ok(result.contactDetailsSourceJson, "contactDetailsSourceJson must be set");
    const parsed = JSON.parse(result.contactDetailsSourceJson!);
    assert.ok(parsed.procurementReferenceNumber, "procurementReferenceNumber entry must exist");
    assert.equal(parsed.procurementReferenceNumber.fileId, "file-1");
    assert.ok(parsed.procurementReferenceNumber.page !== null);
    assert.ok(parsed.procurementReferenceNumber.quote?.includes("REF-2026-001"));
  });

  it("merges reference evidence into existing contactDetailsSourceJson", () => {
    const existing = JSON.stringify({
      donorAgency: { page: 5, quote: "World Bank", fileId: null },
    });
    const result = enrichMetadataWithSourceEvidence(
      { reference: "REF-2026-001", existingContactDetailsSourceJson: existing },
      files,
    );
    assert.ok(result.contactDetailsSourceJson);
    const parsed = JSON.parse(result.contactDetailsSourceJson!);
    // Existing entry preserved
    assert.ok(parsed.donorAgency, "existing donorAgency entry must be preserved");
    assert.equal(parsed.donorAgency.quote, "World Bank");
    // New reference entry added
    assert.ok(parsed.procurementReferenceNumber, "new procurementReferenceNumber entry must be added");
    assert.equal(parsed.procurementReferenceNumber.fileId, "file-1");
  });

  it("does NOT set evidence columns when value is not found in any active file", () => {
    const result = enrichMetadataWithSourceEvidence(
      { clientName: "Nonexistent Entity Name XYZ123" },
      files,
    );
    assert.equal(result.clientNameSourceFileId, undefined, "clientNameSourceFileId must NOT be set when value not found");
    assert.equal(result.clientNameSourcePage, undefined);
    assert.equal(result.clientNameSourceQuote, undefined);
  });

  it("does NOT search in DELETED files", () => {
    // "Ministry of Health" appears in file-deleted but not in any active file
    // (file-1 has it, but let's use a value only in file-deleted)
    const result = enrichMetadataWithSourceEvidence(
      { clientName: "UniqueDeletedContent" },
      [{ id: "file-deleted", extractedText: "UniqueDeletedContent", deletionStatus: "DELETED" }],
    );
    assert.equal(result.clientNameSourceFileId, undefined, "must NOT attribute to a deleted file");
  });

  it("returns empty object when no fields are provided", () => {
    const result = enrichMetadataWithSourceEvidence({}, files);
    assert.deepEqual(Object.keys(result), []);
  });

  it("returns empty object when all values are null/empty", () => {
    const result = enrichMetadataWithSourceEvidence(
      { title: null, reference: null, clientName: null, deadline: null },
      files,
    );
    assert.deepEqual(Object.keys(result), []);
  });

  it("skips values shorter than MIN_VALUE_LENGTH", () => {
    const result = enrichMetadataWithSourceEvidence(
      { clientName: "ab" },
      files,
    );
    assert.equal(result.clientNameSourceFileId, undefined, "short values must be skipped");
  });

  it("computes page number from 'Page N' markers", () => {
    // "Medical Equipment Supply" is on page 2 in file-1
    const result = enrichMetadataWithSourceEvidence(
      { title: "Medical Equipment Supply" },
      files,
    );
    assert.equal(result.titleSourcePage, 2, "page must be 2 — after the 'Page 2' marker");
  });

  it("sorts active files by id for deterministic attribution", () => {
    // Reverse the file order — the result should still attribute to file-1
    // because active files are sorted by id before searching.
    const reversed = [...files].reverse();
    const result = enrichMetadataWithSourceEvidence(
      { clientName: "Ministry of Health" },
      reversed,
    );
    assert.equal(result.clientNameSourceFileId, "file-1");
  });
});

// ─── 2. Source-inspection: re-extract-metadata wiring ────────────────────────

describe("re-extract-metadata route — enrichment wired in", () => {
  const src = read("app/api/tenders/[id]/re-extract-metadata/route.ts");

  it("imports enrichMetadataWithSourceEvidence", () => {
    assert.ok(
      src.includes('import { enrichMetadataWithSourceEvidence } from "../../../../../lib/engine/metadata-source-enrichment";'),
      "must import enrichMetadataWithSourceEvidence",
    );
  });

  it("calls enrichMetadataWithSourceEvidence before prisma.tender.update", () => {
    const enrichIdx = src.indexOf("enrichMetadataWithSourceEvidence({");
    const updateIdx = src.indexOf("await prisma.tender.update({ where: { id }, data: update });");
    assert.ok(enrichIdx > -1, "must call enrichMetadataWithSourceEvidence");
    assert.ok(updateIdx > -1, "must call prisma.tender.update");
    assert.ok(
      enrichIdx < updateIdx,
      "enrichment must happen BEFORE prisma.tender.update",
    );
  });

  it("passes all critical fields to the enrichment", () => {
    for (const field of ["title", "reference", "clientName", "deadline", "submissionMethod", "submissionAddress", "submissionEmails"]) {
      assert.ok(
        src.includes(`${field}: update.${field}`),
        `must pass ${field} from update to enrichment`,
      );
    }
  });

  it("Object.assigns enrichment into update map", () => {
    assert.ok(
      src.includes("Object.assign(update, enrichment)"),
      "must Object.assign enrichment into update map so evidence columns are persisted",
    );
  });
});

// ─── 3. Source-inspection: tender-upload-first wiring ────────────────────────

describe("tender-upload-first — enrichment wired in", () => {
  const src = read("lib/tender-upload-first.ts");

  it("imports enrichMetadataWithSourceEvidence", () => {
    assert.ok(
      src.includes('import { enrichMetadataWithSourceEvidence } from "./engine/metadata-source-enrichment";'),
      "must import enrichMetadataWithSourceEvidence",
    );
  });

  it("calls enrichMetadataWithSourceEvidence after the transaction commits", () => {
    const txEndIdx = src.indexOf("}, { timeout: 30_000 });");
    const enrichIdx = src.indexOf("enrichMetadataWithSourceEvidence({");
    assert.ok(txEndIdx > -1, "must have transaction end");
    assert.ok(enrichIdx > -1, "must call enrichMetadataWithSourceEvidence");
    assert.ok(
      enrichIdx > txEndIdx,
      "enrichment must happen AFTER the transaction commits (so file IDs are available)",
    );
  });

  it("uses persisted.fileRecords for file IDs", () => {
    assert.ok(
      src.includes("persisted.fileRecords.map"),
      "must use persisted.fileRecords to map file IDs for enrichment",
    );
  });

  it("only updates when enrichment found at least one field", () => {
    assert.ok(
      src.includes('if (Object.keys(enrichment).length > 0)'),
      "must guard the update with Object.keys(enrichment).length > 0",
    );
  });
});

// ─── 4. Source-inspection: ai-analyze reference fileId resolution ────────────

describe("ai-analyze route — reference fileId resolution wired in", () => {
  const src = read("app/api/tenders/[id]/ai-analyze/route.ts");

  it("imports attributeMetadataSourceFileId", () => {
    assert.ok(
      src.includes("attributeMetadataSourceFileId"),
      "must reference attributeMetadataSourceFileId",
    );
  });

  it("defines resolveReferenceFileId helper", () => {
    assert.ok(
      src.includes("async function resolveReferenceFileId("),
      "must define resolveReferenceFileId helper",
    );
  });

  it("resolveReferenceFileId reads contactDetailsSourceJson and resolves fileId for procurementReferenceNumber", () => {
    assert.ok(
      src.includes('contactDetails["procurementReferenceNumber"]'),
      "resolveReferenceFileId must read the procurementReferenceNumber entry",
    );
    assert.ok(
      src.includes("attributeMetadataSourceFileId(refEntry.quote, files)"),
      "resolveReferenceFileId must call attributeMetadataSourceFileId on the quote",
    );
  });

  it("resolveReferenceFileId skips when fileId is already set and active", () => {
    assert.ok(
      src.includes("if (refEntry.fileId)"),
      "must check if fileId is already set",
    );
    assert.ok(
      src.includes("stillActive"),
      "must check if the existing fileId is still active",
    );
  });

  it("calls resolveReferenceFileId after BOTH streaming and non-streaming transactions", () => {
    const count = (src.match(/await resolveReferenceFileId\(id, tenderRecord\.files\)/g) || []).length;
    assert.ok(
      count >= 2,
      `must call resolveReferenceFileId in at least 2 places (streaming + non-streaming), found ${count}`,
    );
  });

  it("persists the resolved fileId via prisma.tender.update on contactDetailsSourceJson", () => {
    assert.ok(
      src.includes('data: { contactDetailsSourceJson: refJson }'),
      "must persist the resolved fileId via prisma.tender.update on contactDetailsSourceJson",
    );
  });

  it("wraps resolveReferenceFileId in try/catch (non-fatal)", () => {
    assert.ok(
      src.includes("reference fileId resolution failed (non-critical)"),
      "must wrap resolveReferenceFileId in try/catch so a failure doesn't break the analysis",
    );
  });
});

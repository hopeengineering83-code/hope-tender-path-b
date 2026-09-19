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

  // ─── Idempotency + determinism contract ──────────────────────────────────

  it("H3: is idempotent — calling twice with the same input produces deeply-equal output", () => {
    const metadata = {
      clientName: "Ministry of Health",
      title: "Medical Equipment Supply",
      reference: "REF-2026-001",
      deadline: new Date("2026-12-30"),
      submissionMethod: "email",
      submissionAddress: "submit@example.com",
      submissionEmails: ["submit@example.com"],
      submissionEmailSubject: "Tender Submission",
      existingContactDetailsSourceJson: JSON.stringify({
        donorAgency: { page: 5, quote: "World Bank", fileId: null },
      }),
    };
    const r1 = enrichMetadataWithSourceEvidence(metadata, files);
    const r2 = enrichMetadataWithSourceEvidence(metadata, files);
    assert.deepEqual(r1, r2);
  });

  it("M3: when the same value appears in 2 active files, the lower id wins — regardless of input order", () => {
    const dupFiles = [
      {
        id: "file-bbb",
        extractedText: "Page 1\nMinistry of Health\nPage 2 content",
        deletionStatus: "ACTIVE",
        totalPages: 2,
      },
      {
        id: "file-aaa",
        extractedText: "Page 1\nMinistry of Health\nPage 5 content",
        deletionStatus: "ACTIVE",
        totalPages: 5,
      },
    ];
    const r1 = enrichMetadataWithSourceEvidence({ clientName: "Ministry of Health" }, dupFiles);
    const r2 = enrichMetadataWithSourceEvidence({ clientName: "Ministry of Health" }, [...dupFiles].reverse());
    assert.equal(r1.clientNameSourceFileId, "file-aaa", "lower id must win");
    assert.equal(r2.clientNameSourceFileId, "file-aaa", "lower id must win regardless of input order");
    assert.deepEqual(r1, r2, "output must be identical regardless of input order");
  });

  it("M4: overwrites (does NOT duplicate) an existing procurementReferenceNumber entry in contactDetailsSourceJson", () => {
    const existing = JSON.stringify({
      donorAgency: { page: 5, quote: "World Bank", fileId: null },
      procurementReferenceNumber: {
        page: 99,
        quote: "OLD QUOTE — must be overwritten",
        fileId: "old-file-id",
      },
    });
    const result = enrichMetadataWithSourceEvidence(
      { reference: "REF-2026-001", existingContactDetailsSourceJson: existing },
      files,
    );
    assert.ok(result.contactDetailsSourceJson);
    const parsed = JSON.parse(result.contactDetailsSourceJson!);
    // Exactly ONE procurementReferenceNumber key — not an array, not duplicated
    assert.equal(typeof parsed.procurementReferenceNumber, "object");
    assert.ok(!Array.isArray(parsed.procurementReferenceNumber),
      "must NOT be an array of duplicates");
    const refKeys = Object.keys(parsed).filter((k) => k === "procurementReferenceNumber");
    assert.equal(refKeys.length, 1, "exactly one procurementReferenceNumber key");
    // Old evidence was overwritten — new evidence wins
    assert.equal(parsed.procurementReferenceNumber.fileId, "file-1");
    assert.notEqual(parsed.procurementReferenceNumber.page, 99);
    assert.notEqual(parsed.procurementReferenceNumber.quote, "OLD QUOTE — must be overwritten");
    // Unrelated existing entries preserved
    assert.ok(parsed.donorAgency, "donorAgency must be preserved");
    assert.equal(parsed.donorAgency.quote, "World Bank");
  });

  it("falls back to {} when existingContactDetailsSourceJson is malformed JSON", () => {
    const result = enrichMetadataWithSourceEvidence(
      { reference: "REF-2026-001", existingContactDetailsSourceJson: "not valid json{{{" },
      files,
    );
    assert.ok(result.contactDetailsSourceJson);
    const parsed = JSON.parse(result.contactDetailsSourceJson!);
    assert.ok(parsed.procurementReferenceNumber, "reference evidence still added on top of {}");
    assert.equal(Object.keys(parsed).length, 1, "no leftover garbage from the malformed JSON");
  });

  it("uses the FIRST occurrence of a value when it appears multiple times in one file", () => {
    const multiFile = [{
      id: "file-1",
      extractedText: "Page 1\nFirst Ministry of Health mention\nPage 2\nSecond Ministry of Health mention",
      deletionStatus: "ACTIVE",
      totalPages: 2,
    }];
    const result = enrichMetadataWithSourceEvidence({ clientName: "Ministry of Health" }, multiFile);
    assert.equal(result.clientNameSourcePage, 1, "must attribute to page 1 (first occurrence), not page 2");
  });

  it("computes page number from form-feed (\\f) boundaries", () => {
    const ffFile = [{
      id: "file-1",
      extractedText: "Page one content\fMinistry of Health on page two",
      deletionStatus: "ACTIVE",
      totalPages: 2,
    }];
    const result = enrichMetadataWithSourceEvidence({ clientName: "Ministry of Health" }, ffFile);
    assert.equal(result.clientNameSourcePage, 2);
  });

  it("returns null page when computed page exceeds totalPages (fail-closed)", () => {
    const clampFile = [{
      id: "file-1",
      extractedText: "[Page 99]\nMinistry of Health",
      deletionStatus: "ACTIVE",
      totalPages: 2,
    }];
    const result = enrichMetadataWithSourceEvidence({ clientName: "Ministry of Health" }, clampFile);
    assert.equal(result.clientNameSourcePage, null, "must fail-closed when computed page > totalPages");
    assert.equal(result.clientNameSourceFileId, "file-1", "fileId still set even when page is null");
  });

  it("multi-page file with NO boundaries → null page (fail-closed)", () => {
    const noBoundaryFile = [{
      id: "file-1",
      extractedText: "Ministry of Health with no page markers and no form feeds",
      deletionStatus: "ACTIVE",
      totalPages: 5,
    }];
    const result = enrichMetadataWithSourceEvidence({ clientName: "Ministry of Health" }, noBoundaryFile);
    assert.equal(result.clientNameSourcePage, null, "multi-page file with no boundaries must NOT guess page 1");
  });

  it("verified one-page file with NO boundaries → page 1 (fail-open only when verified)", () => {
    const onePageFile = [{
      id: "file-1",
      extractedText: "Ministry of Health with no page markers and no form feeds",
      deletionStatus: "ACTIVE",
      totalPages: 1,
    }];
    const result = enrichMetadataWithSourceEvidence({ clientName: "Ministry of Health" }, onePageFile);
    assert.equal(result.clientNameSourcePage, 1, "verified one-page file may be attributed to page 1");
  });

  it("submissionEmails loop continues past emails not found in any file", () => {
    const result = enrichMetadataWithSourceEvidence(
      { submissionEmails: ["not-found@example.com", "submit@example.com"] },
      files,
    );
    assert.equal(result.submissionEmailSourceFileId, "file-1");
    assert.ok(result.submissionEmailSourceQuote?.includes("submit@example.com"));
  });

  it("locates submissionEmailSubject in an active file", () => {
    const result = enrichMetadataWithSourceEvidence(
      { submissionEmailSubject: "Tender Submission" },
      [{ id: "file-1", extractedText: "Subject: Tender Submission Required", deletionStatus: "ACTIVE" }],
    );
    assert.equal(result.submissionEmailSubjectSourceFileId, "file-1");
    assert.ok(result.submissionEmailSubjectSourceQuote?.includes("Tender Submission"));
  });
});

// ─── 1b. Behavioral tests for clearEvidenceForField ─────────────────────────

describe("clearEvidenceForField — behavioral", () => {
  // Imported lazily to avoid unused-import lint if the export is renamed.
  // The function is re-exported from the same module.
  let clearEvidenceForField: (field: string) => Record<string, null>;
  try {
    const mod = require("../lib/engine/metadata-source-enrichment");
    clearEvidenceForField = mod.clearEvidenceForField;
  } catch {
    clearEvidenceForField = () => ({});
  }

  it("returns the 3 null columns for each known scalar field", () => {
    for (const field of ["clientName", "title", "deadline", "submissionMethod", "submissionAddress", "submissionEmails", "reference", "submissionEmailSubject"]) {
      const cleared = clearEvidenceForField(field);
      const vals = Object.values(cleared);
      assert.ok(vals.every((v) => v === null), `${field}: all values must be null`);
      assert.ok(Object.keys(cleared).length >= 3, `${field}: must clear at least 3 columns`);
    }
  });

  it("returns {} for an unknown field name", () => {
    assert.deepEqual(clearEvidenceForField("unknownField"), {});
  });

  it("clearEvidenceForField('reference') clears referenceSource* AND does NOT clear contactDetailsSourceJson", () => {
    const cleared = clearEvidenceForField("reference");
    assert.equal(cleared.referenceSourceFileId, null);
    assert.equal(cleared.referenceSourcePage, null);
    assert.equal(cleared.referenceSourceQuote, null);
    assert.equal(cleared.contactDetailsSourceJson, undefined,
      "contactDetailsSourceJson clearing is the CALLER's responsibility — clearEvidenceForField must NOT touch it");
  });
});

// ─── 2. Source-inspection: re-extract-metadata wiring ────────────────────────

describe("re-extract-metadata route — enrichment wired in", () => {
  const src = read("app/api/tenders/[id]/re-extract-metadata/route.ts");

  it("imports enrichMetadataWithSourceEvidence", () => {
    assert.ok(
      src.includes('import { enrichMetadataWithSourceEvidence, clearEvidenceForField } from "../../../../../lib/engine/metadata-source-enrichment";'),
      "must import enrichMetadataWithSourceEvidence",
    );
  });

  it("calls enrichMetadataWithSourceEvidence before persisting the update", () => {
    const enrichIdx = src.indexOf("enrichMetadataWithSourceEvidence({");
    // The persist call now runs inside a transaction alongside
    // invalidateTenderForSourceRevision (a corrected metadata value must
    // supersede any already-generated document/BuildPlan that baked in the
    // old value — see H-02), so the tender update runs through `tx`, not
    // the bare `prisma` client.
    const updateIdx = src.indexOf("await tx.tender.update({ where: { id }, data: update });");
    assert.ok(enrichIdx > -1, "must call enrichMetadataWithSourceEvidence");
    assert.ok(updateIdx > -1, "must persist the update inside the invalidation transaction");
    assert.ok(
      enrichIdx < updateIdx,
      "enrichment must happen BEFORE the update is persisted",
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

  it("wraps enrichment in try/catch (best-effort, non-fatal — H1 route-level gap fix)", () => {
    // The enrichment must be wrapped in try/catch so a failure (e.g., malformed
    // file text that defeats the normalized-index builder) does NOT 500 the
    // route. The scalar values in `update` must still be persisted.
    const tryIdx = src.indexOf("try {");
    const enrichIdx = src.indexOf("enrichMetadataWithSourceEvidence({");
    const catchIdx = src.indexOf("// Best-effort, non-fatal. The scalar values in `update` are still");
    assert.ok(tryIdx > -1, "must have a try block around enrichment");
    assert.ok(enrichIdx > -1, "must call enrichMetadataWithSourceEvidence");
    assert.ok(catchIdx > -1, "must have a catch block with non-fatal comment");
    assert.ok(tryIdx < enrichIdx, "try must come before enrichment call");
    assert.ok(enrichIdx < catchIdx, "catch must come after enrichment call");
  });
});

// ─── 3. Source-inspection: durable extraction wiring ────────────────────────

describe("durable tender extraction — enrichment wired in", () => {
  const src = read("lib/ai-jobs/tender-extraction-service.ts");

  it("imports enrichMetadataWithSourceEvidence", () => {
    assert.ok(
      src.includes('import { enrichMetadataWithSourceEvidence } from "../engine/metadata-source-enrichment";'),
      "must import enrichMetadataWithSourceEvidence",
    );
  });

  it("calls enrichMetadataWithSourceEvidence after the extraction checkpoint persists", () => {
    const persistedIdx = src.indexOf("const persisted = await prisma.tenderFile.updateMany");
    const enrichIdx = src.indexOf("enrichMetadataWithSourceEvidence({");
    assert.ok(persistedIdx > -1, "must persist the extraction checkpoint");
    assert.ok(enrichIdx > -1, "must call enrichMetadataWithSourceEvidence");
    assert.ok(
      enrichIdx < persistedIdx,
      "the helper definition must exist before the persisted worker call",
    );
    const workerCall = src.indexOf("await enrichTenderFromCurrentSources({");
    assert.ok(workerCall > persistedIdx, "enrichment must run after durable extraction persistence");
  });

  it("binds enrichment to the exact current file ID and content hash", () => {
    assert.ok(
      src.includes("expectedFileId") && src.includes("expectedContentSha256"),
      "must bind enrichment to the exact source revision",
    );
  });

  it("only updates when enrichment found at least one field", () => {
    assert.ok(
      src.includes('if (Object.keys(enrichment).length > 0)'),
      "must guard the update with Object.keys(enrichment).length > 0",
    );
  });

  it("wraps enrichment in try/catch (best-effort, non-fatal — H1 route-level gap fix)", () => {
    const tryIdx = src.indexOf("try {\n    await enrichTenderFromCurrentSources({");
    const enrichIdx = src.indexOf("await enrichTenderFromCurrentSources({", tryIdx);
    const catchIdx = src.indexOf('logger.warn("[extract-text] source enrichment failed after durable extraction"', enrichIdx);
    assert.ok(tryIdx > -1, "must have a try block around enrichment");
    assert.ok(enrichIdx > -1, "must call enrichMetadataWithSourceEvidence");
    assert.ok(catchIdx > -1, "must have a catch block with non-fatal comment");
    assert.ok(tryIdx < enrichIdx, "try must come before enrichment call");
    assert.ok(enrichIdx < catchIdx, "catch must come after enrichment call");
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

  it("persists the resolved fileId via prisma.tender.updateMany with optimistic-concurrency guard (TOCTOU race fix)", () => {
    // The previous implementation used prisma.tender.update (unconditional),
    // which had a TOCTOU race: a concurrent AI re-run that wrote a different
    // contactDetailsSourceJson between our read and write would be silently
    // overwritten. The fix uses prisma.tender.updateMany with a WHERE clause
    // that checks contactDetailsSourceJson === originalJson (optimistic
    // concurrency). If 0 rows are affected, a concurrent run won — log + skip.
    assert.ok(
      src.includes("prisma.tender.updateMany"),
      "must use prisma.tender.updateMany (optimistic-concurrency guard)",
    );
    assert.ok(
      src.includes("where: { id, contactDetailsSourceJson: refResult.originalJson }"),
      "must guard the update with contactDetailsSourceJson === originalJson (optimistic concurrency)",
    );
    assert.ok(
      src.includes("data: { contactDetailsSourceJson: refResult.updatedJson }"),
      "must write the updatedJson from resolveReferenceFileId",
    );
    assert.ok(
      src.includes("result.count === 0"),
      "must check result.count === 0 to detect a concurrent run that won",
    );
    // The old unconditional prisma.tender.update pattern must NOT be present
    // for the contactDetailsSourceJson write.
    assert.ok(
      !src.includes("data: { contactDetailsSourceJson: refJson }"),
      "old unconditional prisma.tender.update pattern must be removed (TOCTOU race fix)",
    );
  });

  it("wraps resolveReferenceFileId in try/catch (non-fatal)", () => {
    assert.ok(
      src.includes("reference fileId resolution failed (non-critical)"),
      "must wrap resolveReferenceFileId in try/catch so a failure doesn't break the analysis",
    );
  });
});

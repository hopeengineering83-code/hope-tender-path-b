/**
 * Regression tests for the deep-fix commit:
 *
 * 1. metadata-truth.ts now reads fileId from contactDetailsSource and
 *    enforces active-file grounding. Reference can now be GROUNDED in the
 *    Metadata Truth panel (previously it had NO evidence and could only be
 *    EXTRACTED_UNVERIFIED). Title and deadline also now have evidence
 *    (previously the resolver's SELECT didn't read their dedicated source
 *    columns even though they existed in the schema).
 *
 * 2. The generate route now passes activeTenderFileIds + all source-evidence
 *    columns to resolveCanonicalFieldState. Previously it omitted
 *    activeTenderFileIds (so grounding fell back to page+quote only) AND
 *    omitted title/deadline/fileId columns (so those fields could never be
 *    GROUNDED in the generate route even when the DB had the evidence).
 *
 * 3. lib/ai.ts merge logic now preserves fileId when "best wins" overwrites
 *    an entry. Previously a re-run of AI Analyze could overwrite a
 *    repair-written { page, quote, fileId } entry with { page, quote } (no
 *    fileId), silently ungrounding the reference field.
 *
 * 4. Type definitions across the codebase now include fileId in the
 *    contactDetailsSource shape.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. metadata-truth.ts source-inspection ──────────────────────────────────

describe("metadata-truth.ts — fileId + title/deadline evidence plumbed through", () => {
  const src = read("lib/engine/analysis/metadata-truth.ts");

  it("FieldEvidence type includes fileId", () => {
    assert.ok(
      src.includes("type FieldEvidence = { page: number | null; quote: string | null; fileId: string | null };"),
      "FieldEvidence must include fileId: string | null",
    );
  });

  it("parseContactEvidence reads fileId from each entry", () => {
    assert.ok(
      src.includes("fileId: typeof v.fileId === \"string\" && v.fileId.length > 0 ? v.fileId : null,"),
      "parseContactEvidence must read fileId from each entry",
    );
  });

  it("imports isGroundedEvidenceWithFileCheck from evidence-grounding", () => {
    assert.ok(
      src.includes("isGroundedEvidenceWithFileCheck"),
      "metadata-truth must import isGroundedEvidenceWithFileCheck",
    );
  });

  it("hasGroundingEvidence uses file-check when activeTenderFileIds is provided", () => {
    assert.ok(
      src.includes("isGroundedEvidenceWithFileCheck(ev.page, ev.quote, ev.fileId, activeTenderFileIds)"),
      "hasGroundingEvidence must call isGroundedEvidenceWithFileCheck when activeTenderFileIds is provided",
    );
  });

  it("SELECT includes titleSource*, deadlineSource*, submissionEmailSourceQuote, and all *SourceFileId columns", () => {
    // The SELECT must include the source columns that previously were missing.
    for (const col of [
      "titleSourcePage",
      "titleSourceQuote",
      "titleSourceFileId",
      "deadlineSourcePage",
      "deadlineSourceQuote",
      "deadlineSourceFileId",
      "clientNameSourceFileId",
      "submissionMethodSourceFileId",
      "submissionAddressSourceFileId",
      "submissionEmailSourceQuote",
      "submissionEmailSourceFileId",
    ]) {
      assert.ok(src.includes(`${col}: true`), `SELECT must include ${col}: true`);
    }
  });

  it("SELECT includes active files for activeTenderFileIds enforcement", () => {
    assert.ok(
      src.includes('files: { where: { deletionStatus: "ACTIVE" }, select: { id: true } }'),
      "SELECT must include active files so activeTenderFileIds can be built",
    );
  });

  it("evidenceByField includes title, deadline, and reference (from contactDetails)", () => {
    // The evidenceByField map must now have entries for title, deadline, and
    // reference — previously they were omitted and could never be GROUNDED.
    assert.ok(
      src.includes("title: { page: tender.titleSourcePage"),
      "evidenceByField must include title with dedicated source columns",
    );
    assert.ok(
      src.includes("deadline: { page: tender.deadlineSourcePage"),
      "evidenceByField must include deadline with dedicated source columns",
    );
    assert.ok(
      src.includes("reference: refEvidence"),
      "evidenceByField must include reference from contactDetails (procurementReferenceNumber)",
    );
  });

  it("evidenceByField includes fileId for every field with a dedicated *SourceFileId column", () => {
    // Every evidence entry for fields with dedicated columns must thread fileId.
    // The column-name convention is {field}SourceFileId (camelCase), but the
    // submissionEmails column is submissionEmailSourceFileId (singular Email),
    // so we list the exact column names here.
    const fieldToColumn: Record<string, { page: string; quote: string; fileId: string }> = {
      clientName:          { page: "clientNameSourcePage",          quote: "clientNameSourceQuote",          fileId: "clientNameSourceFileId" },
      title:               { page: "titleSourcePage",               quote: "titleSourceQuote",               fileId: "titleSourceFileId" },
      deadline:            { page: "deadlineSourcePage",            quote: "deadlineSourceQuote",            fileId: "deadlineSourceFileId" },
      submissionMethod:    { page: "submissionMethodSourcePage",    quote: "submissionMethodSourceQuote",    fileId: "submissionMethodSourceFileId" },
      submissionAddress:   { page: "submissionAddressSourcePage",   quote: "submissionAddressSourceQuote",   fileId: "submissionAddressSourceFileId" },
      submissionEmails:    { page: "submissionEmailSourcePage",     quote: "submissionEmailSourceQuote",     fileId: "submissionEmailSourceFileId" },
    };
    for (const [field, cols] of Object.entries(fieldToColumn)) {
      assert.ok(
        src.includes(`fileId: tender.${cols.fileId} ?? null`),
        `evidenceByField must include fileId: tender.${cols.fileId} ?? null for ${field}`,
      );
    }
  });

  it("activeTenderFileIds is built from tender.files and passed to hasGroundingEvidence", () => {
    assert.ok(
      src.includes("const activeTenderFileIds = new Set((tender.files ?? []).map((f) => f.id));"),
      "activeTenderFileIds must be built from tender.files",
    );
    assert.ok(
      src.includes("hasGroundingEvidence(evidenceByField[key], activeTenderFileIds)"),
      "hasGroundingEvidence must be called with activeTenderFileIds",
    );
  });
});

// ─── 2. generate route source-inspection ─────────────────────────────────────

describe("generate route — passes activeTenderFileIds + all source-evidence columns", () => {
  const src = read("app/api/tenders/[id]/generate/route.ts");

  it("passes activeTenderFileIds to resolveCanonicalFieldState", () => {
    assert.ok(
      src.includes("activeTenderFileIds: new Set((tender.files ?? []).map((f: any) => f.id))"),
      "generate route must pass activeTenderFileIds to resolveCanonicalFieldState",
    );
  });

  it("forwards title source-evidence columns", () => {
    for (const col of ["titleSourcePage", "titleSourceQuote", "titleSourceFileId"]) {
      assert.ok(
        src.includes(`${col}: (tender as any).${col} ?? null`),
        `generate route must forward ${col} to resolveCanonicalFieldState`,
      );
    }
  });

  it("forwards deadline source-evidence columns", () => {
    for (const col of ["deadlineSourcePage", "deadlineSourceQuote", "deadlineSourceFileId"]) {
      assert.ok(
        src.includes(`${col}: (tender as any).${col} ?? null`),
        `generate route must forward ${col} to resolveCanonicalFieldState`,
      );
    }
  });

  it("forwards clientName / submissionMethod / submissionAddress / submissionEmail fileId columns", () => {
    for (const col of [
      "clientNameSourceFileId",
      "submissionMethodSourceFileId",
      "submissionAddressSourceFileId",
      "submissionEmailSourceFileId",
      "submissionEmailSourceQuote",
    ]) {
      assert.ok(
        src.includes(`${col}: (tender as any).${col} ?? null`),
        `generate route must forward ${col} to resolveCanonicalFieldState`,
      );
    }
  });
});

// ─── 3. lib/ai.ts merge logic preserves fileId ───────────────────────────────

describe("lib/ai.ts — contactDetailsSource merge preserves fileId", () => {
  const src = read("lib/ai.ts");

  it("contactDetailsSource type includes fileId", () => {
    assert.ok(
      src.includes("contactDetailsSource?: Record<string, { page: number | null; quote: string | null; fileId?: string | null }> | null;"),
      "contactDetailsSource type must include fileId?: string | null",
    );
  });

  it("merge logic preserves fileId when overwriting an entry", () => {
    // The merge must NOT drop a fileId that the repair-metadata route persisted.
    // The "best wins" assignment must construct a new object that includes
    // fileId: val.fileId ?? existing?.fileId ?? null.
    assert.ok(
      src.includes("fileId: val.fileId ?? existing?.fileId ?? null"),
      "merge logic must preserve fileId: val.fileId ?? existing?.fileId ?? null",
    );
  });

  it("merge result type includes fileId", () => {
    assert.ok(
      src.includes("const contactDetailsSource: Record<string, { page: number | null; quote: string | null; fileId?: string | null }> = {};"),
      "merge result type must include fileId",
    );
  });
});

// ─── 4. Type definitions across the codebase ─────────────────────────────────

describe("contactDetailsSource type widened across the codebase", () => {
  it("lib/engine/tender-metadata.ts contactDetailsSource type includes fileId", () => {
    const src = read("lib/engine/tender-metadata.ts");
    assert.ok(
      src.includes("contactDetailsSource: Record<string, { page: number | null; quote: string | null; fileId?: string | null }> | null;"),
      "tender-metadata.ts contactDetailsSource type must include fileId",
    );
  });

  it("lib/engine/tender-metadata.ts sourceMap return type includes fileId", () => {
    const src = read("lib/engine/tender-metadata.ts");
    assert.ok(
      src.includes("function sourceMap(entries: Array<[string, GroundedString]>): Record<string, { page: number | null; quote: string | null; fileId?: string | null }> | null {"),
      "sourceMap return type must include fileId",
    );
  });

  it("prisma/schema.prisma comment mentions fileId in the contactDetailsSourceJson shape", () => {
    const src = read("prisma/schema.prisma");
    assert.ok(
      src.includes("fileId?: string|null") && src.includes("procurementReferenceNumber (for the reference field)"),
      "schema comment must mention fileId and procurementReferenceNumber",
    );
  });
});

// ─── 5. Behavioral: merge preserves fileId in both directions ────────────────
//
// We can't easily import the merge function (it's not exported), but we CAN
// test the contract via source inspection above + a unit test that mirrors
// the merge logic. The real merge function lives in lib/ai.ts and is exercised
// end-to-end by the AI Analyze integration tests.

describe("contactDetailsSource merge — fileId preservation (mirrored unit)", () => {
  // Mirror of the merge logic in lib/ai.ts — kept in sync so we can test the
  // contract without exporting the private function.
  type Entry = { page: number | null; quote: string | null; fileId?: string | null };
  function mergeContactDetailsSource(parts: Array<Record<string, Entry> | null | undefined>): Record<string, Entry> {
    const merged: Record<string, Entry> = {};
    for (const part of parts) {
      if (!part) continue;
      for (const [key, val] of Object.entries(part)) {
        const existing = merged[key];
        const existingHasData = existing && (existing.page !== null || existing.quote !== null);
        const newHasData = val.page !== null || val.quote !== null;
        if (!existing || (!existingHasData && newHasData)) {
          merged[key] = {
            page: val.page,
            quote: val.quote,
            fileId: val.fileId ?? existing?.fileId ?? null,
          };
        }
      }
    }
    return merged;
  }

  it("preserves fileId from repair when AI re-run provides page+quote but no fileId", () => {
    // Scenario: repair-metadata wrote { page: 1, quote: "...", fileId: "f1" }
    // for procurementReferenceNumber. Then AI Analyze re-runs and emits
    // { page: 1, quote: "..." } (no fileId — AI never emits fileId).
    // The merge must PRESERVE fileId: "f1" so reference stays GROUNDED.
    const repairWritten: Record<string, Entry> = {
      procurementReferenceNumber: { page: 1, quote: "REF-2026-001", fileId: "f1" },
    };
    const aiReRun: Record<string, Entry> = {
      procurementReferenceNumber: { page: 1, quote: "REF-2026-001" }, // no fileId
    };
    // AI re-run is "best wins" only if the existing entry has no data — but
    // the existing entry HAS data (page=1, quote non-null), so AI's entry
    // does NOT overwrite. The repaired fileId survives.
    const merged = mergeContactDetailsSource([repairWritten, aiReRun]);
    assert.equal(merged.procurementReferenceNumber.fileId, "f1",
      "repair-written fileId must survive an AI re-run that doesn't emit fileId");
  });

  it("preserves fileId when later chunk overwrites an entry that had no data", () => {
    // Scenario: chunk 0 has { page: null, quote: null } (no fileId) for a key.
    // Chunk 3 has { page: 40, quote: "World Bank", fileId: "f3" }.
    // The merge overwrites (existing has no data, new has data) and must
    // preserve the new chunk's fileId.
    const chunk0: Record<string, Entry> = {
      donorAgency: { page: null, quote: null },
    };
    const chunk3: Record<string, Entry> = {
      donorAgency: { page: 40, quote: "World Bank", fileId: "f3" },
    };
    const merged = mergeContactDetailsSource([chunk0, chunk3]);
    assert.equal(merged.donorAgency.fileId, "f3",
      "later chunk's fileId must be preserved when overwriting a null entry");
  });

  it("preserves existing fileId when later chunk overwrites with data but no fileId", () => {
    // Scenario: chunk 0 has { page: null, quote: null, fileId: "f1" } (rare —
    // fileId present but no page/quote; e.g. partial repair). Chunk 3 has
    // { page: 40, quote: "World Bank" } (no fileId — AI chunk).
    // existing has NO data (page=null, quote=null), so chunk 3 overwrites.
    // The merge must PRESERVE chunk 0's fileId: "f1" so the entry stays
    // grounded (page+quote from chunk 3, fileId from chunk 0).
    const chunk0: Record<string, Entry> = {
      donorAgency: { page: null, quote: null, fileId: "f1" },
    };
    const chunk3: Record<string, Entry> = {
      donorAgency: { page: 40, quote: "World Bank" },
    };
    const merged = mergeContactDetailsSource([chunk0, chunk3]);
    assert.equal(merged.donorAgency.fileId, "f1",
      "existing fileId must be preserved when a later chunk overwrites with data but no fileId");
    assert.equal(merged.donorAgency.page, 40);
    assert.equal(merged.donorAgency.quote, "World Bank");
  });

  it("does NOT invent a fileId when neither chunk has one", () => {
    const chunk0: Record<string, Entry> = {
      country: { page: 2, quote: "Ethiopia" },
    };
    const merged = mergeContactDetailsSource([chunk0]);
    assert.equal(merged.country.fileId, null,
      "fileId must be null (not undefined) when neither chunk has one — so the canonical resolver sees a consistent shape");
  });
});

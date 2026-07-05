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

// ─── 1. (removed) metadata-truth.ts source-inspection ────────────────────────
// The duplicate Metadata Truth resolver (lib/engine/analysis/metadata-truth.ts)
// was deleted: it had ZERO runtime callers — the Metadata Truth panel reads the
// workflow-center snapshot, which uses resolveCanonicalFieldState. Its fileId /
// title / deadline evidence behavior lives in the canonical resolver and is
// pinned by tests/canonical-field-grounding.test.ts and
// tests/metadata-contradiction-alignment.test.ts.

// ─── 2. generate route source-inspection ─────────────────────────────────────

describe("generate route — passes activeTenderFileIds + all source-evidence columns", () => {
  const src = read("app/api/tenders/[id]/generate/route.ts");

  it("passes activeTenderFileIds to resolveCanonicalFieldState", () => {
    assert.ok(
      src.includes("activeTenderFileIds: new Set((tender.files ?? []).filter((f: any) => (f.deletionStatus ?? \"ACTIVE\") === \"ACTIVE\").map((f: any) => f.id))"),
      "generate route must pass activeTenderFileIds filtered to ACTIVE files to resolveCanonicalFieldState",
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

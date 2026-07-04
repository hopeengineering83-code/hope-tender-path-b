/**
 * Regression tests for the two defects fixed in this commit:
 *
 * 1. Deadline source-grounding bypass: in the previous revision, source
 *    grounding (durable file ID resolution, active-file check, quote
 *    containment) was moved INSIDE the `else` branch of the type dispatch
 *    — so the `else if (field === 'deadline')` branch went straight to
 *    `(updates)[field] = dt` and bypassed every grounding check. This test
 *    file pins the contract that deadline MUST go through the same
 *    CRITICAL_SOURCE_GROUNDED_FIELDS block as every other critical field,
 *    BEFORE the type dispatch.
 *
 * 2. Reference evidence fileId: the canonical resolver's
 *    isGroundedEvidenceWithFileCheck requires a non-null fileId that points
 *    to an active TenderFile. Reference has no dedicated source-evidence
 *    columns (no referenceSourceFileId in the schema) — its evidence is
 *    persisted via contactDetailsSourceJson under "procurementReferenceNumber".
 *    Without fileId in that JSON entry, reference can NEVER be GROUNDED when
 *    activeTenderFileIds is enforced (which it is, in every production caller).
 *    This test pins the contract that:
 *      (a) the repair route writes fileId into contactDetailsSourceJson
 *      (b) parseContactDetailsSource reads fileId
 *      (c) getSourceEvidence returns ce.fileId (not null) for contact-sourced
 *          fields
 *      (d) a USER_CONFIRMED reference whose evidence fileId is in
 *          activeTenderFileIds achieves EXTRACTED_AND_GROUNDED
 *      (e) the same reference whose fileId is NOT in activeTenderFileIds
 *          is blocked
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. Route source-inspection: deadline goes through source grounding ───

describe("repair-metadata route — deadline source-grounding not bypassed", () => {
  const routeSrc = read("app/api/tenders/[id]/repair-metadata/route.ts");

  it("defines CRITICAL_SOURCE_GROUNDED_FIELDS containing deadline", () => {
    assert.ok(
      routeSrc.includes('const CRITICAL_SOURCE_GROUNDED_FIELDS = new Set(['),
      "must define CRITICAL_SOURCE_GROUNDED_FIELDS",
    );
    assert.ok(
      routeSrc.includes('"deadline"'),
      "deadline must be in CRITICAL_SOURCE_GROUNDED_FIELDS",
    );
    // All 7 critical fields must be present
    for (const f of ["clientName", "title", "deadline", "submissionMethod", "submissionAddress", "submissionEmails", "reference"]) {
      assert.ok(routeSrc.includes(`"${f}"`), `${f} must be in CRITICAL_SOURCE_GROUNDED_FIELDS`);
    }
  });

  it("runs CRITICAL_SOURCE_GROUNDED_FIELDS BEFORE the type dispatch (bidBondAmount/deadline/string)", () => {
    const groundingIdx = routeSrc.indexOf("CRITICAL_SOURCE_GROUNDED_FIELDS.has(field)");
    const typeDispatchIdx = routeSrc.indexOf('if (field === "bidBondAmount")');
    assert.ok(groundingIdx > -1, "must check CRITICAL_SOURCE_GROUNDED_FIELDS.has(field)");
    assert.ok(typeDispatchIdx > -1, "must have bidBondAmount type dispatch");
    assert.ok(
      groundingIdx < typeDispatchIdx,
      "CRITICAL_SOURCE_GROUNDED_FIELDS check MUST come before the bidBondAmount/deadline type dispatch — " +
      "otherwise the deadline branch bypasses durable-file resolution, active-file check, and quote containment.",
    );
  });

  it("the deadline branch does NOT re-resolve durableFileId (it was resolved above)", () => {
    // Isolate the `else if (field === "deadline" || field === "preBidMeetingDate")` branch
    // and assert it does NOT contain a `durableFileId =` assignment or a
    // verifySourceQuote call — those happen in the CRITICAL_SOURCE_GROUNDED_FIELDS
    // block above, and the deadline branch must NOT duplicate or bypass them.
    const deadlineBranchMatch = routeSrc.match(
      /else if \(field === "deadline" \|\| field === "preBidMeetingDate"\) \{[\s\S]*?\n    \} else \{/,
    );
    assert.ok(deadlineBranchMatch, "must have a deadline/preBidMeetingDate else-if branch");
    const branch = deadlineBranchMatch[0];
    assert.ok(
      !branch.includes("durableFileId ="),
      "deadline branch must NOT re-resolve durableFileId — that happens in CRITICAL_SOURCE_GROUNDED_FIELDS above",
    );
    assert.ok(
      !branch.includes("verifySourceQuote"),
      "deadline branch must NOT call verifySourceQuote — that happens in CRITICAL_SOURCE_GROUNDED_FIELDS above",
    );
    assert.ok(
      !branch.includes("activeFileIds.has"),
      "deadline branch must NOT check activeFileIds.has — that happens in CRITICAL_SOURCE_GROUNDED_FIELDS above",
    );
  });

  it("the `else` (string fields) branch does NOT duplicate source grounding", () => {
    // The else branch handles reference, clientName, submissionAddress, etc.
    // It must NOT contain a duplicate durableFileId resolution or
    // verifySourceQuote call — those happen in the CRITICAL_SOURCE_GROUNDED_FIELDS
    // block above. Duplicating them was the prior bug; removing them is the fix.
    const elseBranchMatch = routeSrc.match(
      /\n    \} else \{\n      const rawValue = extraction\.value as string;[\s\S]*?\n    \}\n    \/\/ ── PERSIST CANONICAL SOURCE EVIDENCE/,
    );
    assert.ok(elseBranchMatch, "must have an `else` (string fields) branch before PERSIST CANONICAL SOURCE EVIDENCE");
    const branch = elseBranchMatch[0];
    assert.ok(
      !branch.includes("durableFileId = extraction.sourceFile"),
      "else branch must NOT re-resolve durableFileId — that happens in CRITICAL_SOURCE_GROUNDED_FIELDS above",
    );
    assert.ok(
      !branch.includes("verifySourceQuote"),
      "else branch must NOT call verifySourceQuote — that happens in CRITICAL_SOURCE_GROUNDED_FIELDS above",
    );
  });

  it("persist reference evidence via contactDetailsSourceJson WITH fileId", () => {
    // The reference block must include fileId in the JSON entry, otherwise
    // the canonical resolver's getSourceEvidence returns fileId: null and
    // reference can never be GROUNDED.
    const refBlockMatch = routeSrc.match(
      /if \(field === "reference" && durableFileId\) \{[\s\S]*?contactDetails\["procurementReferenceNumber"\] = \{[\s\S]*?\};/,
    );
    assert.ok(refBlockMatch, "must have a reference evidence persistence block");
    const block = refBlockMatch[0];
    assert.ok(
      block.includes("fileId: durableFileId"),
      "reference evidence entry MUST include fileId: durableFileId — without it, isGroundedEvidenceWithFileCheck can never mark reference as GROUNDED",
    );
  });
});

// ─── 2. Canonical resolver source-inspection: fileId plumbed through ───────

describe("canonical-field-state — fileId plumbed through contactDetailsSource", () => {
  const canonSrc = read("lib/engine/canonical-field-state.ts");

  it("parseContactDetailsSource reads fileId from each entry", () => {
    assert.ok(
      canonSrc.includes("fileId: typeof e.fileId === \"string\" && e.fileId.length > 0 ? e.fileId : null"),
      "parseContactDetailsSource must read fileId from each entry (string and non-empty)",
    );
    // The output type must include fileId
    assert.ok(
      canonSrc.includes("Record<string, { page: number | null; quote: string | null; fileId: string | null }>"),
      "parseContactDetailsSource return type must include fileId: string | null",
    );
  });

  it("getSourceEvidence returns ce.fileId for contact-sourced fields (not always null)", () => {
    // The critical line — was `if (ce) return { page: ce.page, quote: ce.quote, fileId: null };`
    // Must now be `if (ce) return { page: ce.page, quote: ce.quote, fileId: ce.fileId };`
    assert.ok(
      canonSrc.includes("if (ce) return { page: ce.page, quote: ce.quote, fileId: ce.fileId };"),
      "getSourceEvidence must return ce.fileId for contact-sourced fields (not hardcoded null)",
    );
    // And the inverse — the old buggy line must NOT be present
    assert.ok(
      !canonSrc.includes("if (ce) return { page: ce.page, quote: ce.quote, fileId: null };"),
      "the old buggy line (fileId: null) must be removed from getSourceEvidence",
    );
  });
});

// ─── 3. Behavioral: reference achieves EXTRACTED_AND_GROUNDED with valid fileId ─

function makeTender(overrides: Partial<CanonicalResolverInput["tender"]> = {}): CanonicalResolverInput["tender"] {
  return {
    id: "t1",
    title: "Test Tender",
    reference: "REF-2026-001",
    clientName: "Pharo Ventures",
    procuringEntityName: null,
    deadline: new Date("2026-12-11"),
    currency: "USD",
    country: "Ethiopia",
    submissionMethod: "Email",
    submissionAddress: "test@example.com",
    submissionEmails: "test@example.com",
    submissionEmailSubject: null,
    clientContactName: null,
    clientContactEmail: null,
    metadataContaminated: false,
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Pharo Ventures is the procuring entity",
    clientNameSourceFileId: "file-active",
    submissionMethodSourcePage: 2,
    submissionMethodSourceQuote: "Submit by email",
    submissionMethodSourceFileId: "file-active",
    submissionAddressSourcePage: 2,
    submissionAddressSourceQuote: "Submit to this address",
    submissionAddressSourceFileId: "file-active",
    submissionEmailSourcePage: 2,
    submissionEmailSourceFileId: "file-active",
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

function findField(result: ReturnType<typeof resolveCanonicalFieldState>, key: string) {
  const f = result.fields.find((x) => x.fieldKey === key);
  assert.ok(f, `Field ${key} not found`);
  return f;
}

const confirmedReferenceOverride = [{
  field: "reference",
  fieldState: "USER_CONFIRMED" as const,
  overrideValue: "REF-2026-001",
  reason: "Confirmed",
  overriddenBy: "u1",
  createdAt: new Date(),
}];

describe("reference grounding via contactDetailsSourceJson fileId (behavioral)", () => {
  it("reference with valid fileId in activeTenderFileIds → EXTRACTED_AND_GROUNDED", () => {
    // Simulates the post-repair state: contactDetailsSourceJson has
    // { page, quote, fileId } for procurementReferenceNumber, and the fileId
    // is in activeTenderFileIds.
    const result = resolveCanonicalFieldState({
      tender: makeTender({
        reference: "REF-2026-001",
        contactDetailsSourceJson: JSON.stringify({
          procurementReferenceNumber: {
            page: 1,
            quote: "The procurement reference number is REF-2026-001.",
            fileId: "file-active",
          },
        }),
      }),
      overrides: [],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    const f = findField(result, "reference");
    assert.equal(
      f.status,
      "EXTRACTED_AND_GROUNDED",
      `reference with valid fileId in activeTenderFileIds must be EXTRACTED_AND_GROUNDED, got ${f.status}`,
    );
    assert.equal(f.blockerReason, null);
    assert.equal(f.isGrounded, true);
  });

  it("reference with fileId NOT in activeTenderFileIds → NOT EXTRACTED_AND_GROUNDED", () => {
    // The fileId points to a deleted/superseded file. Grounding must fail.
    // Note: reference is not in ALWAYS_CRITICAL_FIELDS, so the resolver does
    // not set a blockerReason — but it MUST NOT mark the field as
    // EXTRACTED_AND_GROUNDED. The isGrounded flag must be false.
    const result = resolveCanonicalFieldState({
      tender: makeTender({
        reference: "REF-2026-001",
        contactDetailsSourceJson: JSON.stringify({
          procurementReferenceNumber: {
            page: 1,
            quote: "The procurement reference number is REF-2026-001.",
            fileId: "file-deleted",
          },
        }),
      }),
      overrides: confirmedReferenceOverride,
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    const f = findField(result, "reference");
    assert.notEqual(f.status, "EXTRACTED_AND_GROUNDED",
      `reference with fileId NOT in activeTenderFileIds must NOT be EXTRACTED_AND_GROUNDED, got ${f.status}`);
    assert.equal(f.isGrounded, false,
      "reference with fileId NOT in activeTenderFileIds must have isGrounded=false");
  });

  it("reference with fileId omitted (legacy contactDetailsSourceJson) → blocked when activeTenderFileIds enforced", () => {
    // Backward-compat: an old contactDetailsSourceJson entry written before
    // this fix has only { page, quote } (no fileId). When activeTenderFileIds
    // is enforced, grounding must fail because fileId is null. This is the
    // CORRECT behavior — old evidence is treated as unverified until re-grounded.
    const result = resolveCanonicalFieldState({
      tender: makeTender({
        reference: "REF-2026-001",
        contactDetailsSourceJson: JSON.stringify({
          procurementReferenceNumber: {
            page: 1,
            quote: "The procurement reference number is REF-2026-001.",
            // fileId intentionally omitted — simulates pre-fix data
          },
        }),
      }),
      overrides: confirmedReferenceOverride,
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    const f = findField(result, "reference");
    assert.notEqual(f.status, "EXTRACTED_AND_GROUNDED",
      "reference without fileId must NOT be EXTRACTED_AND_GROUNDED when activeTenderFileIds is enforced");
  });

  it("reference with valid fileId but no page → blocked (page > 0 required)", () => {
    // fileId alone is not enough — page must be > 0 and quote must be > 5 chars.
    const result = resolveCanonicalFieldState({
      tender: makeTender({
        reference: "REF-2026-001",
        contactDetailsSourceJson: JSON.stringify({
          procurementReferenceNumber: {
            page: null, // no page
            quote: "The procurement reference number is REF-2026-001.",
            fileId: "file-active",
          },
        }),
      }),
      overrides: confirmedReferenceOverride,
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    const f = findField(result, "reference");
    assert.notEqual(f.status, "EXTRACTED_AND_GROUNDED",
      "reference without page must NOT be EXTRACTED_AND_GROUNDED");
  });

  it("reference with valid fileId but quote too short → blocked", () => {
    const result = resolveCanonicalFieldState({
      tender: makeTender({
        reference: "REF-2026-001",
        contactDetailsSourceJson: JSON.stringify({
          procurementReferenceNumber: {
            page: 1,
            quote: "REF", // < 5 chars (MIN_GROUNDING_QUOTE_LENGTH)
            fileId: "file-active",
          },
        }),
      }),
      overrides: confirmedReferenceOverride,
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    const f = findField(result, "reference");
    assert.notEqual(f.status, "EXTRACTED_AND_GROUNDED",
      "reference with quote < MIN_GROUNDING_QUOTE_LENGTH must NOT be EXTRACTED_AND_GROUNDED");
  });
});

// ─── 4. Behavioral: deadline grounding enforced when fileId invalid ────────
//
// We can't easily exercise the route's POST handler without a full Prisma
// mock + auth mock + extractor stub, but we CAN pin the contract via source
// inspection (already done above) plus the canonical-resolver behavior: a
// deadline whose sourceFileId is NOT in activeTenderFileIds must NOT be
// GROUNDED.

describe("deadline grounding via dedicated sourceFileId (behavioral)", () => {
  it("deadline with fileId in activeTenderFileIds + page + quote → EXTRACTED_AND_GROUNDED", () => {
    const result = resolveCanonicalFieldState({
      tender: makeTender({
        deadline: new Date("2026-12-11"),
        deadlineSourcePage: 1,
        deadlineSourceQuote: "The submission deadline is 11 December 2026.",
        deadlineSourceFileId: "file-active",
      }),
      overrides: [],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    const f = findField(result, "deadline");
    assert.equal(f.status, "EXTRACTED_AND_GROUNDED",
      `deadline with valid fileId must be EXTRACTED_AND_GROUNDED, got ${f.status}`);
    assert.equal(f.isGrounded, true);
  });

  it("deadline with fileId NOT in activeTenderFileIds → blocked", () => {
    const result = resolveCanonicalFieldState({
      tender: makeTender({
        deadline: new Date("2026-12-11"),
        deadlineSourcePage: 1,
        deadlineSourceQuote: "The submission deadline is 11 December 2026.",
        deadlineSourceFileId: "file-deleted",
      }),
      overrides: [],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    const f = findField(result, "deadline");
    assert.notEqual(f.status, "EXTRACTED_AND_GROUNDED",
      "deadline with fileId NOT in activeTenderFileIds must NOT be EXTRACTED_AND_GROUNDED");
  });

  it("deadline with null fileId → blocked when activeTenderFileIds enforced", () => {
    // This is the state the bypass used to produce: deadlineSourceFileId was
    // never set because the deadline branch skipped durableFileId resolution.
    // The canonical resolver must NOT ground it.
    const result = resolveCanonicalFieldState({
      tender: makeTender({
        deadline: new Date("2026-12-11"),
        deadlineSourcePage: 1,
        deadlineSourceQuote: "The submission deadline is 11 December 2026.",
        deadlineSourceFileId: null,
      }),
      overrides: [],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    const f = findField(result, "deadline");
    assert.notEqual(f.status, "EXTRACTED_AND_GROUNDED",
      "deadline with null fileId must NOT be EXTRACTED_AND_GROUNDED when activeTenderFileIds is enforced");
  });
});

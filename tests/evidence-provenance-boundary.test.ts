import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildDeterministicFallbackRows,
  mergeFallbackRows,
} from "../lib/engine/deterministic-fallback-rows";
import type { ComplianceResult } from "../lib/engine/types";

describe("evidence provenance boundary", () => {
  it("builds only unmatched-requirement diagnostics when AI matching fails", () => {
    const result = buildDeterministicFallbackRows([
      {
        id: "req-1",
        title: "Provide audited accounts",
        description: "Audited accounts are mandatory",
        requirementType: "FINANCIAL",
        priority: "MANDATORY",
        sourceTenderFileId: "tender-file-1",
        sourcePageNumber: 12,
        sourceExactQuote: "The bidder shall submit audited accounts.",
        sourceConfidence: 0.95,
      },
    ]);

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.evidenceType, "UNMATCHED_REQUIREMENT_DIAGNOSTIC");
    assert.equal(result.rows[0]?.evidenceSource, "NO_COMPANY_VAULT_EVIDENCE");
    assert.equal(result.rows[0]?.evidenceReference, undefined);
    assert.equal(result.blockerCode, "EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED");
  });

  it("never merges tender-source diagnostics into compliance matrices", () => {
    const existing: ComplianceResult = {
      matrices: [],
      gaps: [],
    };
    const diagnostics = buildDeterministicFallbackRows([
      {
        id: "req-1",
        title: "Provide audited accounts",
        description: "Audited accounts are mandatory",
        requirementType: "FINANCIAL",
        priority: "MANDATORY",
        sourceTenderFileId: "tender-file-1",
        sourcePageNumber: 12,
        sourceExactQuote: "The bidder shall submit audited accounts.",
        sourceConfidence: 0.95,
      },
    ]);

    const merged = mergeFallbackRows(existing, diagnostics.rows);
    assert.equal(merged, existing);
    assert.equal(merged.matrices.length, 0);
  });

  it("creates no diagnostic when tender-source grounding is incomplete", () => {
    const result = buildDeterministicFallbackRows([
      {
        id: "req-1",
        title: "Provide audited accounts",
        description: "Audited accounts are mandatory",
        requirementType: "FINANCIAL",
        priority: "MANDATORY",
        sourceTenderFileId: null,
        sourcePageNumber: null,
        sourceExactQuote: null,
        sourceConfidence: 0,
      },
    ]);

    assert.deepEqual(result.rows, []);
    assert.equal(result.blockerCode, null);
  });
});

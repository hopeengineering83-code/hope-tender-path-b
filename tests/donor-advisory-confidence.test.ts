// Donor-advisory confidence enum + invariants.
//
// Encodes the K-task hard rule: only EXPLICIT_TOR_REQUIRED can promote an
// advisory to an export blocker. Source-quote capture is verified so the
// readiness panel + audit log can show WHERE the requirement was found.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isExportBlockingConfidence,
  confidenceFromResolutionKind,
  scanTenderForExplicitDonorRequirement,
} from "../lib/engine/quality/donor-advisory-confidence";

describe("DonorAdvisoryConfidence — export-blocking invariant", () => {
  it("only EXPLICIT_TOR_REQUIRED blocks export", () => {
    assert.equal(isExportBlockingConfidence("EXPLICIT_TOR_REQUIRED"), true);
    for (const other of [
      "DONOR_CONTEXT_RECOMMENDED",
      "NOT_FOUND_IN_TOR",
      "USER_MARKED_NOT_REQUIRED",
      "POST_AWARD_DELIVERABLE",
      "DONOR_TEMPLATE_PROVIDED",
      "ADDED_TO_TECHNICAL",
    ] as const) {
      assert.equal(isExportBlockingConfidence(other), false, `${other} must NOT block export`);
    }
    assert.equal(isExportBlockingConfidence(undefined), false);
    assert.equal(isExportBlockingConfidence(null), false);
  });
});

describe("confidenceFromResolutionKind — user resolution → confidence mapping", () => {
  it("maps the four user resolution kinds onto the formal enum", () => {
    assert.equal(confidenceFromResolutionKind("NOT_REQUIRED_BY_TOR"), "USER_MARKED_NOT_REQUIRED");
    assert.equal(confidenceFromResolutionKind("POST_AWARD_DELIVERABLE"), "POST_AWARD_DELIVERABLE");
    assert.equal(confidenceFromResolutionKind("DONOR_TEMPLATE_PROVIDED"), "DONOR_TEMPLATE_PROVIDED");
    assert.equal(confidenceFromResolutionKind("ADDED_TO_TECHNICAL"), "ADDED_TO_TECHNICAL");
  });
  it("supports free-text suffix after the | separator (the existing audit convention)", () => {
    assert.equal(confidenceFromResolutionKind("NOT_REQUIRED_BY_TOR | confirmed by procurement lead"), "USER_MARKED_NOT_REQUIRED");
  });
  it("REOPEN and unknown kinds resolve to null (no confidence change)", () => {
    assert.equal(confidenceFromResolutionKind("REOPEN"), null);
    assert.equal(confidenceFromResolutionKind(""), null);
    assert.equal(confidenceFromResolutionKind(null), null);
    assert.equal(confidenceFromResolutionKind("garbage"), null);
  });
});

describe("scanTenderForExplicitDonorRequirement — source-quote capture", () => {
  it("returns EXPLICIT_TOR_REQUIRED + verbatim quote when ESMP is mandated", () => {
    const text = "Section 6 ToR: the bidder shall submit a complete ESMP covering construction and operation phases.";
    const r = scanTenderForExplicitDonorRequirement(text);
    assert.equal(r.explicit, true);
    assert.equal(r.confidence, "EXPLICIT_TOR_REQUIRED");
    assert.ok(r.sourceQuote && r.sourceQuote.includes("ESMP"));
    assert.ok(r.sourceQuote && r.sourceQuote.length <= 200);
  });

  it("recognises 'logframe / results framework' / 'monitoring & evaluation' phrasings", () => {
    for (const sample of [
      "Mandatory deliverable: a complete logframe at inception.",
      "ToR requires the firm to submit a results framework with baselines.",
      "The consultant must produce a Monitoring & Evaluation plan within 30 days.",
    ]) {
      const r = scanTenderForExplicitDonorRequirement(sample);
      assert.equal(r.explicit, true, `should match: ${sample}`);
      assert.equal(r.confidence, "EXPLICIT_TOR_REQUIRED");
      assert.ok(r.sourceQuote && r.sourceQuote.length > 0);
    }
  });

  it("returns DONOR_CONTEXT_RECOMMENDED when the tender body never mentions these docs explicitly", () => {
    const r = scanTenderForExplicitDonorRequirement("Scope of work: deliver a feasibility study and design.");
    assert.equal(r.explicit, false);
    assert.equal(r.confidence, "DONOR_CONTEXT_RECOMMENDED");
    assert.equal(r.sourceQuote, null);
  });

  it("handles empty/null source text without throwing", () => {
    assert.equal(scanTenderForExplicitDonorRequirement("").explicit, false);
    assert.equal(scanTenderForExplicitDonorRequirement(null as unknown as string).explicit, false);
  });
});

describe("export-readiness wiring uses the confidence model", () => {
  const source = readFileSync("lib/engine/export-readiness.ts", "utf8");

  it("imports the formal confidence module", () => {
    assert.match(source, /from\s+"\.\/donor-advisory-confidence"/);
  });

  it("calls scanTenderForExplicitDonorRequirement on the donor branch (no inline regex)", () => {
    assert.match(source, /scanTenderForExplicitDonorRequirement\(sourceText\)/);
  });

  it("promotes to blockers ONLY when isExportBlockingConfidence is true (hard invariant)", () => {
    assert.match(source, /isExportBlockingConfidence\(explicitScan\.confidence\)\s*\)\s*blockers\.push\(annotated\)/);
    assert.match(source, /else advisoryWarnings\.push\(annotated\)/);
  });

  it("annotates every emitted advisory with confidence + sourceQuote", () => {
    assert.match(source, /confidence:\s*explicitScan\.confidence/);
    assert.match(source, /sourceQuote:\s*explicitScan\.sourceQuote/);
  });

  it("ExportReadinessResult.advisoryWarnings carries confidence + sourceQuote in its type", () => {
    assert.match(source, /advisoryWarnings\?:\s*Array<\{[^}]*confidence\?:[^}]*sourceQuote\?:/);
  });
});

/**
 * The output side must meet the standard the input side already meets.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Driving a real tender end to end with a provider that had never seen it, the
 * Build Plan stopped exactly as designed:
 *
 *   REQUIREMENT_QUOTE_NOT_IN_FILE — "source quote is not contained in the
 *   referenced active TenderFile extracted text."
 *
 * That is `evidence-grounding.ts` refusing an extracted requirement whose
 * quote is not in the source. Nothing applied the same standard to the
 * document the client actually receives: the monetary values, registration
 * identifiers, delivery years and track-record counts a proposal asserts were
 * never checked against the tender or the reviewed company evidence.
 *
 * That gap only widens as proposal quality improves. A competitive proposal
 * wins on specificity — named projects, contract values, licence grades — and
 * a model asked for specificity will supply it whether or not it is real. The
 * more the writer is pushed toward evaluator-facing depth, the more load a
 * grounding check on its output has to carry.
 *
 * The cases below are written as SHAPES, not as one tender's facts: a value
 * that appears in the evidence, the same value reformatted, a value that
 * appears nowhere, an identifier that appears nowhere, and a year that
 * contradicts the controlling source. Any tender exercises the same shapes.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  checkGeneratedClaimGrounding,
  extractMaterialClaims,
  formatUngroundedClaims,
} from "../lib/engine/generated-claim-grounding";

/** Stand-in for the controlling tender source. */
const TENDER = {
  label: "tender",
  text: [
    "Tender Title: Architectural Consultancy Services for a Specialty Medical Center",
    "Submission Deadline: August 25, 2026, 5:00 PM local time.",
    "The consultant shall prepare conceptual and detailed architectural design proposals.",
  ].join("\n"),
};

/** Stand-in for reviewed company evidence the proposal may rely on. */
const EVIDENCE = {
  label: "vault: project references",
  text: [
    "General Hospital, contract value ETB 550 million, completed 2023.",
    "Referral Hospital upgrade, contract value ETB 125,000,000, delivered 2024.",
    "The firm holds TIN 0064637886 and VAT registration 15480320805.",
    "The firm has 350 completed projects across ten sectors.",
  ].join("\n"),
};

const SOURCES = [TENDER, EVIDENCE];

describe("a proposal may only assert values its sources contain", () => {
  it("passes a proposal whose figures all come from the evidence", () => {
    const proposal = [
      "## Executive Summary",
      "The firm has delivered a General Hospital with a contract value of ETB 550 million, completed 2023.",
      "It holds TIN 0064637886 and has 350 completed projects.",
    ].join("\n");
    const result = checkGeneratedClaimGrounding(proposal, SOURCES);
    assert.equal(result.ok, true, formatUngroundedClaims(result).join(" | "));
  });

  it("accepts the same value written with different formatting or currency placement", () => {
    // "ETB 125,000,000" in the evidence, "125000000 Birr" in the proposal is
    // the same amount presented differently — not a fabrication.
    const proposal = "The referral hospital upgrade carried a value of 125000000 Birr.";
    const result = checkGeneratedClaimGrounding(proposal, SOURCES);
    assert.equal(result.ok, true, formatUngroundedClaims(result).join(" | "));
  });

  it("accepts a full-digit amount whose source states the same value scaled", () => {
    // Measured against the real portfolio export: a proposal writing
    // "ETB 27,500,000,000" and evidence writing "ETB 27.5 Billion" state one
    // identical fact. Digit-run comparison alone called the second
    // unsupported — a false accusation against a properly evidenced figure,
    // and two of the three amounts the first version of this check flagged on
    // a real document were exactly this.
    const sources = [{ label: "vault", text: "Flagship programme, ETB 27.5 Billion, World Bank funded." }];
    const proposal = "We supervised a programme valued at ETB 27,500,000,000.";
    const result = checkGeneratedClaimGrounding(proposal, sources);
    assert.equal(result.ok, true, formatUngroundedClaims(result).join(" | "));
  });

  it("requires the unit, so a bare coincidental number does not ground a scaled claim", () => {
    // "27.5" alone appearing somewhere in a long document proves nothing.
    const sources = [{ label: "vault", text: "Section 27.5 covers handover documentation." }];
    const proposal = "We supervised a programme valued at ETB 27,500,000,000.";
    const result = checkGeneratedClaimGrounding(proposal, sources);
    assert.equal(result.ok, false);
  });

  it("catches a monetary value that appears in no source", () => {
    const proposal = "Our portfolio includes a teaching hospital valued at ETB 980 million.";
    const result = checkGeneratedClaimGrounding(proposal, SOURCES);
    assert.equal(result.ok, false);
    assert.equal(result.ungrounded.length, 1);
    assert.equal(result.ungrounded[0]!.kind, "MONETARY_VALUE");
    assert.match(formatUngroundedClaims(result)[0]!, /980/);
  });

  it("catches an invented registration identifier", () => {
    const proposal = "The firm is registered under TIN 9999999999.";
    const result = checkGeneratedClaimGrounding(proposal, SOURCES);
    assert.equal(result.ok, false);
    assert.ok(result.ungrounded.some((c) => c.kind === "REGISTRATION_ID"));
  });

  it("catches an inflated track-record count", () => {
    // The evidence supports 350; a proposal claiming 900 is asserting a
    // credential the firm cannot show.
    const proposal = "The firm has 900 completed projects across the region.";
    const result = checkGeneratedClaimGrounding(proposal, SOURCES);
    assert.equal(result.ok, false);
    assert.ok(result.ungrounded.some((c) => c.kind === "TRACK_RECORD_COUNT"));
  });

  it("catches a delivery year that no source states", () => {
    const proposal = "The specialty wing was completed 2019 under our supervision.";
    const result = checkGeneratedClaimGrounding(proposal, SOURCES);
    assert.equal(result.ok, false);
    assert.ok(result.ungrounded.some((c) => c.kind === "CALENDAR_YEAR"));
  });

  it("a benchmark's own facts do not ground a submission (sources exclude the sample)", () => {
    // The documented failure mode: an example proposal is given as a quality
    // reference and its facts leak into the real submission. Passing the
    // sample as a source would launder exactly that, so the API takes only
    // the tender and reviewed evidence — a value present ONLY in a sample is
    // still ungrounded.
    const benchmarkOnlyValue = "Deadline: March 25, 2026. Contract value ETB 675 million.";
    const proposal = "Our healthcare portfolio totals ETB 675 million.";
    const withoutSample = checkGeneratedClaimGrounding(proposal, SOURCES);
    assert.equal(withoutSample.ok, false, "a sample-only figure must not be treated as grounded");
    // Proving the fixture is honest: the value really is in the sample text.
    assert.match(benchmarkOnlyValue, /675/);
  });
});

describe("the check stays signal, not noise", () => {
  it("does not flag ordinary prose numbers that assert nothing about the world", () => {
    const proposal = [
      "The methodology proceeds in three phases over 18 months.",
      "Design review is completed within 24 hours of submission.",
      "Section 3.2 describes the approach; quality gates apply at 100% completion.",
    ].join("\n");
    const result = checkGeneratedClaimGrounding(proposal, SOURCES);
    assert.equal(result.ok, true, formatUngroundedClaims(result).join(" | "));
  });

  it("reports every claim it checked, not only the failures", () => {
    const proposal = "Completed 2023 for ETB 550 million; TIN 0064637886.";
    const claims = extractMaterialClaims(proposal);
    const kinds = new Set(claims.map((c) => c.kind));
    assert.ok(kinds.has("MONETARY_VALUE"));
    assert.ok(kinds.has("CALENDAR_YEAR"));
    assert.ok(kinds.has("REGISTRATION_ID"));
  });

  it("an empty or evidence-free document raises nothing", () => {
    assert.equal(checkGeneratedClaimGrounding("", SOURCES).ok, true);
    assert.equal(checkGeneratedClaimGrounding("Our approach is collaborative.", SOURCES).ok, true);
  });
});

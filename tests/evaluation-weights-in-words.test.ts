// Evaluation weights stated in words must read the same as weights stated with
// a percent sign.
//
// The weight readers accepted only /%/ and allowed at most the single optional
// word "weight"/"weightage" between the label and the number. A tender that
// wrote
//
//     "the financial evaluation weight is 30 percent and the technical
//      evaluation weight is 70 percent"
//
// therefore reported technicalWeight null and financialWeight null — no weights
// found — even though it states them plainly twice. Spelling the unit out, and
// putting "evaluation weight is" between the label and the number, is ordinary
// drafting in donor and government procurement.
//
// Found by driving a rural water supply tender through the real pipeline: its
// SECTION V scores 35/25/25/15 and splits 70/30, and the run still reported
// "Evaluation criteria were not extracted".
//
// The general invariant: how the unit is spelled is presentation. Weights that
// the source states must be read whichever way it writes them, and a source
// that states none must still yield null rather than a guess.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseTenderDocumentIntelligence } from "../lib/engine/source-driven-tender-text-parser";

function weights(body: string) {
  const intel = parseTenderDocumentIntelligence(
    `REQUEST FOR PROPOSALS\nConsultancy Services\n\nEVALUATION\n${body}\n`,
  );
  return {
    technical: intel.evaluationMethodology?.technicalWeight ?? null,
    financial: intel.evaluationMethodology?.financialWeight ?? null,
  };
}

describe("evaluation weights are read however the source spells the unit", () => {
  it("reads weights written as the word 'percent'", () => {
    const w = weights("The financial evaluation weight is 30 percent and the technical evaluation weight is 70 percent.");
    assert.equal(w.technical, 70);
    assert.equal(w.financial, 30);
  });

  it("reads 'per cent' written as two words", () => {
    const w = weights("Technical score shall carry 80 per cent and financial 20 per cent.");
    assert.equal(w.technical, 80);
    assert.equal(w.financial, 20);
  });

  it("still reads the percent sign forms it always read", () => {
    // Regression guard: widening the pattern must not lose the colon form,
    // which an earlier draft of this fix did break.
    for (const [body, tech, fin] of [
      ["Technical weight: 70%. Financial weight: 30%.", 70, 30],
      ["Technical 65% Financial 35%", 65, 35],
      ["Technical weightage 60% and financial weightage 40%.", 60, 40],
    ] as const) {
      const w = weights(body);
      assert.equal(w.technical, tech, `technical weight lost for: ${body}`);
      assert.equal(w.financial, fin, `financial weight lost for: ${body}`);
    }
  });

  it("reports no weights when the source states none", () => {
    // Criteria without weights is a real and common shape. It must stay null
    // rather than acquire an invented number — and, per the presence rule,
    // absent weights are not the same thing as absent criteria.
    const w = weights("Proposals are evaluated on quality of methodology and relevant experience.");
    assert.equal(w.technical, null);
    assert.equal(w.financial, null);
  });

  it("does not harvest a number from an unrelated distant sentence", () => {
    // The filler run between label and number is bounded, so a figure that
    // belongs to another clause is not adopted as a weight.
    const w = weights("The technical proposal shall describe the approach, the team and the work plan in detail, and the contract runs 24 months at 100 percent staffing.");
    assert.equal(w.technical, null);
  });
});

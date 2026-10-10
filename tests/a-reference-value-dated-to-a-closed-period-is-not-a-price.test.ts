// A past project's value, printed beside the years it ran, is not this bid's
// price.
//
// A hosted run's model-written section copied a reference-project record
// ("Construction value of works ETB 550.1M | 2015-2018 | Services: ...") into
// a table cell without its label. The PDF wrapped the cell and the export gate
// read the line "| ETB 550.1M; 2015-2018; Services:" as a price:
// PRICING_LEAKAGE [HIGH], score 85, AUTO_FINALIZE_NOT_CONVERGED. An amount
// dated to a period that has already closed is delivered work. The
// current-offer veto still runs first, so a fee or price stays caught
// whatever years it names.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { namesClosedPastPeriod, pricingLeakageFinding } from "../lib/engine/pricing-hygiene";

const DOC = { name: "Technical Proposal", exactFileName: "Technical Proposal.pdf", documentType: "TECHNICAL_PROPOSAL", format: "PDF" };

describe("namesClosedPastPeriod", () => {
  const now = new Date("2026-09-26T00:00:00Z");
  it("recognises a year range that ended before this year", () => {
    assert.equal(namesClosedPastPeriod("2015-2018", now), true);
    assert.equal(namesClosedPastPeriod("2019 – 2021", now), true);
  });
  it("does not treat a current or future period, a single year or a reversed range as closed", () => {
    assert.equal(namesClosedPastPeriod("2025-2027", now), false);
    assert.equal(namesClosedPastPeriod("2024-2026", now), false);
    assert.equal(namesClosedPastPeriod("completed in 2018", now), false);
    assert.equal(namesClosedPastPeriod("2018-2015", now), false);
  });
});

describe("the export gate reads a dated reference value as delivered work", () => {
  it("passes the wrapped reference-table line the hosted run delivered", () => {
    assert.equal(pricingLeakageFinding("| USD 4.2M; 2012-2016; Services:", DOC), null);
    assert.equal(
      pricingLeakageFinding("Row 3: Experience | District School; Rwanda; Education;\n| USD 4.2M; 2012-2016; Services:\n| structural assessment, supervision", DOC),
      null,
    );
  });

  it("still catches a price, whatever years it names", () => {
    assert.ok(pricingLeakageFinding("Our fee is USD 400,000 for 2012-2016.", DOC));
    assert.ok(pricingLeakageFinding("Total price USD 400,000; 2012-2016", DOC));
    assert.ok(pricingLeakageFinding("Construction supervision: USD 400,000", DOC));
  });
});

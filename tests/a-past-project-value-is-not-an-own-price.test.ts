// A technical proposal that cites past projects' values is not leaking the
// firm's price. 2026-10-07, a feasibility-study proposal warned "Financial
// content detected" on twelve portfolio rows ("Construction Value of Works |
// ETB 9,800,000,000", "Project value ETB 3,500,000,000", "ETB 13.7B
// Aggregate Value of Projects Delivered") and a pumping test ("constant-rate
// yield testing"). The firm's own price for this assignment still counts.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { countOwnPriceMentions } from "../lib/engine/detection-patterns";

describe("past project values and test rates are not own-price mentions", () => {
  it("portfolio value rows do not count", () => {
    for (const line of [
      "| **ETB 13.7B** Aggregate Value of Projects Delivered |",
      "| Construction Value of Works | ETB 9,800,000,000 |",
      "| Regional Water Supply Scheme | — | Ethiopia | listed in the Annex Schedule | Project value ETB 3,500,000,000 |",
      "| Borehole yield below design demand | High | Medium | Step-drawdown and constant-rate yield testing at each candidate site. |",
    ]) assert.equal(countOwnPriceMentions(line), 0, line);
  });

  it("the firm's own price for this assignment still counts", () => {
    for (const line of [
      "Our total fee for this assignment is ETB 1,250,000 exclusive of VAT.",
      "The lump sum price for the services is USD 84,000.",
      "Daily rate of the Team Leader: ETB 9,500 per day.",
    ]) assert.ok(countOwnPriceMentions(line) > 0, line);
  });
});

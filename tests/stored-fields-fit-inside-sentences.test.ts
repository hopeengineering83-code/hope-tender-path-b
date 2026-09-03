// A stored field is dropped into prose, so it must not bring its own punctuation.
//
// WHY THIS FILE EXISTS
// --------------------
// Evidence values are interpolated straight into sentences — "delivered X
// (client)" and "X for client." — so whatever the field ends with collides with
// the sentence's own punctuation. A real Company Vault project carries the
// client "Gimba City, South Wollo Zone, Amhara Region," — a location string
// that ends in a comma — and the client-facing Technical Proposal read:
//
//   … G+6 General Hospital – Dr Abdul Seid (Gimba City, South Wollo Zone,
//   Amhara Region,) and Moyale Abattoir Rehabilitation …
//   … Dr Abdul Seid for Gimba City, South Wollo Zone, Amhara Region,. The
//   same team is proposed …
//
// ",)" and ",." appeared three times over in the document an evaluator reads.
//
// The vault data is NOT edited to fix this — it keeps exactly what its source
// says. Only the rendering trims the separator the sentence supplies itself.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { inlineEvidenceValue } from "../lib/engine/proposal-intelligence";
import { buildCoverLetterOpener } from "../lib/engine/benchmark-tables";

const REAL_TRAILING_COMMA_CLIENT = "Gimba City, South Wollo Zone, Amhara Region,";

describe("a stored value is trimmed of the punctuation the sentence supplies", () => {
  it("drops a trailing comma", () => {
    assert.equal(inlineEvidenceValue(REAL_TRAILING_COMMA_CLIENT), "Gimba City, South Wollo Zone, Amhara Region");
  });

  it("keeps internal punctuation, which is part of the value", () => {
    assert.equal(inlineEvidenceValue("Addis Ababa, Ethiopia"), "Addis Ababa, Ethiopia");
    assert.equal(inlineEvidenceValue("Grade 1 / Category 1"), "Grade 1 / Category 1");
  });

  it("drops leading separators and collapses whitespace", () => {
    assert.equal(inlineEvidenceValue("  ,  Oromia   Water Works —  "), "Oromia Water Works");
  });

  it("is safe on empty and missing values", () => {
    assert.equal(inlineEvidenceValue(null), "");
    assert.equal(inlineEvidenceValue(undefined), "");
    assert.equal(inlineEvidenceValue("   "), "");
  });
});

describe("the rendered cover letter carries no dangling punctuation", () => {
  it("renders a trailing-comma client without ',)'", () => {
    const opener = buildCoverLetterOpener({
      companyName: "Hope Urban Planning Architectural and Engineering Consultancy PLC",
      clientName: "Pharo Ventures",
      tenderTitle: "Architectural Consultancy Services",
      projects: [
        { name: "G+6 General Hospital – Dr Abdul Seid", clientName: REAL_TRAILING_COMMA_CLIENT, contractValue: null, currency: null },
      ] as never,
    });
    assert.equal(/,\)/.test(opener), false, opener);
    assert.equal(/,\./.test(opener), false, opener);
    assert.match(opener, /Gimba City, South Wollo Zone, Amhara Region\)/, "the client must still be named in full");
  });
});

// Unit tests for the deterministic prohibition extractor (PR #397).
// Pure-function coverage; no AI / no DB.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  extractProhibitionsDeterministic,
  buildDeterministicComprehension,
} from "../lib/engine/analysis/deterministic-prohibition-extractor";

describe("extractProhibitionsDeterministic — empty / null inputs", () => {
  it("returns empty result for empty string", () => {
    const r = extractProhibitionsDeterministic("");
    assert.deepEqual(r.prohibitions, []);
    assert.deepEqual(r.evidence, []);
  });

  it("returns empty result for whitespace-only string", () => {
    const r = extractProhibitionsDeterministic("   \n\n\t  ");
    assert.deepEqual(r.prohibitions, []);
  });

  it("returns empty result for benign tender text without prohibitions", () => {
    const r = extractProhibitionsDeterministic("The bidder shall submit a complete technical proposal in PDF format. Three reviewed experts are required.");
    assert.deepEqual(r.prohibitions, []);
  });
});

describe("extractProhibitionsDeterministic — joint venture family", () => {
  it("detects 'No joint ventures are permitted'", () => {
    const r = extractProhibitionsDeterministic("No joint ventures are permitted under this tender.");
    assert.equal(r.prohibitions.length, 1);
    assert.match(r.prohibitions[0], /joint ventures/i);
  });

  it("detects 'Consortium arrangements are not allowed'", () => {
    const r = extractProhibitionsDeterministic("Section 4.2: Consortium arrangements are not allowed.");
    assert.equal(r.prohibitions.length, 1);
  });

  it("detects 'JVs are forbidden'", () => {
    const r = extractProhibitionsDeterministic("JVs are forbidden for this RFP.");
    assert.equal(r.prohibitions.length, 1);
  });

  it("detects 'Single firm only'", () => {
    const r = extractProhibitionsDeterministic("Single firm only — no teaming of any kind.");
    // Both "Single firm only" AND "no teaming" can fire; dedupe to one entry.
    assert.ok(r.prohibitions.length >= 1);
    assert.match(r.prohibitions[0], /joint ventures|sole prime/i);
  });
});

describe("extractProhibitionsDeterministic — subcontracting family", () => {
  it("detects 'Subcontracting is not allowed'", () => {
    const r = extractProhibitionsDeterministic("Subcontracting is not allowed under this contract.");
    assert.equal(r.prohibitions.length, 1);
    assert.match(r.prohibitions[0], /sub-contracting/i);
  });

  it("detects 'Bidder shall not subcontract'", () => {
    const r = extractProhibitionsDeterministic("The bidder shall not subcontract any portion of the assignment.");
    assert.equal(r.prohibitions.length, 1);
  });
});

describe("extractProhibitionsDeterministic — financial in technical envelope", () => {
  it("detects 'Two-envelope submission'", () => {
    const r = extractProhibitionsDeterministic("This is a two-envelope submission. Technical and financial proposals must be separately sealed.");
    assert.equal(r.prohibitions.length, 1);
    assert.match(r.prohibitions[0], /technical envelope|two-envelope/i);
  });

  it("detects 'price information shall not appear in the technical envelope'", () => {
    const r = extractProhibitionsDeterministic("Cost information shall not be included in the technical proposal.");
    assert.ok(r.prohibitions.length >= 1);
  });
});

describe("extractProhibitionsDeterministic — advance payment family", () => {
  it("detects 'No advance payments will be made'", () => {
    const r = extractProhibitionsDeterministic("No advance payments will be made by the client.");
    assert.equal(r.prohibitions.length, 1);
    assert.match(r.prohibitions[0], /advance payment|mobilisation/i);
  });

  it("detects 'No mobilization fee'", () => {
    const r = extractProhibitionsDeterministic("No mobilization fee or upfront payment will be granted.");
    assert.ok(r.prohibitions.length >= 1);
  });
});

describe("extractProhibitionsDeterministic — contract assignment family", () => {
  it("detects 'No assignment of the contract'", () => {
    const r = extractProhibitionsDeterministic("No assignment of the contract to any third party will be permitted.");
    assert.equal(r.prohibitions.length, 1);
    assert.match(r.prohibitions[0], /assignment/i);
  });

  it("detects 'contract shall not be assigned'", () => {
    const r = extractProhibitionsDeterministic("The contract shall not be assigned or transferred without prior consent.");
    assert.equal(r.prohibitions.length, 1);
  });
});

describe("extractProhibitionsDeterministic — additional cost to client", () => {
  it("detects 'No additional cost to the client'", () => {
    const r = extractProhibitionsDeterministic("No additional cost to the client beyond the contract value will be accepted.");
    assert.equal(r.prohibitions.length, 1);
    assert.match(r.prohibitions[0], /additional cost|client/i);
  });

  it("detects 'client shall not be required to purchase'", () => {
    const r = extractProhibitionsDeterministic("The client shall not be required to purchase any third-party licences.");
    assert.equal(r.prohibitions.length, 1);
  });
});

describe("extractProhibitionsDeterministic — foreign-firm restrictions", () => {
  it("detects 'No foreign firms'", () => {
    const r = extractProhibitionsDeterministic("No foreign firms are permitted to bid.");
    assert.equal(r.prohibitions.length, 1);
    assert.match(r.prohibitions[0], /foreign/i);
  });

  it("detects 'Only domestic firms'", () => {
    const r = extractProhibitionsDeterministic("Only domestic firms are eligible for this RFP.");
    assert.equal(r.prohibitions.length, 1);
  });
});

describe("extractProhibitionsDeterministic — multiple prohibitions", () => {
  it("detects multiple distinct prohibitions in one document and dedupes per family", () => {
    const text = `
      Section 1: Eligibility
      No joint ventures are permitted.
      No subcontracting is allowed.
      No advance payments will be made.
      Two-envelope submission: technical and financial must be separately sealed.
      Only domestic firms are eligible.
    `;
    const r = extractProhibitionsDeterministic(text);
    assert.equal(r.prohibitions.length, 5);
    // Each prohibition is unique (no duplicate canonicals)
    assert.equal(new Set(r.prohibitions).size, r.prohibitions.length);
  });

  it("dedupes when multiple sentences trigger the SAME family", () => {
    const text = `
      No joint ventures are permitted.
      Joint ventures are not allowed under this RFP.
      JVs are forbidden for this contract.
    `;
    const r = extractProhibitionsDeterministic(text);
    // All three sentences trigger the joint-venture family; only one canonical entry returned
    assert.equal(r.prohibitions.length, 1);
    assert.match(r.prohibitions[0], /joint ventures/i);
    // Evidence captures the matched substring from the first trigger
    assert.ok(r.evidence.length >= 1);
  });
});

describe("buildDeterministicComprehension — adapter to DeepTenderComprehension shape", () => {
  it("returns null when no prohibitions are detected", () => {
    const r = buildDeterministicComprehension("Standard tender text with no prohibitions.");
    assert.equal(r, null);
  });

  it("returns a DeepTenderComprehension-shaped object with only prohibitions populated", () => {
    const r = buildDeterministicComprehension("No joint ventures permitted.");
    assert.ok(r);
    assert.equal(r!.criteria.length, 0);
    assert.equal(r!.disqualifiers.length, 0);
    assert.equal(r!.prohibitions.length, 1);
    assert.equal(r!.totalWeightAccountedFor, null);
    assert.match(r!.reasoning, /Deterministic regex scan/);
  });
});

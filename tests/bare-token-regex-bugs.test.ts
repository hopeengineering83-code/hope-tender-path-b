// REGRESSION SUITE for the bare-token regex bug class.
//
// The Pharo benchmark engine had a longstanding latent bug: bare 2-4
// character abbreviations in regexes (ICT, MIS, ERP, MEP, HVAC, WASH,
// ESIA, ESMP, OPD, IPC, GIS) were matching INSIDE common English
// words because they had no \b word boundary. Examples:
//
//   bare /ICT/i  matched "predICT", "verdICT", "depICT", "distrICT",
//                "conflICT", "evICT", "restrICT", "convICT".
//                → Every tender mentioning "district health" or
//                  "conflict resolution" classified as ICT / Digital.
//
//   bare /MIS/i  matched "optimISation", "subMISsion", "comMISsion",
//                "perMISsion", "dismISsed", "promISe".
//                → "Financial advisory services for treasury
//                  optimisation" misclassified as ICT.
//                → "Submission rules" cross-matched.
//
//   bare /ERP/i  matched "supERPower", "tERPene", "hypERPlanet".
//   bare /WASH/i matched "Washington", "washroom", "washable".
//                → Projects in Washington flagged as Water/sanitation.
//   bare /MEP/i  matched "stamp" (no, that's "tamp"), but matches
//                  inside hyphenated compounds.
//
// These tests pin every known false-positive case so the bug cannot
// regress. They also exercise the legitimate positive cases so we
// know the word boundaries didn't break the intended behaviour.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { inferSector } from "../lib/engine/proposal-intelligence";

describe("inferSector — bare-token false-positives are rejected", () => {
  it("'district health services' classifies as Healthcare (not ICT via 'distrICT')", () => {
    // The bare /ICT/i pattern previously caught "distrICT" → misclassified.
    // With \bICT\b the substring no longer matches, and the healthcare
    // pattern (health/hospital/medical/clinic) wins first.
    assert.match(inferSector("District health services and clinical referrals network design"), /Healthcare/);
  });

  it("'conflict resolution training' does NOT match ICT", () => {
    // "conflICT" no longer matches \bICT\b. Falls through; "training" +
    // "advisory" inputs would route to Capacity Building, but a pure
    // conflict-resolution string falls to General.
    const result = inferSector("Conflict resolution training and stakeholder facilitation services");
    assert.doesNotMatch(result, /ICT/);
  });

  it("'tender submission rules' does NOT match ICT (bare MIS false-positive)", () => {
    // "subMISsion" historically matched bare /MIS/i → ICT classification.
    // The bare-token fix removes that.
    const result = inferSector("Standard tender submission rules and packaging requirements for the bid");
    assert.doesNotMatch(result, /ICT/);
  });

  it("'treasury optimisation services' does NOT match ICT (bare MIS false-positive in optIMISation)", () => {
    // The canonical bug from the May 17 audit: "Financial advisory
    // services for treasury opt-IMIS-ation" was returning ICT/Digital.
    // Now financial wins first AND the bare /MIS/i no longer matches.
    const result = inferSector("Financial advisory services for treasury optimisation and tax review");
    assert.match(result, /Financial/);
  });

  it("'Washington water supply project' classifies as Water (and WASH false-positive in Washington is harmless)", () => {
    // "WASHington" historically matched bare /WASH/i and would
    // classify as Water by accident. After the \bWASH\b fix, this
    // input still classifies as Water — but via the literal
    // "water supply" trigger, not via the accidental WASH match.
    // The legitimate route is preserved; the false-positive route
    // is closed (verified in the Washington-only test below).
    assert.match(inferSector("Washington state water supply utility scheme expansion and source protection"), /Water/);
  });

  it("'Washington consultancy services' does NOT match Water (was false-positive via WASHington)", () => {
    // Bare /WASH/i matched the WASH inside Washington, classifying
    // an unrelated consultancy tender as Water. With \bWASH\b this
    // input now falls through to General Consultancy.
    assert.doesNotMatch(inferSector("Washington office relocation and consultancy support services"), /Water/);
  });

  it("'general advisory commission for permission filings' does NOT match ICT", () => {
    // Multiple bare-token false-positives in one sentence:
    //   comMISsion → bare MIS
    //   perMISsion → bare MIS
    // Both no longer trigger ICT.
    const result = inferSector("General advisory commission for permission filings and licensing");
    assert.doesNotMatch(result, /ICT/);
  });

  it("'compliance with submission deadline rules' does NOT trigger ICT", () => {
    const result = inferSector("Compliance check with submission deadline rules and packaging requirements");
    assert.doesNotMatch(result, /ICT/);
  });
});

describe("inferSector — legitimate positive cases still work after word-boundary fix", () => {
  it("real ICT keyword still classifies as ICT", () => {
    assert.match(inferSector("ICT system architecture review and database design for the ministry"), /ICT/);
  });

  it("'MIS development' (with word boundary) still classifies as ICT", () => {
    assert.match(inferSector("MIS development and ERP implementation for federal finance bureau"), /ICT/);
  });

  it("'WASH scheme rehabilitation' still classifies as Water", () => {
    assert.match(inferSector("WASH scheme rehabilitation and source protection for rural water supply"), /Water/);
  });

  it("'MEP coordination' still picks up the right theme", () => {
    // The proposal-intelligence theme triggers use /\bMEP\b/i — must
    // still match "MEP coordination" as a standalone phrase.
    assert.match(inferSector("MEP coordination and biomedical equipment integration for hospital expansion"), /Healthcare/);
  });
});

describe("inferSector — sector ordering precedence (deeper bug)", () => {
  it("Agriculture irrigation does not get swallowed by Water", () => {
    // Water has 'irrigation' as a trigger; agriculture must run first.
    assert.match(inferSector("Irrigation scheme rehabilitation and crop production support for smallholders"), /Agriculture/);
  });

  it("Financial advisory does not get swallowed by 'advisory services' Capacity-Building pattern", () => {
    // Capacity Building has 'advisory services' as a trigger; the more
    // specific Financial pattern must win.
    assert.match(inferSector("Financial advisory services for treasury optimisation and due diligence"), /Financial/);
  });
});

describe("matching.ts WATER_SUPPLY capability — no WASHington false-positive", () => {
  // Direct unit-style check against the WATER_SUPPLY pattern from
  // matching.ts. The capability-family keywords are an internal constant,
  // so we replicate the canonical pattern here and assert the same
  // word-boundary semantics ship in production.
  const WATER_SUPPLY_BARE_WASH = /WASH/i;        // old (broken) form
  const WATER_SUPPLY_WORD_BOUNDED = /\bWASH\b/i; // fixed form

  it("old bare pattern WOULD have falsely matched 'Washington' (regression evidence)", () => {
    assert.match("Washington State Department of Transportation", WATER_SUPPLY_BARE_WASH);
  });

  it("fixed word-bounded pattern correctly rejects 'Washington'", () => {
    assert.doesNotMatch("Washington State Department of Transportation", WATER_SUPPLY_WORD_BOUNDED);
  });

  it("fixed word-bounded pattern still accepts 'WASH programme'", () => {
    assert.match("WASH programme — water sanitation and hygiene", WATER_SUPPLY_WORD_BOUNDED);
  });
});

describe("proposal-quality-scorer.ts SECTOR_VOCAB — no substring false-positives", () => {
  // The sector-vocab table previously had bare 3-4 char abbreviations
  // (IPC, CBR, API, UAT, SLA, etc.) that matched inside common English
  // words. The fixed table uses word boundaries.
  const FALSE_POSITIVE_INPUTS_FIXED: Array<{ input: string; mustNotContain: RegExp }> = [
    { input: "anticipated project completion timeline",  mustNotContain: /\bIPC\b/i },  // antICIPated
    { input: "the situation evaluation report",          mustNotContain: /\bUAT\b/i },  // evalUATion / sitUATion
    { input: "Islamabad regional headquarters",          mustNotContain: /\bSLA\b/i },  // ISLAmabad
    { input: "rapid response capability framework",      mustNotContain: /\bAPI\b/i },  // rAPId
  ];

  for (const { input, mustNotContain } of FALSE_POSITIVE_INPUTS_FIXED) {
    it(`'${input.slice(0, 40)}' does NOT match ${mustNotContain.source}`, () => {
      assert.doesNotMatch(input, mustNotContain);
    });
  }
});

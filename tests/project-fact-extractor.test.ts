// Tests for project-fact extractor.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractProjectFacts, mergeProjectFacts } from "../lib/engine/analysis/project-fact-extractor";

const SUMMARY_WAREHOUSE = `
47 Warehouse & Landscaping Project / Ato Jemmi Hussien / Haik, Kebele 05,
South Wollo Zone, Amhara Region, Ethiopia (1,000 m²)
Ref: ሐ/ከ/ ማ/647/2015, Date: 03/09/2015 E.C., Author: Biruk Arage
1. Construction Cost: 35,000,000.00 ETB
2. Feasibility Study, Geotechnical & New Design Cost: 400,000 ETB
3. Contract Administration & Construction Supervision Cost: 50,000 ETB/month 2014-2015 E.C.
Complete Design & Supervision: Feasibility study, Soil investigation, New
Architectural design, New Structural design, Complete MEP Design (Electrical,
Sanitary, Mechanical), Material specification, Bill of Quantity preparation.
`;

const SUMMARY_HOSPITAL = `
Dr. Abdu Seid Hospital / Gimba City, South Wollo Zone, Ethiopia (7,000 m²).
Construction Cost: ETB 550M. Consultancy Fee: ETB 1.1M.
Period: 2018 to 2020 E.C. Complete new design: Architectural, Structural,
Full MEP; Feasibility study; Soil investigation; BOQ; Construction supervision.
`;

const SUMMARY_BRITISH = `
Dessie Museum Renovation, Interior Design, Architectural and MEP Redesign.
Client: Ethiopian Heritage Trust. Funding: British Council. Grant value:
390,717 GBP. Period: 2023 to 2025.
`;

describe("extractProjectFacts", () => {
  it("extracts ETB contract value with commas", () => {
    const out = extractProjectFacts(SUMMARY_WAREHOUSE);
    assert.equal(out.currency, "ETB");
    assert.ok(out.contractValue && out.contractValue >= 35_000_000, `expected >= 35M, got ${out.contractValue}`);
  });
  it("extracts country", () => {
    const out = extractProjectFacts(SUMMARY_WAREHOUSE);
    assert.equal(out.country, "Ethiopia");
  });
  it("expands the M suffix into millions", () => {
    const out = extractProjectFacts(SUMMARY_HOSPITAL);
    assert.equal(out.currency, "ETB");
    assert.ok(out.contractValue && out.contractValue >= 1_000_000, `expected M-expansion, got ${out.contractValue}`);
  });
  it("extracts GBP grant value", () => {
    const out = extractProjectFacts(SUMMARY_BRITISH);
    assert.equal(out.currency, "GBP");
    assert.ok(out.contractValue && out.contractValue >= 390_000);
  });
  it("extracts a simple year range start date", () => {
    const out = extractProjectFacts(SUMMARY_HOSPITAL);
    assert.ok(out.startDate instanceof Date, `expected startDate, got ${out.startDate}`);
    assert.equal(out.startDate?.getFullYear(), 2018);
    assert.equal(out.endDate?.getFullYear(), 2020);
  });
  it("infers sector from keywords", () => {
    assert.equal(extractProjectFacts("Hospital construction in Ethiopia.").sector, "Healthcare");
    assert.equal(extractProjectFacts("Master plan for the city").sector, "Urban Planning");
    assert.equal(extractProjectFacts("Office tower commercial complex").sector, "Commercial");
  });
  it("returns empty object for empty input", () => {
    assert.deepEqual(extractProjectFacts(""), {});
  });
});

describe("mergeProjectFacts", () => {
  it("does not overwrite existing populated fields", () => {
    const merged = mergeProjectFacts(
      { contractValue: 9999, country: "Kenya" },
      { contractValue: 35_000_000, country: "Ethiopia", currency: "ETB" },
    );
    assert.equal(merged.contractValue, undefined);
    assert.equal(merged.country, undefined);
    assert.equal(merged.currency, "ETB");
  });
  it("does NOT include `location` in the merge payload (no DB column)", () => {
    const merged = mergeProjectFacts(
      {},
      { location: "Addis Ababa", country: "Ethiopia" },
    );
    assert.equal((merged as Record<string, unknown>).location, undefined);
    assert.equal(merged.country, "Ethiopia");
  });
});

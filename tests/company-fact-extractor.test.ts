// Tests for the company-fact extractor.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractCompanyFacts, mergeFactsIntoCompany } from "../lib/engine/analysis/company-fact-extractor";

const SAMPLE_PROFILE = `
Hope Urban Planning Architectural and Engineering Consultancy PLC

Founded 05 November 2019. Active staff: 35 total professionals. Holds
Category 1 (Grade I) Ethiopian Construction Authority consultancy
license.

Head office: Addis Ababa, Sarbet, NOC Building, 1st Floor.
TIN 0064637886. VAT 15480320805.

General Manager: Eng. Ahmed Kebede Tekaw, PPE Structural (IPSTE/6884).

Phone: +251 911 169 930. Email: hopeengineering83@gmail.com.
Website: hopearchitectural.com.

Service lines: feasibility studies, geotechnical investigation,
architectural design, structural engineering, MEP design, urban
planning, master planning, construction supervision.

Sectors of work: healthcare, hospitality, infrastructure, commercial,
industrial.
`;

describe("extractCompanyFacts", () => {
  it("extracts founding year", () => {
    const out = extractCompanyFacts(SAMPLE_PROFILE);
    assert.equal(out.foundingYear, 2019);
  });
  it("extracts headcount", () => {
    const out = extractCompanyFacts(SAMPLE_PROFILE);
    assert.equal(out.headcount, 35);
  });
  it("extracts license grade", () => {
    const out = extractCompanyFacts(SAMPLE_PROFILE);
    assert.ok(out.licenseGrade && /1|grade/i.test(out.licenseGrade), `expected a grade-1 marker, got: ${out.licenseGrade}`);
  });
  it("extracts TIN and VAT", () => {
    const out = extractCompanyFacts(SAMPLE_PROFILE);
    assert.equal(out.tin, "0064637886");
    assert.equal(out.vat, "15480320805");
  });
  it("extracts GM name and license", () => {
    const out = extractCompanyFacts(SAMPLE_PROFILE);
    assert.ok(out.gmName?.includes("Ahmed"), `expected Ahmed in gmName, got: ${out.gmName}`);
    assert.ok(out.gmLicense?.includes("IPSTE"), `expected IPSTE in gmLicense, got: ${out.gmLicense}`);
  });
  it("extracts email", () => {
    const out = extractCompanyFacts(SAMPLE_PROFILE);
    assert.equal(out.email, "hopeengineering83@gmail.com");
  });
  it("extracts website (not the email domain)", () => {
    const out = extractCompanyFacts(SAMPLE_PROFILE);
    assert.equal(out.website, "hopearchitectural.com");
  });
  it("extracts phone", () => {
    const out = extractCompanyFacts(SAMPLE_PROFILE);
    assert.ok(out.phone?.includes("+251"), `expected +251 in phone, got: ${out.phone}`);
  });
  it("extracts service lines list", () => {
    const out = extractCompanyFacts(SAMPLE_PROFILE);
    assert.ok(out.serviceLines && out.serviceLines.length >= 4, `expected ≥4 service lines, got ${out.serviceLines?.length}`);
    assert.ok(out.serviceLines?.some((s) => /architectural\s+design/i.test(s)));
  });
  it("extracts sectors list", () => {
    const out = extractCompanyFacts(SAMPLE_PROFILE);
    assert.ok(out.sectors && out.sectors.length >= 3);
  });
  it("returns empty object for empty input", () => {
    assert.deepEqual(extractCompanyFacts(""), {});
  });
});

describe("mergeFactsIntoCompany", () => {
  it("does not overwrite an existing populated field", () => {
    const merged = mergeFactsIntoCompany({ gmName: "Existing Name" }, { gmName: "New Name", foundingYear: 2019 });
    assert.equal(merged.gmName, undefined);
    assert.equal(merged.foundingYear, 2019);
  });
  it("fills empty fields", () => {
    const merged = mergeFactsIntoCompany({ gmName: null, tin: "" }, { gmName: "Eng. Ahmed", tin: "0064637886", foundingYear: 2019 });
    assert.equal(merged.gmName, "Eng. Ahmed");
    assert.equal(merged.tin, "0064637886");
    assert.equal(merged.foundingYear, 2019);
  });
  it("only sets serviceLines when existing JSON is empty", () => {
    const merged1 = mergeFactsIntoCompany({ serviceLines: "[]" }, { serviceLines: ["a", "b"] });
    assert.equal(merged1.serviceLines, JSON.stringify(["a", "b"]));
    const merged2 = mergeFactsIntoCompany({ serviceLines: JSON.stringify(["existing"]) }, { serviceLines: ["new"] });
    assert.equal(merged2.serviceLines, undefined);
  });
});

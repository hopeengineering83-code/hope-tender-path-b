import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveSignatory, signatoryExpertsFromProofLines, signOffLines } from "../lib/engine/signatory";

/**
 * Run 36074770709 ended its cover letter "Sincerely, <firm>". Both cover
 * builders printed a signatory only from the company record's general-manager
 * field, which this firm's record leaves empty — although its general manager
 * is named in its own evidence: the proposed expert whose CV title reads
 * "General Manager & Practicing Professional Engineer". The signatory now
 * comes from the records, and is never invented.
 */

const GM = {
  fullName: "Ahmed Kebede",
  title: "General Manager & Practicing Professional Engineer",
  certifications: JSON.stringify(["PSTE/6884"]),
};
const DEPUTY = { fullName: "Sara Tesfaye", title: "Deputy General Manager / Senior Civil Engineer" };
const ARCHITECT = { fullName: "Girum Alemu", title: "Senior Architect" };

describe("the proposal signatory comes from the firm's records", () => {
  it("uses the company record's general manager when it is set", () => {
    const s = resolveSignatory({ gmName: "Hanna Bekele", gmLicense: "REG-1", experts: [GM] });
    assert.deepEqual(s, { name: "Hanna Bekele", title: "General Manager", registration: "REG-1" });
  });

  it("otherwise uses the one proposed expert who holds an executive office", () => {
    const s = resolveSignatory({ experts: [ARCHITECT, GM] });
    assert.equal(s?.name, "Ahmed Kebede");
    assert.equal(s?.title, "General Manager & Practicing Professional Engineer");
    assert.equal(s?.registration, "PSTE/6884");
  });

  it("does not count a deputy or assistant as holding the office", () => {
    assert.equal(resolveSignatory({ experts: [DEPUTY, GM, ARCHITECT] })?.name, "Ahmed Kebede");
    assert.equal(resolveSignatory({ experts: [DEPUTY, ARCHITECT] }), null);
  });

  it("names nobody when two experts could sign, because the record does not say which", () => {
    const other = { fullName: "Dawit Haile", title: "Managing Director" };
    assert.equal(resolveSignatory({ experts: [GM, other] }), null);
  });

  it("prints no registration the record does not state", () => {
    const s = resolveSignatory({ experts: [{ fullName: "Ahmed Kebede", title: "General Manager" }] });
    assert.equal(s?.registration, null);
    assert.deepEqual(signOffLines("HAEC", s), ["Sincerely,", "", "**Ahmed Kebede**", "General Manager", "For and on behalf of HAEC"]);
  });

  it("signs for the firm without a name when no record names a signatory", () => {
    assert.deepEqual(signOffLines("HAEC", resolveSignatory({ experts: [ARCHITECT] })), ["Sincerely,", "", "For and on behalf of HAEC"]);
  });

  it("reads the per-section writer's expert proof lines", () => {
    const experts = signatoryExpertsFromProofLines([
      "- Girum Alemu — Senior Architect | 12+ years",
      "- Ahmed Kebede — General Manager & Practicing Professional Engineer | 30+ years",
    ].join("\n"));
    assert.equal(resolveSignatory({ experts })?.name, "Ahmed Kebede");
  });

  it("both cover-letter builders sign through the resolver", () => {
    const elite = readFileSync("lib/engine/generate-elite.ts", "utf8");
    const sections = readFileSync("lib/engine/proposal-sections.ts", "utf8");
    assert.match(elite, /resolveSignatory\(\{ gmName: params\.companyGM[^)]*experts: reviewedExperts \}\)/);
    assert.match(elite, /signOffLines\(params\.companyName, signatory\)/);
    assert.match(sections, /signOffLines\(companyName, resolveSignatory\(/);
  });
});

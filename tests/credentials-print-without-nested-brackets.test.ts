// A professional registration prints once, cleanly punctuated.
//
// The delivered Executive Summary read "Elias Manaye Yancha, Project Manager
// / Senior Civil Engineer (Practicing Professional Engineer (PE) in
// Construction Management (PEPCM/5718))": the stored certification already
// bracketed its number, and the builder bracketed the whole of it again.
// Every place that prints a registration now goes through
// credential-format.ts. The records below are invented fixtures.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { formatPersonWithCredential, formatRegistration } from "../lib/engine/credential-format";
import { licencesNamedInCv } from "../lib/engine/cv-grounding";
import { composeExecutiveSummary } from "../lib/engine/executive-summary-composer";
import { bindCurrencyAmounts } from "../lib/engine/proposal-pdf";
import type { ExpertRecord, ProjectRecord } from "../lib/engine/benchmark-tables";
import type { ScopePlanEntry } from "../lib/engine/scope-delivery-plan";

const NESTED = /\([^()]*\([^()]*\)[^()]*\)/;

describe("formatRegistration", () => {
  it("moves a bracketed number behind the designation as Reg. No.", () => {
    assert.equal(
      formatRegistration("Practicing Professional Engineer (PE) in Construction Management (PEPCM/5718)"),
      "Practicing Professional Engineer (PE) in Construction Management, Reg. No. PEPCM/5718",
    );
    assert.equal(formatRegistration("Registered Architect (RA/101)"), "Registered Architect, Reg. No. RA/101");
    assert.equal(formatRegistration("Licensed Surveyor - LS/44"), "Licensed Surveyor, Reg. No. LS/44");
  });

  it("normalises a number given on its own", () => {
    assert.equal(formatRegistration("Reg. No. PSTE/6884"), "Reg. No. PSTE/6884");
    assert.equal(formatRegistration("Registration No: EBA-123"), "Reg. No. EBA-123");
  });

  it("leaves a credential with no number exactly as recorded", () => {
    assert.equal(formatRegistration("Chartered Engineer (CEng)"), "Chartered Engineer (CEng)");
    assert.equal(formatRegistration("ISO 9001:2015 Lead Auditor"), "ISO 9001:2015 Lead Auditor");
    assert.equal(formatRegistration(""), "");
  });

  it("the CV reader states a registration in the same form", () => {
    const [found] = licencesNamedInCv("Registered as a Practicing Professional Architect with registration number PPA/1840 since 2012.");
    if (found) assert.doesNotMatch(found, NESTED);
  });
});

describe("formatPersonWithCredential", () => {
  it("never brackets a credential that already carries brackets", () => {
    const out = formatPersonWithCredential("A. Engineer", "Project Manager / Senior Civil Engineer", "Practicing Professional Engineer (PE) in Construction Management (PEPCM/5718)");
    assert.equal(out, "A. Engineer, Project Manager / Senior Civil Engineer — Practicing Professional Engineer (PE) in Construction Management, Reg. No. PEPCM/5718");
    assert.doesNotMatch(out, NESTED);
  });

  it("brackets a plain credential once", () => {
    assert.equal(
      formatPersonWithCredential("B. Architect", "Senior Architect", "Practicing Professional Architect (PPA/1840)"),
      "B. Architect, Senior Architect (Practicing Professional Architect, Reg. No. PPA/1840)",
    );
  });

  it("does not repeat a designation the title already states", () => {
    assert.equal(
      formatPersonWithCredential("C. Principal", "General Manager & Practicing Professional Engineer", "Practicing Professional Engineer (PSTE/6884)"),
      "C. Principal, General Manager & Practicing Professional Engineer (Reg. No. PSTE/6884)",
    );
  });

  it("prints the person alone when no registration is recorded", () => {
    assert.equal(formatPersonWithCredential("D. Planner", "Urban Planner", null), "D. Planner, Urban Planner");
  });
});

describe("the Executive Summary prints registrations without nested brackets", () => {
  it("names the lead and project manager cleanly", () => {
    const experts = [
      { fullName: "C. Principal", title: "General Manager", certifications: JSON.stringify(["Reg. No. PSTE/6884"]) },
      { fullName: "A. Engineer", title: "Project Manager / Senior Civil Engineer", certifications: JSON.stringify(["Practicing Professional Engineer (PE) in Construction Management (PEPCM/5718)"]) },
    ] as ExpertRecord[];
    const item = { title: "Site Assessment", description: "The consultant shall assess the site." };
    const scopePlan = [
      { item, lead: experts[1], support: [], risk: "", control: "" },
      { item: { title: "Design", description: "The consultant shall design." }, lead: experts[0], support: [], risk: "", control: "" },
    ] as unknown as ScopePlanEntry[];
    const summary = composeExecutiveSummary({
      companyName: "Example Consulting",
      clientName: "County Office",
      tenderTitle: "Clinic Design",
      primarySector: "Healthcare",
      scopePlan,
      projects: [] as ProjectRecord[],
      experts,
      evaluationCriteriaCount: 0,
    });
    assert.match(summary, /Reg\. No\. PEPCM\/5718/);
    assert.doesNotMatch(summary, NESTED);
  });
});

describe("the PDF keeps a registration and an amount on one line", () => {
  it("binds Reg. No. to its number and a currency code to its amount", () => {
    assert.deepEqual(bindCurrencyAmounts(["Engineer,", "Reg.", "No.", "PEPCM/5718", "led", "USD", "18,900,000", "works"]), ["Engineer,", "Reg. No. PEPCM/5718", "led", "USD 18,900,000", "works"]);
  });
});

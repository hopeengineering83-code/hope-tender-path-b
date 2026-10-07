/**
 * The Pricing Intelligence engine proposes a bid price in three scenarios from
 * the evidence the app holds, and never invents a rate it cannot defend.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { estimateTenderPrice, roundEstimatedRate, statedDurationMonths, statedBudget, approvedLineNotes, type PricingEvidenceInput } from "../lib/engine/pricing-intelligence";

const NOW = new Date("2026-10-07T00:00:00Z");

function input(overrides: Partial<PricingEvidenceInput> = {}): PricingEvidenceInput {
  return {
    tender: { id: "t1", title: "Feasibility study for rural water supply", country: "Ethiopia", category: "FEASIBILITY_STUDY", currency: null, budget: null },
    tenderText: [
      "The assignment shall be completed within four (4) months from contract signature.",
      "The consultant will conduct fieldwork and household survey data collection in three districts.",
      "Two validation workshops will be held with stakeholders.",
      "The financial proposal shall be in ETB inclusive of 15% VAT.",
    ].join(" "),
    experts: [
      { id: "e1", name: "A. Leader", title: "Team Leader / WASH Specialist", yearsExperience: 15 },
      { id: "e2", name: "B. Expert", title: "Water Engineer", yearsExperience: 8 },
      { id: "e3", name: "C. Analyst", title: "MEAL Specialist", yearsExperience: 5 },
    ],
    historicalProjects: [],
    priorRates: [],
    companyDefaultCurrency: "USD",
    now: NOW,
    ...overrides,
  };
}

const project = (name: string, value: number, months: number) => ({
  name, sector: "Water supply", serviceAreas: ["Feasibility study"], contractValue: value, currency: "ETB",
  startDate: "2024-01-01", endDate: new Date(Date.UTC(2024, 0, 1) + months * 30.4 * 86400000).toISOString(), selected: false,
});

describe("Pricing Intelligence", () => {
  it("reads the period, tax and budget the tender states", () => {
    assert.equal(statedDurationMonths("The services shall be completed within six (6) months.")?.months, 6);
    assert.equal(statedDurationMonths("Bids valid for 90 days after the deadline."), null, "a validity period is not the assignment period");
    assert.deepEqual(statedBudget("The total budget for this assignment is ETB 1,200,000 inclusive of VAT.")?.amount, 1_200_000);
    const est = estimateTenderPrice(input());
    assert.equal(est.currency, "ETB");
    assert.equal(est.vatPercent, 15);
    assert.match(est.vatBasis, /stated by the tender/);
    assert.equal(est.durationMonths, 4);
    assert.equal(est.durationConfidence, "HIGH");
  });

  it("with no rate evidence prepares quantities but invents no rate", () => {
    const est = estimateTenderPrice(input());
    assert.equal(est.status, "INSUFFICIENT_EVIDENCE");
    for (const sc of est.scenarios) {
      assert.equal(sc.complete, false);
      for (const l of sc.lines) {
        assert.equal(l.rate, null, `${l.label} must not be priced without evidence`);
        assert.ok(l.quantity > 0 && l.quantityBasis.length > 0);
      }
    }
    const labels = est.scenarios[1]!.lines.map((l) => l.label);
    assert.ok(labels.some((l) => /Team Leader/.test(l)));
    assert.ok(labels.some((l) => /Field transport/.test(l)));
    assert.ok(labels.some((l) => /enumerators/i.test(l)));
    const workshops = est.scenarios[1]!.lines.find((l) => /workshops/i.test(l.label))!;
    assert.equal(workshops.quantity, 2, "the tender's own count");
    assert.equal(workshops.quantityConfidence, "HIGH");
    assert.ok(est.lowConfidence.some((s) => /Market benchmarks/.test(s)), "says no market benchmark is held");
  });

  it("prices from the owner's previously approved rates, dated, and varies them by scenario", () => {
    const est = estimateTenderPrice(input({
      priorRates: [
        { label: "Team Leader — X", category: "PERSONNEL", unit: "DAY", rate: 12_000, currency: "ETB", date: "2026-05-01", tenderTitle: "Earlier WASH study" },
        { label: "Water Engineer — Y", category: "PERSONNEL", unit: "DAY", rate: 8_000, currency: "ETB", date: "2023-01-01" },
        { label: "Water Engineer — Y", category: "PERSONNEL", unit: "DAY", rate: 99_000, currency: "USD", date: "2026-06-01" },
      ],
    }));
    const [agg, bal, con] = est.scenarios;
    const leader = bal!.lines.find((l) => /Team Leader/.test(l.label))!;
    assert.equal(leader.rate, 12_000);
    assert.equal(leader.rateConfidence, "HIGH");
    assert.equal(leader.sourceDate, "2026-05-01");
    assert.match(leader.rateBasis, /Earlier WASH study/);
    const engineer = bal!.lines.find((l) => /Water Engineer/.test(l.label))!;
    assert.equal(engineer.rate, 8_000, "same-currency rate only");
    assert.equal(engineer.rateConfidence, "MEDIUM", "an old rate is weaker evidence");
    assert.ok(agg!.lines.find((l) => /Team Leader/.test(l.label))!.rate! < 12_000);
    assert.ok(con!.lines.find((l) => /Team Leader/.test(l.label))!.rate! > 12_000);
    assert.equal(est.status, "PARTIAL", "lines with no evidence stay unpriced");
  });

  it("spreads an envelope from comparable past contracts, marked LOW, scenarios ascending", () => {
    const est = estimateTenderPrice(input({
      historicalProjects: [project("Water supply feasibility A", 800_000, 4), project("Water supply design B", 1_500_000, 6), project("Water feasibility C", 600_000, 3)],
    }));
    assert.equal(est.status, "COMPLETE");
    assert.ok(est.envelope);
    assert.equal(est.envelope!.confidence, "MEDIUM");
    const [agg, bal, con] = est.scenarios;
    assert.ok(agg!.offerTotal < bal!.offerTotal && bal!.offerTotal < con!.offerTotal, "Competitive < Recommended < Conservative");
    for (const l of bal!.lines) {
      assert.equal(l.confidence, "LOW");
      assert.match(l.rateBasis, /past contract/);
      assert.equal(l.rate, roundEstimatedRate(l.rate!), "rounded to a precision its basis supports");
      assert.equal(l.amount, Math.round(l.rate! * l.quantity * 100) / 100);
    }
    // arithmetic: subtotal + contingency + VAT
    assert.equal(bal!.contingency, Math.round(bal!.subtotal * 0.05 * 100) / 100);
    assert.equal(bal!.offerTotal, Math.round((bal!.subtotal + bal!.contingency + bal!.vat) * 100) / 100);
    assert.equal(est.recommended, "BALANCED");
    assert.match(est.recommendation, /Recommended bid/);
  });

  it("never exceeds the client's budget, and never rescales a rate the tender fixes", () => {
    const est = estimateTenderPrice(input({
      tenderText: `${input().tenderText} The total budget for this assignment is ETB 900,000 inclusive of VAT. Field staff per diem is fixed at ETB 1,500 per day.`,
      historicalProjects: [project("Water supply feasibility A", 3_000_000, 4), project("Water supply design B", 4_000_000, 4), project("Water feasibility C", 5_000_000, 4)],
    }));
    for (const sc of est.scenarios) {
      assert.ok(sc.offerTotal <= 900_000 + 0.01, `${sc.id} ${sc.offerTotal} exceeds the budget`);
      const perDiem = sc.lines.find((l) => /Per diem/.test(l.label))!;
      assert.equal(perDiem.rate, 1_500);
      assert.equal(perDiem.rateConfidence, "HIGH");
    }
  });

  it("reads a stated count of any noun form without failing (data collectors, test pits)", () => {
    const est = estimateTenderPrice(input({
      tenderText: "The assignment shall be completed within three (3) months. Proposed data-collection tools and methods; data collectors will administer questionnaires. Twelve test pits and laboratory testing are required.",
    }));
    const lines = est.scenarios[1]!.lines;
    assert.ok(lines.some((l) => /enumerators/i.test(l.label)));
    const pits = lines.find((l) => /test pits/i.test(l.label))!;
    assert.equal(pits.quantity, 12);
  });

  it("one earlier approval prices another tender's roles by seniority tier, marked MEDIUM", () => {
    const est = estimateTenderPrice(input({
      tender: { id: "t2", title: "Detailed design of a rural road", country: "Ethiopia", category: "ROADS", currency: null, budget: null },
      experts: [
        { id: "x1", name: "L", title: "Team Leader / Highway Engineer", yearsExperience: 20 },
        { id: "x2", name: "M", title: "Pavement Engineer", yearsExperience: 9 },
      ],
      priorRates: [
        { label: "Team Leader / WASH Specialist — A", category: "PERSONNEL", unit: "DAY", rate: 11_000, currency: "ETB", date: "2026-09-01" },
        { label: "MEAL Specialist — B", category: "PERSONNEL", unit: "DAY", rate: 6_000, currency: "ETB", date: "2026-09-01" },
        { label: "Water Engineer — C", category: "PERSONNEL", unit: "DAY", rate: 7_000, currency: "ETB", date: "2026-09-01" },
      ],
    }));
    const lines = est.scenarios[1]!.lines;
    const lead = lines.find((l) => /Highway/.test(l.label))!;
    const pavement = lines.find((l) => /Pavement/.test(l.label))!;
    assert.equal(lead.rate, 11_000, "team-lead tier");
    assert.equal(pavement.rate, 6_000, "expert tier median (lower of two)");
    assert.equal(pavement.rateConfidence, "MEDIUM");
    assert.match(pavement.rateBasis, /seniority|expert roles/);
  });

  it("records where an approved line came from", () => {
    const est = estimateTenderPrice(input({ historicalProjects: [project("Water supply feasibility A", 800_000, 4)] }));
    const note = approvedLineNotes(est.scenarios[1]!.lines[0]!, "BALANCED");
    assert.match(note, /Approved BALANCED estimate/);
    assert.match(note, /Quantity:/);
    assert.match(note, /Confidence: LOW/);
  });
});

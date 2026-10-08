/**
 * A rate the firm entered or approved once prices later tenders on its own —
 * but only where it fits: the same seniority, the same market and currency, the
 * same kind of line, and an age the owner is warned about. A team leader's day
 * rate saved without a seniority used to price every junior role through the
 * generic "professional" key; a three-year-old rate read as current evidence;
 * a rate approved for another country priced this one.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { estimateTenderPrice, evaluationModelOf, rateCardSlotFor, type PricingEvidenceInput } from "../lib/engine/pricing-intelligence";
import { SEED_BENCHMARKS, findBenchmark, marketOf, type PricingBenchmark } from "../lib/engine/pricing-benchmarks";

const NOW = new Date("2026-10-08T00:00:00Z");

function input(overrides: Partial<PricingEvidenceInput> = {}): PricingEvidenceInput {
  return {
    tender: { id: "t1", title: "Design of a district office", country: "Ethiopia", category: null, currency: null, budget: null },
    tenderText: "The assignment shall be completed within four (4) months.",
    experts: [],
    teamRequirementTexts: ["Key experts: Team Leader; Procurement Specialist; Assistant Architect"],
    historicalProjects: [],
    priorRates: [],
    companyDefaultCurrency: "ETB",
    now: NOW,
    ...overrides,
  };
}

const owner = (b: Partial<PricingBenchmark>): PricingBenchmark => ({
  id: `o-${Math.random()}`, origin: "OWNER", market: "ET", category: "PERSONNEL_FEE", serviceKey: "professional", label: "x", seniority: null,
  unit: "DAY", currency: "ETB", low: 1, median: 1, high: 1, rateBasis: "FEE", effectiveDate: "2026-09-01", source: "HAEC rate card", sourceType: "OWNER_RATE_CARD",
  confidence: "HIGH", lastVerified: "2026-09-01", ...b,
});

describe("a personnel rate prices only its own seniority", () => {
  it("a team leader's rate saved without a seniority does not price a junior or another role", () => {
    const leaderRate = owner({ label: "Team Leader", median: 12_000, low: 12_000, high: 12_000 });
    assert.equal(findBenchmark([leaderRate], { category: "PERSONNEL_FEE", serviceKey: "professional", seniority: "JUNIOR", currency: "ETB", unit: "DAY" }), null);
    assert.equal(findBenchmark([leaderRate], { category: "PERSONNEL_FEE", serviceKey: "architect", seniority: "MID", currency: "ETB", unit: "DAY" }), null);

    const est = estimateTenderPrice(input({ benchmarks: [leaderRate, ...SEED_BENCHMARKS] }));
    const bal = est.scenarios[1]!;
    for (const l of bal.lines.filter((x) => x.category === "PERSONNEL")) {
      assert.notEqual(l.rate, 12_000, `${l.label} is not priced at the team leader's rate`);
      assert.equal(l.rateSource, "Cost model (public salary scale)", `${l.label} falls back to the documented cost model`);
    }
  });

  it("a rate filed with its seniority prices that seniority and the next step, not two steps away", () => {
    const senior = owner({ serviceKey: "architect", label: "Architect", seniority: "SENIOR", median: 9_000, low: 9_000, high: 9_000 });
    assert.equal(findBenchmark([senior], { category: "PERSONNEL_FEE", serviceKey: "architect", seniority: "SENIOR", currency: "ETB", unit: "DAY" })?.median, 9_000);
    assert.equal(findBenchmark([senior], { category: "PERSONNEL_FEE", serviceKey: "architect", seniority: "EXPERT", currency: "ETB", unit: "DAY" })?.median, 9_000);
    assert.equal(findBenchmark([senior], { category: "PERSONNEL_FEE", serviceKey: "architect", seniority: "JUNIOR", currency: "ETB", unit: "DAY" }), null);
  });

  it("a rate card entry for another market does not price this one", () => {
    const kenya = owner({ market: "KE", category: "TRANSPORT", serviceKey: "field_transport", label: "4WD", median: 7_000, low: 7_000, high: 7_000 });
    assert.equal(findBenchmark([kenya], { category: "TRANSPORT", serviceKey: "field_transport", currency: "ETB", unit: "DAY", market: "ET" }), null);
    assert.equal(marketOf("Federal Democratic Republic of Ethiopia"), "ET");
    assert.equal(marketOf("ke"), "KE");
    assert.equal(marketOf(""), null);
  });

  it("the slot a typed rate is filed under carries the role and seniority", () => {
    assert.deepEqual(rateCardSlotFor({ key: "expert:e1", category: "PERSONNEL", label: "Team Leader / Water Engineer — A. Person", unit: "DAY", seniority: "EXPERT" }),
      { category: "PERSONNEL_FEE", serviceKey: "water_engineer", seniority: "EXPERT", label: "Team Leader / Water Engineer" });
    assert.deepEqual(rateCardSlotFor({ key: "field-transport", category: "TRAVEL", label: "Field transport (vehicle with driver and fuel)", unit: "DAY" }),
      { category: "TRANSPORT", serviceKey: "field_transport", seniority: null, label: "Field transport (vehicle with driver and fuel)" });
    assert.equal(rateCardSlotFor({ key: "professional-fees", category: "PERSONNEL", label: "Professional fees", unit: "LUMP_SUM" }), null);
  });
});

describe("an approved rate is reused with its age and place in view", () => {
  const text = "The assignment shall be completed within four (4) months. The consultant will conduct field visits to the project sites.";
  const transport = (date: string, country: string | null, category = "TRAVEL") => ({ label: "Field transport (vehicle with driver and fuel)", category, unit: "DAY", rate: 6_500, currency: "ETB", date, country });

  it("a recent rate is HIGH, an older one MEDIUM, one older than three years LOW — and the owner is told", () => {
    for (const [date, confidence, stale] of [["2026-06-01", "HIGH", false], ["2024-10-01", "MEDIUM", true], ["2022-01-01", "LOW", true]] as const) {
      const est = estimateTenderPrice(input({ tenderText: text, priorRates: [transport(date, "Ethiopia")] }));
      const line = est.scenarios[1]!.lines.find((l) => l.key === "field-transport")!;
      assert.equal(line.rate, 6_500, date);
      assert.equal(line.rateConfidence, confidence, date);
      assert.equal(est.warnings.some((w) => w.code === "STALE_RATE" && /Field transport/.test(w.message)), stale, date);
    }
  });

  it("a rate approved for a tender in another country, or for another kind of line, is not reused", () => {
    const abroad = estimateTenderPrice(input({ tenderText: text, priorRates: [transport("2026-06-01", "Kenya")] }));
    assert.equal(abroad.scenarios[1]!.lines.find((l) => l.key === "field-transport")!.rate, null);
    const otherKind = estimateTenderPrice(input({ tenderText: text, priorRates: [transport("2026-06-01", "Ethiopia", "PERSONNEL")] }));
    assert.equal(otherKind.scenarios[1]!.lines.find((l) => l.key === "field-transport")!.rate, null);
    const unknownPlace = estimateTenderPrice(input({ tenderText: text, priorRates: [transport("2026-06-01", null)] }));
    assert.equal(unknownPlace.scenarios[1]!.lines.find((l) => l.key === "field-transport")!.rate, 6_500, "a rate with no recorded country is not refused");
  });
});

describe("enumerators are priced from the documented entry-pay floor", () => {
  it("cost-built at cost from the public entry salary and pension, LOW, the same in every scenario", () => {
    const est = estimateTenderPrice(input({ tenderText: "The assignment shall be completed within three (3) months. A household survey will be administered by 12 enumerators over 20 days of fieldwork." }));
    const lines = est.scenarios.map((sc) => sc.lines.find((l) => l.key === "enumerators")!);
    const entry = SEED_BENCHMARKS.find((b) => b.id === "seed-et-salary-junior")!;
    const expected = Math.round((entry.median * 1.11) / 22 / 10) * 10;
    for (const l of lines) {
      assert.equal(l.rate, expected);
      assert.equal(l.confidence, "LOW");
      assert.match(l.rateBasis, /entry/i);
      assert.deepEqual(l.build, { costRate: expected, overheadPct: 0, marginPct: 0 }, "passed through at cost");
    }
    assert.equal(lines[0]!.quantity, 12 * 20, "12 enumerators stated × 20 field days stated");
  });
});

describe("the evaluation model is read from the tender, not from a stock phrase", () => {
  it("'not bound to accept the lowest bid' is a reserved right, not least-cost selection", () => {
    const qcbs = "Technical proposals carry 80% and financial proposals 20%. The Client is not bound to accept the lowest bid.";
    assert.equal(evaluationModelOf(qcbs).model, "QCBS");
    assert.equal(evaluationModelOf("The Employer is not bound to accept the lowest or any bid.").model, "UNKNOWN");
  });

  it("stated weights decide even when the score formula names the lowest price", () => {
    const text = "Evaluation: technical 70%, financial 30%. The lowest price shall receive a financial score of 100.";
    const model = evaluationModelOf(text);
    assert.equal(model.model, "QCBS");
    assert.equal(model.financialWeight, 30);
    assert.equal(estimateTenderPrice(input({ tenderText: `${text} The assignment lasts four (4) months.` })).recommended, "BALANCED");
  });

  it("financial weight zero is quality-based selection; least-cost is still read where stated", () => {
    assert.equal(evaluationModelOf("Weights: technical 100%, financial 0%.").model, "QBS");
    assert.equal(evaluationModelOf("The contract will be awarded to the lowest evaluated price among responsive bids.").model, "LCS");
  });
});

describe("an item no source can price says what the owner must provide", () => {
  it("drilling and laboratory work ask for the subcontractor's quote; a workshop asks for the rate once", () => {
    const est = estimateTenderPrice(input({ tenderText: "The assignment shall be completed within three (3) months. Ten (10) boreholes will be drilled with laboratory soil tests. One validation workshop will be held." }));
    const messages = est.warnings.filter((w) => w.code === "NO_RATE").map((w) => w.message);
    assert.ok(messages.some((m) => /Boreholes/.test(m) && /subcontractor's quoted price/.test(m)), messages.join("\n"));
    assert.ok(messages.some((m) => /Laboratory/.test(m) && /subcontractor's quoted price/.test(m)), messages.join("\n"));
    assert.ok(messages.some((m) => /workshop/i.test(m) && /rate card once/.test(m)), messages.join("\n"));
  });
});

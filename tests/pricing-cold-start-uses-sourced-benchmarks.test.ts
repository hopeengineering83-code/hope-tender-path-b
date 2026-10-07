/**
 * Cold start: with no approved rate, budget or past contract, the estimator
 * still prices what a sourced public figure covers — personnel from the public
 * salary scale through a visible cost → overhead → margin build, per diem from
 * the government allowance directive — and leaves everything else unpriced
 * rather than inventing a market rate. The evaluation model, not a guess,
 * chooses the recommended scenario.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { estimateTenderPrice, evaluationModelOf, roundEstimatedRate, type PricingEvidenceInput } from "../lib/engine/pricing-intelligence";
import { SEED_BENCHMARKS, classifyRole, findBenchmark, seniorityOf, validateBenchmark, type PricingBenchmark } from "../lib/engine/pricing-benchmarks";

const NOW = new Date("2026-10-07T00:00:00Z");

function input(overrides: Partial<PricingEvidenceInput> = {}): PricingEvidenceInput {
  return {
    tender: { id: "t1", title: "Feasibility study for a water scheme", country: "Ethiopia", category: "FEASIBILITY_STUDY", currency: null, budget: null },
    tenderText: [
      "The assignment shall be completed within three (3) months from contract signature.",
      "The consultant will conduct fieldwork in four woredas, with household survey data collection.",
      "Two validation workshops will be held with stakeholders.",
    ].join(" "),
    experts: [
      { id: "e1", name: "A", title: "Team Leader / Water Engineer", yearsExperience: 18 },
      { id: "e2", name: "B", title: "Social Specialist", yearsExperience: 6 },
    ],
    historicalProjects: [],
    priorRates: [],
    companyDefaultCurrency: "USD",
    now: NOW,
    ...overrides,
  };
}

describe("cold-start pricing from sourced benchmarks", () => {
  it("every shipped benchmark carries a source, a URL or statute, a date and a valid spread", () => {
    assert.ok(SEED_BENCHMARKS.length >= 8);
    for (const b of SEED_BENCHMARKS) {
      assert.ok(b.source.length > 20, `${b.id} names its source`);
      assert.ok(b.sourceUrl || b.sourceType === "STATUTE", `${b.id} links its source`);
      assert.match(b.effectiveDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(b.low <= b.median && b.median <= b.high && b.median > 0, b.id);
      const { id: _id, origin: _origin, ...raw } = b;
      assert.equal(validateBenchmark(raw as Record<string, unknown>).ok, true, `${b.id} passes the import validator`);
    }
    assert.ok(!SEED_BENCHMARKS.some((b) => b.category === "PERSONNEL_FEE"), "no consultancy fee rate is invented: none is published");
    assert.ok(!SEED_BENCHMARKS.some((b) => b.category === "TRANSPORT" || b.category === "WORKSHOP"), "no vehicle-hire or venue rate is invented");
  });

  it("prices personnel by cost → overhead → margin, per diem by the field tier, and nothing else", () => {
    const est = estimateTenderPrice(input());
    assert.equal(est.status, "PARTIAL");
    const [agg, bal, con] = est.scenarios;
    const leader = bal!.lines.find((l) => /Team Leader/.test(l.label))!;
    const expert = findBenchmark(SEED_BENCHMARKS, { category: "PERSONNEL_SALARY", serviceKey: "professional", seniority: "EXPERT", currency: "ETB", unit: "MONTH" })!;
    const dayCost = Math.round((expert.median * 1.11) / 22 * 100) / 100;
    assert.equal(leader.build!.costRate, dayCost, "salary + 11% employer pension over 22 working days");
    assert.equal(leader.rate, roundEstimatedRate(dayCost * 2 * 1.1), "Balanced: +100% overhead, +10% margin");
    assert.match(leader.rateBasis, /cost-built/);
    assert.equal(leader.confidence, "LOW");
    for (const sc of [agg!, bal!, con!]) {
      for (const l of sc.lines.filter((x) => x.build && x.build.overheadPct > 0)) assert.ok(l.rate! > l.build!.costRate, `${sc.id} ${l.label} stays above cost`);
      assert.ok(sc.build.directCost > 0 && sc.build.overhead > 0 && sc.build.margin > 0);
    }
    assert.ok(agg!.offerTotal < bal!.offerTotal && bal!.offerTotal < con!.offerTotal);

    const perDiem = bal!.lines.find((l) => /Per diem/i.test(l.label))!;
    assert.equal(perDiem.rate, 1_030, "woreda field work takes the woreda allowance");
    assert.match(perDiem.rateBasis, /woreda/i);
    assert.ok(perDiem.assumptions.some((a) => /at cost/.test(a)), "an allowance is reimbursed at cost, without overhead or margin");
    assert.equal(agg!.lines.find((l) => /Per diem/i.test(l.label))!.rate, 1_030, "an at-cost allowance does not vary by scenario");

    for (const l of bal!.lines.filter((x) => /transport|workshop/i.test(x.label))) {
      assert.equal(l.rate, null, `${l.label}: no public source, no invented rate`);
    }
    assert.ok(est.warnings.some((w) => w.code === "NO_RATE"));
    assert.ok(est.benchmarksUsed.some((b) => /addisinsight/.test(b.sourceUrl ?? "")));
    assert.ok(est.benchmarksUsed.some((b) => /Pension/.test(b.source)));
  });

  it("the owner's rate card outranks the public figures", () => {
    const card: PricingBenchmark[] = [
      { id: "o1", origin: "OWNER", market: "ET", category: "PERSONNEL_FEE", serviceKey: "water_engineer", label: "Water engineer day rate", seniority: "EXPERT", unit: "DAY", currency: "ETB", low: 9_000, median: 10_000, high: 12_000, rateBasis: "FEE", effectiveDate: "2026-06-01", source: "HAEC rate card 2026", sourceType: "OWNER_RATE_CARD", confidence: "HIGH", lastVerified: "2026-06-01" },
      { id: "o2", origin: "OWNER", market: "ET", category: "TRANSPORT", serviceKey: "field_transport", label: "4WD with driver and fuel", unit: "DAY", currency: "ETB", low: 6_000, median: 7_000, high: 8_000, rateBasis: "FEE", effectiveDate: "2026-06-01", source: "HAEC rate card 2026", sourceType: "OWNER_RATE_CARD", confidence: "HIGH", lastVerified: "2026-06-01" },
    ];
    const est = estimateTenderPrice(input({ benchmarks: [...card, ...SEED_BENCHMARKS] }));
    const [agg, bal, con] = est.scenarios;
    const leader = (sc: typeof bal) => sc!.lines.find((l) => /Team Leader/.test(l.label))!;
    assert.deepEqual([leader(agg).rate, leader(bal).rate, leader(con).rate], [9_000, 10_000, 12_000]);
    assert.equal(leader(bal).rateSource, "Owner rate card");
    assert.equal(bal!.lines.find((l) => /transport/i.test(l.label))!.rate, 7_000);
  });

  it("the evaluation model chooses the recommended scenario, with the reason", () => {
    assert.deepEqual(
      { m: evaluationModelOf("Technical proposals carry 70% and financial proposals 30% of the combined score.").model, t: evaluationModelOf("Technical proposals carry 70% and financial proposals 30%.").technicalWeight },
      { m: "QCBS", t: 70 },
    );
    const qcbs = estimateTenderPrice(input({ tenderText: `${input().tenderText} Weights: technical 80%, financial 20%.` }));
    assert.equal(qcbs.evaluation.model, "QCBS");
    assert.equal(qcbs.recommended, "BALANCED");
    assert.match(qcbs.recommendation, /Price carries 20%/);
    const priceHeavy = estimateTenderPrice(input({ tenderText: `${input().tenderText} Weights: technical 50%, financial 50%.` }));
    assert.equal(priceHeavy.recommended, "AGGRESSIVE");
    const lcs = estimateTenderPrice(input({ tenderText: `${input().tenderText} The selection method is Least Cost Selection (LCS).` }));
    assert.equal(lcs.evaluation.model, "LCS");
    assert.equal(lcs.recommended, "AGGRESSIVE");
    assert.match(lcs.recommendation, /lowest evaluated price/);
    const none = estimateTenderPrice(input());
    assert.equal(none.evaluation.model, "UNKNOWN");
    assert.equal(none.recommended, "BALANCED", "no weights stated: nothing assumed");
  });

  it("warns on a stale benchmark, a fee below cost and an exceeded budget", () => {
    const later = estimateTenderPrice(input({ now: new Date("2029-01-01T00:00:00Z") }));
    assert.ok(later.warnings.some((w) => w.code === "STALE_BENCHMARK"));
    const cheap = estimateTenderPrice(input({ priorRates: [{ label: "Social Specialist — Z", category: "PERSONNEL", unit: "DAY", rate: 500, currency: "ETB", date: "2026-09-01" }] }));
    assert.ok(cheap.warnings.some((w) => w.code === "BELOW_COST" && /Social Specialist/.test(w.message)));
    const tight = estimateTenderPrice(input({ tenderText: `${input().tenderText} The total budget for this assignment is ETB 50,000 inclusive of VAT.` }));
    for (const sc of tight.scenarios) assert.ok(sc.offerTotal <= 50_000 + 0.01, `${sc.id} within the budget`);
  });

  it("classifies roles and seniority for matching", () => {
    assert.equal(classifyRole("Senior Hydrogeologist"), "geotechnical_engineer");
    assert.equal(classifyRole("Quantity Surveyor"), "quantity_surveyor");
    assert.equal(seniorityOf("Team Leader"), "EXPERT");
    assert.equal(seniorityOf("Assistant Engineer"), "JUNIOR");
    assert.equal(seniorityOf("Engineer", 10), "SENIOR");
  });

  it("refuses an import without a source, a date or a coherent spread", () => {
    const base = { category: "TRANSPORT", unit: "DAY", currency: "ETB", median: 7_000, label: "4WD", source: "HAEC rate card", effectiveDate: "2026-06-01" };
    assert.equal(validateBenchmark(base).ok, true);
    assert.equal(validateBenchmark({ ...base, source: "" }).ok, false);
    assert.equal(validateBenchmark({ ...base, effectiveDate: "June" }).ok, false);
    assert.equal(validateBenchmark({ ...base, low: 8_000 }).ok, false);
    assert.equal(validateBenchmark({ ...base, sourceUrl: "javascript:alert(1)" }).ok, false);
    assert.equal(validateBenchmark({ ...base, category: "MAGIC" }).ok, false);
  });
});

// The nine confirmed review findings on PR #1175 (Codex reviews of f4fe6e2b
// and e7fbfd18), each pinned by behaviour. Tender money is kept in its own
// kind: a bid price, a client budget, a qualification threshold, a past
// contract value, a security, a rate and a currency never become one another.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { estimateTenderPrice, statedBudget, statedOfferCurrency, type PricingEvidenceInput } from "../lib/engine/pricing-intelligence";
import { marketOf, findBenchmark, type PricingBenchmark } from "../lib/engine/pricing-benchmarks";
import { buildOwnerAttachmentChecklist } from "../lib/engine/owner-attachment-checklist";
import { scrubPricingLeakageSentences } from "../lib/ai";
import { isProviderConfigured, providerAutomaticEligibility } from "../lib/ai-provider-registry";
import { editedLine, ownerEdit, pricedLineAmount, computeWorkbookTotals, MAX_PRICED_QUANTITY } from "../lib/engine/priced-line-amount";

const NOW = new Date("2026-10-07T00:00:00Z");
const base = (overrides: Partial<PricingEvidenceInput> = {}): PricingEvidenceInput => ({
  tender: { id: "t", title: "Feasibility study for rural water supply", country: "Kenya", category: "FEASIBILITY_STUDY", currency: null, budget: null },
  tenderText: "The assignment shall be completed within four (4) months. Two validation workshops will be held.",
  experts: [{ id: "e1", name: "A", title: "Team Leader", yearsExperience: 15 }],
  historicalProjects: [],
  priorRates: [],
  companyDefaultCurrency: null,
  now: NOW,
  ...overrides,
});

describe("1. the offer currency comes only from the tender's own price-currency instruction", () => {
  it("an ETB turnover threshold, a USD bid security and a USD budget do not set the offer currency or Ethiopian VAT", () => {
    const est = estimateTenderPrice(base({
      tenderText: `${base().tenderText} The bidder shall have an average annual turnover of ETB 50 million. A bid security of USD 20,000 shall accompany the bid. The available budget is USD 250,000.`,
      companyDefaultCurrency: "KES",
    }));
    assert.equal(est.currency, "KES", est.currencyBasis);
    assert.notEqual(est.vatPercent, 15, "no Ethiopian VAT for a Kenyan tender that mentions Birr");
    assert.match(est.currencyBasis, /firm's default/);
  });
  it("the tender's explicit instruction decides it", () => {
    for (const [text, code] of [
      ["Prices shall be quoted in Kenya Shillings.", "KES"],
      ["The financial proposal shall be in ETB inclusive of 15% VAT.", "ETB"],
      ["Bidders shall quote their prices in US Dollars.", "USD"],
      ["Currency of the bid: EUR.", "EUR"],
      ["Unit Price (ETB) | Total Price (ETB)", "ETB"],
    ] as const) {
      const found = statedOfferCurrency(text);
      assert.ok(found && "currency" in found && found.currency === code, `${text} → ${JSON.stringify(found)}`);
      assert.equal(estimateTenderPrice(base({ tenderText: `${base().tenderText} ${text}` })).currency, code, text);
    }
  });
  it("incidental figures name no offer currency, and two different instructions decide nothing", () => {
    for (const text of [
      "The bidder shall have an average annual turnover of ETB 50 million.",
      "A bid security of USD 20,000 shall accompany the bid.",
      "Two similar contracts, each with a value of USD 1,000,000.",
      "The available budget is USD 250,000.",
      "VAT at 15% applies, e.g. ETB 1,500 on ETB 10,000.",
    ]) assert.equal(statedOfferCurrency(text), null, text);
    assert.deepEqual(statedOfferCurrency("Prices shall be quoted in USD. The financial proposal shall be in ETB."), { conflict: ["USD", "ETB"] });
  });
  it("an Ethiopian tender with no instruction is priced in its national currency, and a budget in another currency is not a ceiling", () => {
    const est = estimateTenderPrice(base({ tender: { ...base().tender, country: "Ethiopia" }, tenderText: `${base().tenderText} The available budget is USD 250,000.` }));
    assert.equal(est.currency, "ETB");
    assert.equal(est.budget, null);
  });
});

describe("2. a quantity or rate the owner types is used or refused — never silently replaced", () => {
  it("positive is accepted, zero, negative and unreadable are invalid, empty is no edit", () => {
    assert.deepEqual(ownerEdit("12", MAX_PRICED_QUANTITY), { kind: "VALUE", value: 12 });
    assert.deepEqual(ownerEdit("1,250", MAX_PRICED_QUANTITY), { kind: "VALUE", value: 1250 });
    for (const bad of ["0", 0, "-3", -3, "abc", Number.NaN]) assert.deepEqual(ownerEdit(bad as never, MAX_PRICED_QUANTITY), { kind: "INVALID" }, String(bad));
    for (const none of ["", "  ", undefined, null]) assert.deepEqual(ownerEdit(none as never, MAX_PRICED_QUANTITY), { kind: "NONE" });
  });
  it("an edited line with a zero or negative quantity is flagged, not priced at the estimate's quantity", () => {
    const line = { quantity: 40, unit: "DAY", rate: 6_000 };
    assert.equal(editedLine(line, undefined, "0").invalid, true);
    assert.equal(editedLine(line, undefined, "0").amount, null);
    assert.equal(editedLine(line, undefined, "-5").invalid, true);
    assert.equal(editedLine(line, "-100", undefined).invalid, true);
    assert.equal(editedLine({ quantity: 1, unit: "LUMP_SUM", rate: 9_000 }, undefined, "3").invalid, true, "a lump sum is one item");
  });
  it("the server validates the same way and names the explicit exclusion", () => {
    const src = readFileSync("lib/engine/pricing-approval.ts", "utf8");
    assert.match(src, /code: "PRICING_INVALID_EDIT"/);
    assert.match(src, /untick it/);
    const route = readFileSync("app/api/tenders/[id]/pricing/approve/route.ts", "utf8");
    assert.doesNotMatch(route, /Number\.isFinite\(n\)\) out\[key\] = n/, "the route no longer drops an unreadable edit");
    const panel = readFileSync("components/pricing-intelligence-panel.tsx", "utf8");
    assert.doesNotMatch(panel, /Number\(v\) > 0/, "the page no longer drops a non-positive edit");
    assert.match(panel, /disabled=\{busy \|\| adjusted\.unpriced > 0 \|\| adjusted\.invalid > 0\}/);
  });
});

describe("3. a tender-issued form goes inside a required single combined file", () => {
  it("combined PDF + tender form + manual original + proposal pages: one ordered assembly", () => {
    const list = buildOwnerAttachmentChecklist({
      requirements: [
        { id: "r1", title: "Format", description: "One PDF file named Proposal.pdf containing the technical proposal, all forms and all annexes. Attach the company registration certificate.", requirementType: "SUBMISSION_RULE", priority: "MANDATORY" },
        { id: "r2", title: "Bid Submission Form", description: "Complete and sign the Bid Submission Form provided in Section 4.", requirementType: "FORM", priority: "MANDATORY", exactFileName: "Bid Submission Form.pdf" },
      ] as never,
      declaredFileNames: ["Proposal.pdf"],
      vaultDocuments: [], selectedExpertSourceDocumentIds: [], selectedProjectSourceDocumentIds: [], boundHashes: [],
      formsAwaitingOriginal: [{ fileName: "Bid Submission Form.pdf", documentType: "FORM" }] as never,
    });
    assert.equal(list.mode, "COMBINED_FILE");
    const form = list.items.find((i) => i.kind === "Tender-issued form")!;
    assert.match(form.location, /^Inside "Proposal\.pdf", after the proposal pages, as Annex \d+ \("Bid Submission Form\.pdf"\)$/);
    assert.match(form.ownerAction, /insert it into "Proposal\.pdf" as Annex \d+/);
    assert.doesNotMatch(`${form.location} ${form.ownerAction}`, /envelope/i);
    assert.deepEqual(list.items.map((i) => i.order), list.items.map((_, n) => n + 1), "one continuous annex order");
    assert.ok(list.items.every((i) => i.location.startsWith('Inside "Proposal.pdf"')));
    assert.equal(form.status, "OWNER_TO_ATTACH", "the assembled submission is not claimed complete");
  });
});

describe("4. a country's rates never price another country's tender — for any country", () => {
  it("any country resolves to its own market", () => {
    for (const [name, code] of [["Nigeria", "NG"], ["Ghana", "GH"], ["India", "IN"], ["Peru", "PE"], ["Federal Republic of Nigeria", "NG"], ["Niger", "NE"], ["South Sudan", "SS"], ["Côte d'Ivoire", "CI"], ["Myanmar", "MM"], ["Ethiopia", "ET"], ["KE", "KE"]] as const) {
      assert.equal(marketOf(name), code, name);
    }
    assert.equal(marketOf("Atlantis"), "ATLANTIS", "an unknown name is a market of its own, never another's");
    assert.equal(marketOf(""), null);
  });
  it("a Ghanaian rate does not price a Nigerian tender in the same currency; a Nigerian one does", () => {
    const transport = (country: string) => ({ label: "Field transport (vehicle with driver and fuel)", category: "TRAVEL", unit: "DAY", rate: 90_000, currency: "NGN", date: "2026-06-01", country });
    const nigeria = (country: string) => estimateTenderPrice(base({
      tender: { ...base().tender, country: "Nigeria", currency: "NGN" },
      tenderText: "The assignment shall be completed within four (4) months. The consultant will conduct field visits to the project sites.",
      priorRates: [transport(country)],
    }));
    assert.equal(nigeria("Ghana").scenarios[1]!.lines.find((l) => l.key === "field-transport")!.rate, null);
    assert.equal(nigeria("Nigeria").scenarios[1]!.lines.find((l) => l.key === "field-transport")!.rate, 90_000);
  });
  it("a benchmark from one market is not found for another", () => {
    const bm = { id: "gh", origin: "OWNER", market: "GH", category: "TRANSPORT", serviceKey: "field_transport", unit: "DAY", currency: "USD", low: 80, median: 90, high: 100 } as unknown as PricingBenchmark;
    assert.equal(findBenchmark([bm], { category: "TRANSPORT", serviceKey: "field_transport", unit: "DAY", currency: "USD", market: marketOf("Nigeria") }), null);
    assert.ok(findBenchmark([bm], { category: "TRANSPORT", serviceKey: "field_transport", unit: "DAY", currency: "USD", market: marketOf("Ghana") }));
  });
  it("a rate from a tender with no recorded country is not filed into a market", () => {
    const src = readFileSync("lib/engine/pricing-approval.ts", "utf8");
    assert.match(src, /request\.saveToRateCard && estimate\.market/);
    assert.doesNotMatch(src, /estimate\.market \?\? "ET"/);
  });
});

describe("5. prose in a table is never read as a currency", () => {
  it("'all 3', 'for all items', 'and', 'per' survive the technical-envelope cleanup", () => {
    for (const row of [
      "| Phase | Supports all 3 phases | Note |",
      "| Scope | Covers all 12 sites and all 3 regions | Yes |",
      "| Item | For all items per 3 days and 5 visits | Note |",
      "| Task | Top 3 risks and try 2 options | Pen 4 notes |",
    ]) assert.equal(scrubPricingLeakageSentences(row, { keepTableRows: true }), row, row);
  });
  it("a real amount in a prose cell is still removed", () => {
    assert.equal(scrubPricingLeakageSentences("| Project | Dessie Hospital Project, USD 19M, delivered design | 2021 |", { keepTableRows: true }), "| Project | Dessie Hospital Project, delivered design | 2021 |");
  });
});

describe("6. an edited line shows, approves and prints one amount", () => {
  it("the edited amount is quantity × rate, by the same function the workbook and financial proposal use", () => {
    const line = { quantity: 40, unit: "DAY", rate: 6_000 };
    const edited = editedLine(line, "6,250.50", "33");
    assert.equal(edited.amount, pricedLineAmount(33, 6_250.5));
    assert.equal(edited.amount, 206_266.5);
    const totals = computeWorkbookTotals([{ category: "PERSONNEL", label: "x", quantity: 33, unit: "DAY", rate: 6_250.5 }], { vatPercent: 15, contingencyPct: 5, withholdingPct: 0 });
    assert.equal(totals.subtotal, 206_266.5);
  });
  it("the panel shows the edited amount, not the estimate's", () => {
    const panel = readFileSync("components/pricing-intelligence-panel.tsx", "utf8");
    assert.match(panel, /edited\[l\.key\]\?\.amount == null \? "—"/);
    assert.doesNotMatch(panel, /\{l\.amount === null \? "—" : l\.amount\.toLocaleString/);
    assert.match(readFileSync("lib/engine/financial-proposal.ts", "utf8"), /from "\.\/priced-line-amount"/);
  });
});

describe("7. Groq is used for AI Analyze when its analysis model is configured", () => {
  const env = { GROQ_API_KEY: "gsk_test", GROQ_ANALYSIS_MODEL: "llama-3.3-70b-versatile" } as unknown as NodeJS.ProcessEnv;
  it("eligible for extraction, not for proposal writing it has no model for", () => {
    assert.equal(isProviderConfigured("groq", env, "extraction"), true);
    assert.equal(providerAutomaticEligibility("groq", env, "extraction").eligible, true);
    assert.equal(isProviderConfigured("groq", env, "proposal"), false);
    assert.equal(providerAutomaticEligibility("groq", env, "proposal").reason, "NOT_CONFIGURED");
    assert.equal(isProviderConfigured("groq", { GROQ_API_KEY: "gsk_test" } as never, "extraction"), false, "no model, no call");
  });
  it("the AI Analyze chain and every call ask for their own use case", () => {
    const ai = readFileSync("lib/ai.ts", "utf8");
    assert.match(ai, /providerAutomaticEligibility\(name, process\.env, useCase\)/);
    assert.match(ai, /const eligibility = providerAutomaticEligibility\(provider, process\.env, useCase\);/);
    assert.match(ai, /const configured = isProviderEnabled\(provider, useCase\);/);
    assert.match(ai, /isProviderEnabled\(provider, "extraction"\)/);
    assert.equal((ai.match(/providerAutomaticEligibility\(provider, process\.env, "proposal"\)/g) ?? []).length, 2, "both proposal-writing chains");
  });
});

describe("8. a past contract is a pricing comparable only when it is about the same work", () => {
  const project = (name: string, sector: string, serviceAreas: string[]) => ({
    name, sector, serviceAreas, contractValue: 6_000_000, currency: "ETB",
    startDate: "2024-01-01", endDate: "2024-05-01", selected: false,
  });
  const estimate = (projects: ReturnType<typeof project>[]) => estimateTenderPrice(base({ tender: { ...base().tender, country: "Ethiopia" }, historicalProjects: projects }));
  it("one shared generic or task word is not similarity", () => {
    const est = estimate([
      project("Building supervision services", "Buildings", ["Construction supervision"]),
      project("Hospital design consultancy", "Health", ["Design"]),
      project("Capacity development project", "Governance", ["Training"]),
    ]);
    assert.equal(est.envelope, null, "no envelope from unrelated contracts");
    assert.ok(!est.scenarios.some((sc) => sc.lines.some((l) => /past contract/i.test(l.rateBasis))));
  });
  it("a contract about the same subject and task is used", () => {
    const est = estimate([project("Water supply feasibility study", "Water supply", ["Feasibility study"])]);
    assert.ok(est.envelope, "a related contract still sets the envelope");
    assert.equal(est.envelope!.comparables.length, 1);
  });
  it("a weak match is named, not silently used", () => {
    const est = estimate([project("Water treatment plant", "Industry", ["Operation"])]);
    assert.equal(est.envelope, null);
    assert.ok(est.lowConfidence.some((s) => /share only "water"/.test(s)), est.lowConfidence.join(" | "));
  });
});

describe("9. a qualification threshold is never the client's budget", () => {
  it("thresholds, securities, turnover, insurance, past values and examples are not budgets", () => {
    for (const text of [
      "The bidder shall have completed two similar contracts, each with an estimated contract value of USD 1,000,000.",
      "Contracts with a value of at least USD 1,000,000 in the last five years.",
      "Minimum average annual turnover of USD 2,000,000 over three years.",
      "A bid security of USD 20,000 shall accompany the bid.",
      "A performance security of 10% of the contract price, not less than USD 50,000.",
      "Professional liability insurance of not less than USD 500,000.",
      "Past project value: ETB 30 million (completed 2021).",
      "Expert remuneration, for example USD 5,000 per month, shall be justified.",
    ]) assert.equal(statedBudget(text), null, text);
  });
  it("budget and ceiling language is read, even after a threshold", () => {
    for (const [text, currency, amount] of [
      ["The maximum budget for the consultancy is ETB 3,500,000 inclusive of VAT.", "ETB", 3_500_000],
      ["The financial ceiling is USD 400,000.", "USD", 400_000],
      ["The maximum amount payable under the contract is KES 12,000,000.", "KES", 12_000_000],
      ["The total contract price shall not exceed USD 90,000.", "USD", 90_000],
      ["Budget: USD 250,000.", "USD", 250_000],
      ["Two similar contracts each with an estimated contract value of USD 1,000,000. The available budget for this assignment is USD 250,000.", "USD", 250_000],
    ] as const) {
      const b = statedBudget(text);
      assert.ok(b, text);
      assert.equal(b!.currency, currency, text);
      assert.equal(b!.amount, amount, text);
    }
  });
  it("a threshold does not cap the estimate", () => {
    const est = estimateTenderPrice(base({ tender: { ...base().tender, country: "Ethiopia" }, tenderText: `${base().tenderText} The financial proposal shall be in ETB. Two similar contracts, each with an estimated contract value of ETB 1,000,000.` }));
    assert.equal(est.budget, null);
  });
});

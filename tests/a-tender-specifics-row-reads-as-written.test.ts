/**
 * The tender-specifics table quotes the tender cleanly.
 *
 * 2026-10-05 hands-off acceptance (office-design EOI): the Section C table read
 * "Distinctive Tender Quantities | 454 sqm) in Addis Ababa (ce space (" — the
 * quantity pattern swallowed 60 trailing characters into the value and a fixed
 * 10-character window cut the context mid-word — and "Tender / RFP Reference |
 * RFQ# 2026-024, 2026-024", the grounded reference beside a regex match of its
 * own digits.
 *
 * Generic fixture: a water-utility depot design RFQ.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractTenderFacts, buildTenderSpecificsBlock } from "../lib/engine/tender-facts-extractor";

const TENDER = [
  "Request for Quotation RFQ No. WU/2031-118",
  "The Riverbend Water Utility invites firms to design a maintenance depot of 1,200 sqm and a staff office space (380 sqm) in Riverbend Town. The works include 4 workshop bays.",
  "The assignment shall be completed within 90 calendar days of contract signature.",
].join("\n");

describe("tender-specifics quantities", () => {
  it("keeps the value to the number and unit, and reads its context from whole words with balanced brackets", () => {
    const facts = extractTenderFacts(TENDER, { referenceNumber: "RFQ No. WU/2031-118" } as never);
    const office = facts.quantities.find((q) => q.value === "380 sqm");
    assert.ok(office, JSON.stringify(facts.quantities));
    assert.equal(office.context, "a staff office space 380 sqm in Riverbend Town");
    const depot = facts.quantities.find((q) => q.value === "1,200 sqm");
    assert.ok(depot, `thousands separator lost: ${JSON.stringify(facts.quantities)}`);
    for (const q of facts.quantities) {
      assert.doesNotMatch(q.value, /[()]|\s(?:in|and|of)\s/, `value carries prose: ${q.value}`);
      const opens = (q.context.match(/\(/g) ?? []).length;
      const closes = (q.context.match(/\)/g) ?? []).length;
      assert.equal(opens, closes, `unbalanced context: ${q.context}`);
      const [firstWord] = q.context.split(" ");
      assert.match(TENDER, new RegExp(`(?:^|[\\s(])${firstWord}\\b`), `context starts mid-word: ${q.context}`);
    }
  });

  it("renders a quantities row with no stray brackets", () => {
    const block = buildTenderSpecificsBlock(extractTenderFacts(TENDER));
    const row = block.split("\n").find((line) => /Distinctive Tender Quantities/.test(line)) ?? "";
    assert.ok(row, block);
    assert.match(row, /“a staff office space 380 sqm in Riverbend Town”/);
    assert.doesNotMatch(row, /\(\)|\(\s*\(|\)\s*\)/);
  });
});

describe("tender-specifics reference", () => {
  it("does not list the grounded reference beside its own unlabelled digits", () => {
    const facts = extractTenderFacts(`${TENDER}\nQuote reference 2031-118 on every page.`, { referenceNumber: "RFQ No. WU/2031-118" } as never);
    assert.deepEqual(facts.rfpIds.filter((id) => /2031-118/.test(id)), ["RFQ No. WU/2031-118"]);
  });

  it("keeps two genuinely different references", () => {
    const facts = extractTenderFacts(`${TENDER}\nThis RFQ replaces RFQ No. WU/2031-11 which was cancelled.`, { referenceNumber: "RFQ No. WU/2031-118" } as never);
    assert.ok(facts.rfpIds.includes("RFQ No. WU/2031-118"), JSON.stringify(facts.rfpIds));
    assert.ok(facts.rfpIds.some((id) => /2031-11$/.test(id)), `a different reference was dropped: ${JSON.stringify(facts.rfpIds)}`);
  });
});

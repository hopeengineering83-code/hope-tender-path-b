// A model-written section is kept only if it would pass the final gate.
//
// Run 36037462010 (2026-09-24): with partial fallbacks now kept, a model
// section copied the owner's own vault-document heading ("Tender Proposal
// AI-Ready Summary — Prepared for AI-assisted tender proposal generation")
// and mentioned the firm's prices, and the whole proposal failed the final
// quality gate at score 68. The section writer now applies the gate's own
// client-safety rules per section: metadata lines are scrubbed, and a section
// that still carries an AI trace or own-price mentions takes its
// deterministic text instead.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { clientSafeModelSection, MAX_OWN_PRICE_MENTIONS_PER_SECTION } from "../lib/ai";
import { countOwnPriceMentions, scrubOwnPriceSentences, scrubSourceDocumentMetadata } from "../lib/engine/detection-patterns";
import { validateGeneratedDocumentQuality } from "../lib/document-generation/generated-document-quality-validator";

describe("source-document metadata is scrubbed, not shipped", () => {
  it("removes the vault heading lines and keeps the rest", () => {
    const md = [
      "## Company Overview",
      "Tender Proposal AI-Ready Summary",
      "Prepared for AI-assisted tender proposal generation.",
      "The firm has delivered 100 projects across Ethiopia.",
    ].join("\n");
    const out = scrubSourceDocumentMetadata(md);
    assert.doesNotMatch(out, /AI-Ready Summary|AI-assisted/i);
    assert.match(out, /delivered 100 projects/);
    assert.match(out, /## Company Overview/);
  });

  it("a section whose only problem was the heading is kept, cleaned", () => {
    const r = clientSafeModelSection("## A\nTender Proposal AI-Ready Summary\nSolid methodology text.");
    assert.equal(r.ok, true);
    assert.doesNotMatch(r.markdown, /AI-Ready/);
  });
});

describe("a section the gate would reject is not kept", () => {
  it("rejects a section with an AI trace", () => {
    const r = clientSafeModelSection("As an AI language model, I cannot confirm the dates.");
    assert.equal(r.ok, false);
    assert.match(String(r.reason), /AI trace/);
  });

  it("drops the firm's own price sentences and keeps the rest of the section", () => {
    // Run 36041511483: a whole model-written cover section was rejected over
    // two price sentences. The sentences go; the section stays.
    const md = "We will mobilise within two weeks. Our fee is USD 40,000. The design team is led by a registered architect.";
    assert.ok(countOwnPriceMentions(md) > MAX_OWN_PRICE_MENTIONS_PER_SECTION);
    const r = clientSafeModelSection(md);
    assert.equal(r.ok, true);
    assert.doesNotMatch(r.markdown, /USD|fee/);
    assert.match(r.markdown, /mobilise within two weeks/);
    assert.match(r.markdown, /registered architect/);
  });

  it("drops a price table row whole", () => {
    const md = "| Item | Value |\n|---|---|\n| Lump sum fee | USD 40,000 |\n| Team | 12 experts |";
    const out = scrubOwnPriceSentences(md);
    assert.doesNotMatch(out, /Lump sum/);
    assert.match(out, /12 experts/);
  });

  it("does not count reference-project costs or a no-offer disclaimer as prices", () => {
    const md = "Comparable project: construction cost ETB 550,074,678. This is a technical proposal only; no financial offer is included.";
    assert.equal(countOwnPriceMentions(md), 0);
    assert.equal(clientSafeModelSection(md).ok, true);
  });
});

describe("one definition of own-price contamination", () => {
  it("the final validator and the section guard share countOwnPriceMentions", () => {
    const validator = readFileSync("lib/document-generation/generated-document-quality-validator.ts", "utf8");
    assert.match(validator, /countOwnPriceMentions\(documentText\)/);
    const ai = readFileSync("lib/ai.ts", "utf8");
    assert.match(ai, /const safe = clientSafeModelSection\(r\.markdown\)/);
  });

  it("the final validator still blocks more than 3 own-price mentions", () => {
    const text = "## Technical Proposal\n" + "Our fee is USD 10,000. ".repeat(5);
    const r = validateGeneratedDocumentQuality(
      text,
      "TECHNICAL_PROPOSAL",
      { selectedExperts: [], selectedProjects: [] } as any,
      [],
      [],
    );
    assert.ok(r.finalBlockers.some((b) => /Financial content detected/.test(b)), JSON.stringify(r.finalBlockers));
  });
});

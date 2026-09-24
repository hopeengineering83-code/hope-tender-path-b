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
    // The section's unsupported credentials are removed first, then the same
    // guard decides; the guard is still what keeps or replaces the section.
    assert.match(ai, /const credentials = scrubUngroundedCompanyCredentials\(r\.markdown, companyGroundingText\(input\)\)/);
    assert.match(ai, /const safe = clientSafeModelSection\(credentials\.markdown\)/);
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

describe("the final gate's unproven-claim rule applies per section, and the prompts stop asking for it", () => {
  // Run 36047880422: the first model-written section in weeks followed its
  // prompt ("We have already delivered this assignment ... The same team is
  // available for this engagement") and the final gate refused the whole
  // proposal at UNSUPPORTED_CLAIM_RISK [HIGH] for that sentence.
  it("drops the claim sentence and keeps the section", () => {
    const md = "We have already delivered this assignment. The firm designed the G+6 hospital in 2018. The same project team is proposed for this engagement.";
    const r = clientSafeModelSection(md);
    assert.equal(r.ok, true, String(r.reason));
    assert.doesNotMatch(r.markdown, /already delivered this assignment|same project team/i);
    assert.match(r.markdown, /designed the G\+6 hospital/);
  });

  it("drops a table row or heading carrying the claim, and a phantom attachment", () => {
    const md = "## Why us\n| Claim | Proof |\n|---|---|\n| Directly comparable assignment | Project X |\n| Team | 8 experts |\nCertificates are provided as Appendix A. We deliver on time.";
    const r = clientSafeModelSection(md);
    assert.equal(r.ok, true);
    assert.doesNotMatch(r.markdown, /Directly comparable assignment|Appendix A/);
    assert.match(r.markdown, /8 experts/);
    assert.match(r.markdown, /We deliver on time/);
  });

  it("the final gate and the section guard share one definition", () => {
    const gate = readFileSync("lib/engine/document-quality-gate.ts", "utf8");
    assert.match(gate, /import \{ UNPROVEN_RELATIONSHIP_CLAIM_PATTERNS, PHANTOM_ATTACHMENT_CLAIM \} from "\.\/detection-patterns"/);
    assert.doesNotMatch(gate, /const UNPROVEN_RELATIONSHIP_CLAIM_PATTERNS/);
  });

  it("no writer prompt or template asks for the claim the gate refuses", () => {
    for (const file of ["lib/ai.ts", "lib/engine/proposal-intelligence.ts", "lib/engine/proposal-sections.ts", "lib/engine/evidence-marker-injector.ts", "lib/engine/benchmark-tables.ts"]) {
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /Lead sentence: "We have already delivered this assignment/, file);
      assert.doesNotMatch(src, /must (?:open|lead) with:? ['"]We have already delivered/, file);
      assert.doesNotMatch(src, /End with "the same team is proposed/, file);
      assert.doesNotMatch(src, /is the strongest line a cover letter can carry/, file);
      assert.doesNotMatch(src, /same scope, same lead team|same team and methodology applicable/, file);
      assert.doesNotMatch(src, /has already delivered this assignment\.\*\*/, file);
    }
  });
});

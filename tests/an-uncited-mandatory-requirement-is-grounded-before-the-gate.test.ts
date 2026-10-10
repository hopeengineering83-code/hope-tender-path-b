// 2026-09-29, Preview, a new tender: AI Analyze succeeded and was then refused
// at promotion because 6 mandatory requirements came back without a usable
// citation (a paraphrased quote, a missing page). Run Engine's grounding
// repair would have found them in the tender text, but it runs after
// promotion, so it never got the chance. The promotion gate now runs the same
// matcher first and accepts only a passage verbatim in an active file.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { groundRequirementInActiveFiles } from "../lib/engine/repair-source-grounding";

const text = [
  "INVITATION FOR BIDS\nRehabilitation of the District Road Network\nThe Roads Authority invites sealed bids from eligible contractors.\n" + "Background on the network, its traffic counts and its condition survey. ".repeat(12),
  "SECTION 2 — ELIGIBILITY\nBidders shall submit a valid trade licence and a tax clearance certificate issued within the last twelve months.\nBidders shall provide evidence of at least two similar road rehabilitation contracts completed in the last five years.\n" + "General conditions of eligibility apply as published by the procuring entity. ".repeat(10),
  "SECTION 3 — SUBMISSION\nBids shall be delivered to the Procurement Office before 10:00 on the closing date.",
].join("\f");
const files = [{ id: "file-1", extractedText: text, totalPages: 3 }];

describe("an uncited mandatory requirement is grounded before the promotion gate", () => {
  it("finds the passage that states the requirement, with its page", () => {
    const hit = groundRequirementInActiveFiles(
      { title: "Valid Trade Licence and Tax Clearance", description: "Submit a valid trade licence and a tax clearance certificate." },
      files,
    );
    assert.ok(hit, "grounded");
    assert.equal(hit!.fileId, "file-1");
    assert.equal(hit!.page, 2);
    assert.ok(text.includes(hit!.quote), "the quote is verbatim source text");
    assert.match(hit!.quote, /trade licence/i);
  });

  it("re-locates a model quote that is verbatim but carried no page", () => {
    const hit = groundRequirementInActiveFiles(
      { title: "Delivery", description: "", sourceQuote: "Bids shall be delivered to the Procurement Office" },
      files,
    );
    assert.equal(hit?.page, 3);
  });

  it("does not invent a source for a requirement the tender does not state", () => {
    const hit = groundRequirementInActiveFiles(
      { title: "Environmental Impact Assessment Certificate", description: "Provide an ISO 14001 environmental management certificate." },
      files,
    );
    assert.equal(hit, null);
  });

  it("the promotion gate uses it before refusing", () => {
    const src = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    const repair = src.indexOf("groundRequirementInActiveFiles(req, activeFilesForGrounding)");
    const gate = src.indexOf("const invalidMandatory = mandatoryReqs.filter");
    assert.ok(repair > 0 && gate > 0 && repair < gate);
  });
});

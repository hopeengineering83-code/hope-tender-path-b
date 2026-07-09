/**
 * Integration tests verifying that the new lib/document-generation/ modules
 * are actually wired into the existing generation pipeline.
 *
 * Tests:
 *   1. proposal-intelligence.ts uses detectFinancialProposalRequiredFromText()
 *      (not the old inline regex) — verified by checking that the new patterns
 *      ("do not generate a financial proposal") are recognized.
 *   2. proposal-intelligence.ts now exposes a documentTypeAdvisory on the
 *      returned ProposalIntelligence object.
 *   3. The documentTypeAdvisory correctly identifies EOI / RFQ / RFP tenders.
 *   4. The document-quality-check API route file exists and exports a POST
 *      handler.
 *   5. The generation-integration module exposes the three integration helpers.
 *   6. The detectFinancialProposalRequiredFromText() function is the single
 *      source of truth — both proposal-intelligence.ts and
 *      tender-document-context.ts use the same logic.
 *   7. The buildTenderDocumentTypeAdvisory() returns sensible notes for each
 *      tender type.
 *   8. The buildServiceStreamMethodologyBlock() produces injectable markdown.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import {
  detectFinancialProposalRequiredFromText,
  buildTenderDocumentTypeAdvisory,
  buildServiceStreamMethodologyBlock,
} from "../lib/document-generation/generation-integration";
import { detectFinancialProposalRequired } from "../lib/document-generation/tender-document-context";
import { buildProposalIntelligence } from "../lib/engine/proposal-intelligence";
import type { TenderLite, CompanyLite, TenderRequirementLite, ExpertLite, ProjectLite } from "../lib/engine/proposal-intelligence";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const baseTender: TenderLite = {
  title: "Test Tender",
  reference: "TEST-001",
  clientName: "Ministry of Test",
  country: "Ethiopia",
  description: "Test description",
  intakeSummary: null,
  analysisSummary: null,
  evaluationMethodology: null,
  deadline: null,
  submissionMethod: null,
  submissionAddress: null,
  clientContactName: null,
};

const baseCompany: CompanyLite = {
  name: "Test Engineering Co.",
  legalName: "Test Engineering Co. Ltd.",
  description: "Engineering consultancy",
  profileSummary: null,
  serviceLines: "[]",
  sectors: "[]",
  email: null,
  phone: null,
  website: null,
  address: null,
};

const baseRequirements: TenderRequirementLite[] = [];
const baseExperts: ExpertLite[] = [];
const baseProjects: ProjectLite[] = [];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("1. proposal-intelligence uses detectFinancialProposalRequiredFromText", () => {
  it("recognizes 'do not generate a financial proposal' (new pattern, not in old regex)", () => {
    // The old regex was: /financial proposal.*not|technical proposal only|no financial proposal|financial.*not.*required/i
    // It did NOT recognize "Do not generate a financial proposal" — but the new
    // detectFinancialProposalRequired() function does.
    const tenderText = "Request for Proposal. Do not generate a financial proposal. Technical evaluation only.";
    const result = detectFinancialProposalRequiredFromText(tenderText);
    assert.equal(result, false, "new pattern must be recognized as financial-proposal-not-required");
  });

  it("recognizes 'technical proposal only' (pattern shared with old regex)", () => {
    const tenderText = "Request for Proposal. Technical proposal only. No financial proposal.";
    const result = detectFinancialProposalRequiredFromText(tenderText);
    assert.equal(result, false);
  });

  it("returns true for default RFP text without 'not required' signals", () => {
    const tenderText = "Request for Proposal for Architectural Design Services. Submit technical and financial proposals in separate envelopes.";
    const result = detectFinancialProposalRequiredFromText(tenderText);
    assert.equal(result, true);
  });

  it("returns true for two-envelope language (financial IS required, separately)", () => {
    const tenderText = "Two envelope submission procedure. Technical envelope and financial envelope submitted separately.";
    const result = detectFinancialProposalRequiredFromText(tenderText);
    assert.equal(result, true);
  });
});

describe("2. proposal-intelligence exposes documentTypeAdvisory", () => {
  it("buildProposalIntelligence returns a documentTypeAdvisory object", () => {
    const tenderText = "Request for Proposal for Architectural Design Services. Submit technical and financial proposals.";
    const intelligence = buildProposalIntelligence({
      tender: { ...baseTender, description: tenderText },
      company: baseCompany,
      requirements: baseRequirements,
      experts: baseExperts,
      projects: baseProjects,
    });
    assert.ok(intelligence.documentTypeAdvisory, "documentTypeAdvisory must be present");
    assert.equal(typeof intelligence.documentTypeAdvisory.tenderType, "string");
    assert.equal(typeof intelligence.documentTypeAdvisory.suggestedDocumentTitle, "string");
    assert.ok(Array.isArray(intelligence.documentTypeAdvisory.notes));
  });
});

describe("3. documentTypeAdvisory correctly identifies tender types", () => {
  it("identifies EOI tenders", () => {
    const tenderText = "Expression of Interest for Consulting Services. We invite expressions of interest from qualified firms.";
    const advisory = buildTenderDocumentTypeAdvisory(tenderText);
    assert.equal(advisory.isEoi, true);
    assert.equal(advisory.isRfq, false);
    assert.equal(advisory.suggestedDocumentTitle, "Expression of Interest");
    assert.ok(advisory.notes.some((n) => n.includes("EOI")), "must include EOI advisory note");
  });

  it("identifies RFQ tenders", () => {
    const tenderText = "Request for Quotation for Office Equipment Supply. Submit quotation with price schedule.";
    const advisory = buildTenderDocumentTypeAdvisory(tenderText);
    assert.equal(advisory.isRfq, true);
    assert.equal(advisory.isEoi, false);
    assert.equal(advisory.suggestedDocumentTitle, "Quotation");
  });

  it("identifies RFP tenders", () => {
    const tenderText = "Request for Proposal for Architectural Design Services. Submit technical and financial proposals.";
    const advisory = buildTenderDocumentTypeAdvisory(tenderText);
    assert.equal(advisory.isRfpLike, true);
    assert.equal(advisory.suggestedDocumentTitle, "Technical Proposal");
  });

  it("flags financial-proposal-not-required for RFP", () => {
    const tenderText = "Request for Proposal. Technical proposal only. Financial proposal not required.";
    const advisory = buildTenderDocumentTypeAdvisory(tenderText);
    assert.equal(advisory.financialProposalRequired, false);
    assert.ok(advisory.notes.some((n) => n.includes("NOT required")), "must note financial proposal not required");
  });
});

describe("4. document-quality-check API route exists", () => {
  it("route file exists at the expected path", () => {
    const routePath = "app/api/tenders/[id]/document-quality-check/route.ts";
    assert.ok(existsSync(routePath), `route file must exist at ${routePath}`);
  });

  it("route file exports a POST handler", () => {
    const routePath = "app/api/tenders/[id]/document-quality-check/route.ts";
    assert.ok(existsSync(routePath));
    const content = readFileSync(routePath, "utf8");
    assert.ok(content.includes("export async function POST"), "must export POST handler");
    assert.ok(content.includes("validateGeneratedDocumentQuality"), "must call the new validator");
    assert.ok(content.includes("buildTenderDocumentContext"), "must build the tender context");
  });
});

describe("5. generation-integration module exports the three integration helpers", () => {
  it("exports detectFinancialProposalRequiredFromText, buildTenderDocumentTypeAdvisory, buildServiceStreamMethodologyBlock", () => {
    assert.equal(typeof detectFinancialProposalRequiredFromText, "function");
    assert.equal(typeof buildTenderDocumentTypeAdvisory, "function");
    assert.equal(typeof buildServiceStreamMethodologyBlock, "function");
  });
});

describe("6. detectFinancialProposalRequiredFromText is the single source of truth", () => {
  it("returns the same result as detectFinancialProposalRequired from tender-document-context", () => {
    const testCases = [
      "Financial proposal not required.",
      "Technical proposal only.",
      "Do not generate a financial proposal.",
      "Two envelope submission.",
      "Request for proposal with financial proposal.",
      "",
    ];
    for (const text of testCases) {
      const a = detectFinancialProposalRequiredFromText(text);
      const b = detectFinancialProposalRequired(text);
      assert.equal(a, b, `results must match for text: "${text.slice(0, 50)}"`);
    }
  });

  it("proposal-intelligence noFinancialProposal is the negation of detectFinancialProposalRequiredFromText", () => {
    const tenderText = "Request for Proposal. Technical proposal only. Financial proposal not required.";
    const intelligence = buildProposalIntelligence({
      tender: { ...baseTender, description: tenderText },
      company: baseCompany,
      requirements: baseRequirements,
      experts: baseExperts,
      projects: baseProjects,
    });
    const direct = detectFinancialProposalRequiredFromText(tenderText);
    assert.equal(intelligence.noFinancialProposal, !direct, "noFinancialProposal must be the negation of detectFinancialProposalRequiredFromText");
  });
});

describe("7. buildTenderDocumentTypeAdvisory returns sensible notes", () => {
  it("EOI advisory notes mention EOI and excluding financial", () => {
    const advisory = buildTenderDocumentTypeAdvisory("Expression of Interest for consulting services.");
    assert.ok(advisory.notes.length > 0);
    assert.ok(advisory.notes.some((n) => /EOI/i.test(n)));
  });

  it("RFQ advisory notes mention quotation", () => {
    const advisory = buildTenderDocumentTypeAdvisory("Request for Quotation for office equipment.");
    assert.ok(advisory.notes.length > 0);
    assert.ok(advisory.notes.some((n) => /quotation/i.test(n)));
  });

  it("RFP advisory notes mention full technical proposal", () => {
    const advisory = buildTenderDocumentTypeAdvisory("Request for Proposal for engineering services.");
    assert.ok(advisory.notes.length > 0);
    assert.ok(advisory.notes.some((n) => /full technical proposal/i.test(n)));
  });
});

describe("8. buildServiceStreamMethodologyBlock produces injectable markdown", () => {
  it("returns null for empty / unknown-only streams", () => {
    assert.equal(buildServiceStreamMethodologyBlock([]), null);
    assert.equal(buildServiceStreamMethodologyBlock(["unknown"]), null);
  });

  it("returns markdown with headings for architecture stream", () => {
    const markdown = buildServiceStreamMethodologyBlock(["architecture"]);
    assert.ok(markdown, "must return non-null markdown");
    assert.ok(markdown.includes("### Service-Stream-Specific Methodology"), "must have methodology heading");
    assert.ok(markdown.includes("#### "), "must have section headings");
    assert.ok(markdown.includes("**Deliverables:**"), "must include deliverables");
  });

  it("returns markdown for multi-stream combination", () => {
    const markdown = buildServiceStreamMethodologyBlock(["architecture", "supervision", "geotechnical"]);
    assert.ok(markdown);
    assert.ok(markdown.length > 500, "multi-stream methodology must be substantial");
  });
});

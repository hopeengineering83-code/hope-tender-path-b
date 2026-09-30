/**
 * An EOI reads as the tender it answers.
 *
 * 2026-09-30, Preview, a telecom-tower EOI (inspect run 36745478019), the
 * delivered text:
 *  - addressed "Safaricom Telecommunications Ethiopia PLC is'" throughout
 *    (intake lifted the name from "… PLC is seeking …");
 *  - called itself a "Technical Proposal";
 *  - built methodology and Work Plan stages from declaration, audited-accounts
 *    and pricing rows, and planned "Regulatory Approval and Permit
 *    Documentation" because "arbitral award" matched a hospital "ward";
 *  - printed a construction-supervision phase table (payment certificates,
 *    variation orders) because no sector described tower work;
 *  - printed "Five reasons" over four, an empty A.2 table, an empty B.2,
 *    "Site / Location: Tower", and Section F locations no proposal has.
 *
 * Generic fixture: a communication-mast maintenance EOI.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { cleanClientName, withoutProvenanceTags } from "../lib/engine/proposal-labels";
import { buildSectionFallback, type ProposalSectionSpec } from "../lib/engine/proposal-sections";
import { inferSector } from "../lib/engine/proposal-intelligence";
import { canonicalWorkPlan } from "../lib/engine/canonical-work-plan";
import { buildWhyUsSummary } from "../lib/engine/why-us-summary";
import { dropEmptyTables } from "../lib/engine/placeholder-stripper";
import { buildProjectPortfolioCards } from "../lib/engine/benchmark-tables";
import { extractTenderFacts } from "../lib/engine/tender-facts-extractor";
import { inferProposalLocation } from "../lib/engine/compliance-matrix-builder";
import { buildCanonicalAnalysisTenderUpdate } from "../lib/engine/canonical-analysis-update";

const TENDER_TEXT = "Sample Networks PLC is seeking expressions of interest from suppliers for the inspection, structural analysis and strengthening of its communication masts. Suppliers must disclose any arbitral award against them. Site safety and health rules apply.";
const REQUIREMENTS = [
  "MANDATORY: Declaration of Non-Debarment and Eligibility — confirm the supplier is not debarred",
  "MANDATORY: Litigation History Disclosure — disclose court or arbitral awards",
  "MANDATORY: Audited Financial Statements — last three years",
  "SCORED: Exclusion of Pricing Information — no prices with this EOI",
  "SCORED: Previous Mast Maintenance Experience — similar contracts in five years",
].join("\n");

function writerInput(extra: Record<string, unknown> = {}) {
  return {
    tenderTitle: "Maintenance of Communication Masts",
    clientName: "Sample Networks PLC",
    tenderText: TENDER_TEXT,
    requirements: REQUIREMENTS,
    compliance: "", experts: "", projects: "", differentiators: "",
    companyVault: { name: "Sample Consultants PLC" },
    ...extra,
  } as never;
}

describe("the client is named, not the sentence it came from", () => {
  it("drops the source sentence's verb", () => {
    assert.equal(cleanClientName("Sample Networks PLC is"), "Sample Networks PLC");
    assert.equal(cleanClientName("Regional Water Bureau hereby invites"), "Regional Water Bureau");
    assert.equal(cleanClientName("Save the Children"), "Save the Children");
  });

  it("AI Analyze replaces an intake name that is its own name plus that verb, and keeps any other", () => {
    const base = { procuringEntityName: "Sample Networks PLC" } as never;
    const polluted = buildCanonicalAnalysisTenderUpdate(base, { clientName: "Sample Networks PLC is" });
    assert.equal(polluted.data.clientName, "Sample Networks PLC");
    const owner = buildCanonicalAnalysisTenderUpdate(base, { clientName: "Sample Networks (Operations)" });
    assert.equal(owner.data.clientName, undefined);
  });
});

describe("the document names itself", () => {
  it("an EOI's cover letter and declaration say Expression of Interest", () => {
    const cover = buildSectionFallback({ id: "cover-and-summary" } as ProposalSectionSpec, writerInput({ submissionDocumentLabel: "Expression of Interest" }));
    assert.match(cover, /Subject: Expression of Interest — /);
    assert.doesNotMatch(cover, /Technical Proposal/);
    assert.doesNotMatch(cover, /Section B/, "no project is on file, so no section presents one");
    const declaration = buildSectionFallback({ id: "additional-and-declaration" } as ProposalSectionSpec, writerInput({ submissionDocumentLabel: "Expression of Interest" }));
    assert.match(declaration, /this Expression of Interest has been prepared/);
  });
});

describe("Section C describes the work", () => {
  it("tower work has its own sector, phases and methodology", () => {
    const sector = inferSector(TENDER_TEXT);
    assert.equal(sector, "Telecom Tower & Mast Structural Engineering");
    const phases = canonicalWorkPlan({ sector }).map((row) => row.title).join(" | ");
    assert.match(phases, /Site Inspection and Condition Audit/);
    assert.doesNotMatch(phases, /Payment Certification|Variation Order|Pre-Construction/);
  });

  it("no declaration, accounts, pricing or experience row becomes a methodology stage", () => {
    const md = buildSectionFallback({ id: "technical-approach" } as ProposalSectionSpec, writerInput());
    const stages = md.split("\n").filter((line) => /^### C\.2\.\d|^\| \d+ — /.test(line)).join("\n");
    assert.doesNotMatch(stages, /Declaration|Disclosure|Audited|Pricing|Experience|Regulatory Approval/);
    assert.match(stages, /Structural Analysis and Capacity Assessment/);
  });
});

describe("no empty or miscounted content", () => {
  it("the reasons list counts itself", () => {
    const md = buildWhyUsSummary({
      companyName: "Sample Consultants PLC", clientName: "Sample Networks PLC", primarySector: "x",
      experts: [{ fullName: "A. Engineer", title: "Project Manager", disciplines: ["Architecture"] }] as never,
      projects: [], differentiators: ["In-house laboratory"],
    })!;
    const count = md.split("\n").filter((line) => /^\d+\. /.test(line)).length;
    assert.match(md, new RegExp(`^${["", "", "", "Three", "Four", "Five"][count]} reasons`, "m"));
    assert.match(md, /A\. Engineer \(Project Manager\) leads the proposed team/);
    assert.doesNotMatch(md, /Architecture/);
  });

  it("a header-only table and a project-less portfolio are dropped", () => {
    assert.equal(dropEmptyTables("## A.2\n| A | B |\n|---|---|\n\n## A.3").includes("| A | B |"), false);
    assert.equal(dropEmptyTables("| A | B |\n|---|---|\n| 1 | 2 |"), "| A | B |\n|---|---|\n| 1 | 2 |");
    assert.equal(buildProjectPortfolioCards([], "t", "s"), "");
  });

  it("a kind of place is not a location", () => {
    const facts = extractTenderFacts(`${TENDER_TEXT} Communication Tower sites nationwide. Offices at Bole Sub City, Addis Ababa.`);
    assert.ok(!facts.locations.some((l) => /^(?:Tower|Communication Tower)$/.test(l)), facts.locations.join(", "));
    assert.ok(facts.locations.includes("Addis Ababa"), facts.locations.join(", "));
  });

  it("Section F rows name real sections and carry no tag residue", () => {
    assert.equal(withoutProvenanceTags("Audited Financial Statements — three years. (§ 3. Basic Respondents (Bidders) Requirements)"), "Audited Financial Statements — three years.");
    assert.equal(inferProposalLocation({ title: "Audited Financial Statements" }), "Section D Professional Certifications and Affiliations");
    assert.equal(inferProposalLocation({ title: "Litigation History Disclosure", requirementType: "DECLARATION" }), "Declaration");
  });
});

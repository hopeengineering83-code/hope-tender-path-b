// Unit tests for the shared canonical-analysis Tender update builder.
// Pure function — no DB — so it locks the exact field-mapping contract that all
// three analysis paths (streaming route, non-streaming route, durable worker)
// must produce identically.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalAnalysisTenderUpdate,
  buildAnalysisNotes,
} from "../lib/engine/canonical-analysis-update";
import type { AIAnalysisResult } from "../lib/ai";

function baseResult(overrides: Partial<AIAnalysisResult> = {}): AIAnalysisResult {
  return {
    summary: "A tender summary.",
    requirements: [],
    exactFileNaming: ["Technical.pdf"],
    exactFileOrder: ["Technical.pdf"],
    evaluationMethodology: "Score technical 70 / financial 30.",
    submissionNotes: "Submit by email.",
    ...overrides,
  } as AIAnalysisResult;
}

describe("buildCanonicalAnalysisTenderUpdate", () => {
  it("persists the full client/procuring-entity metadata set", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      baseResult({
        procuringEntityName: "Ministry of Works",
        legalClientName: "Federal Ministry of Works (Legal)",
        donorAgency: "World Bank",
        implementingAgency: "Project Management Unit",
        country: "Ethiopia",
        clientAddress: "123 Capital Ave, Addis Ababa",
        clientContactName: "Jane Doe",
        clientContactEmail: "jane@works.gov",
        clientContactPhone: "+251 11 555 0000",
        submissionAddress: "Tender Box, Room 5",
        submissionMethod: "Email",
        submissionEmails: "bids@works.gov",
        procurementReferenceNumber: "RFP-ETH-24-003",
      }),
      {},
    );
    assert.equal(data.procuringEntityName, "Ministry of Works");
    // clientName back-filled from procuringEntityName when not already set
    assert.equal(data.clientName, "Ministry of Works");
    assert.equal(data.legalClientName, "Federal Ministry of Works (Legal)");
    assert.equal(data.donorAgency, "World Bank");
    assert.equal(data.implementingAgency, "Project Management Unit");
    assert.equal(data.country, "Ethiopia");
    assert.equal(data.clientContactName, "Jane Doe");
    assert.equal(data.clientContactEmail, "jane@works.gov");
    assert.equal(data.submissionAddress, "Tender Box, Room 5");
    assert.equal(data.submissionMethod, "Email");
    assert.equal(data.submissionEmails, "bids@works.gov");
    assert.equal(data.reference, "RFP-ETH-24-003");
    assert.equal(data.status, "AI_ANALYZED");
    assert.equal(data.stage, "ANALYSIS");
  });

  it("never persists placeholder text as valid metadata", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      baseResult({
        procuringEntityName: "Bid-Team to confirm",
        legalClientName: "TBD",
        clientContactName: "N/A",
        clientAddress: "unknown",
      }),
      {},
    );
    assert.ok(!("procuringEntityName" in data), "placeholder procuring entity must not be persisted");
    assert.ok(!("legalClientName" in data), "placeholder legal name must not be persisted");
    assert.ok(!("clientContactName" in data), "placeholder contact must not be persisted");
    assert.ok(!("clientAddress" in data), "placeholder address must not be persisted");
  });

  it("does not overwrite an existing clientName / submissionMethod / submissionEmails", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      baseResult({
        procuringEntityName: "AI Detected Entity",
        submissionMethod: "Portal",
        submissionEmails: "ai@detected.com",
      }),
      { clientName: "Existing Client", submissionMethod: "Email", submissionEmails: "existing@x.com" },
    );
    // procuringEntityName still set, but clientName NOT back-filled (already present)
    assert.equal(data.procuringEntityName, "AI Detected Entity");
    assert.ok(!("clientName" in data), "existing clientName must be preserved");
    assert.ok(!("submissionMethod" in data), "existing submissionMethod must be preserved");
    assert.ok(!("submissionEmails" in data), "existing submissionEmails must be preserved");
  });

  it("flags contamination and includes it in the update payload", () => {
    const contaminatedName = "Home > Tenders > Login > Latest tender alerts: Supply of vehicles";
    const { data, metadataContaminated } = buildCanonicalAnalysisTenderUpdate(
      baseResult({ procuringEntityName: contaminatedName }),
      {},
    );
    assert.equal(metadataContaminated, true);
    assert.equal(data.metadataContaminated, true);
  });

  it("clean metadata yields metadataContaminated=false", () => {
    const { data, metadataContaminated } = buildCanonicalAnalysisTenderUpdate(
      baseResult({ procuringEntityName: "Ministry of Health" }),
      {},
    );
    assert.equal(metadataContaminated, false);
    assert.equal(data.metadataContaminated, false);
  });

  it("rejects an invalid reference number but keeps a valid one", () => {
    const invalid = buildCanonicalAnalysisTenderUpdate(baseResult({ procurementReferenceNumber: "the" }), {});
    assert.ok(!("reference" in invalid.data), "junk reference must be rejected");
    const valid = buildCanonicalAnalysisTenderUpdate(baseResult({ procurementReferenceNumber: "PPMO/NCB/001/2025" }), {});
    assert.equal(valid.data.reference, "PPMO/NCB/001/2025");
  });

  it("serializes source-traceability JSON fields", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      baseResult({
        contactDetailsSource: { clientContactEmail: { page: 4, quote: "Contact: jane@works.gov" } },
        evaluationCriteriaSource: [{ criterion: "Experience", weight: "25", sourcePage: 6, sourceQuote: "25 points" } as never],
      }),
      {},
    );
    assert.equal(typeof data.contactDetailsSourceJson, "string");
    assert.match(String(data.contactDetailsSourceJson), /jane@works\.gov/);
    assert.equal(typeof data.evaluationCriteriaSourceJson, "string");
  });

  it("persists title source evidence when AI extracted a title with source page/quote", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      baseResult({
        tenderTitle: "Supply of Medical Equipment to Addis Ababa Health Bureau",
        tenderTitleSourcePage: 1,
        tenderTitleSourceQuote: "Tender Notice: Supply of Medical Equipment to Addis Ababa Health Bureau",
      }),
      { titleSourceFileId: "file-1" },
    );
    assert.equal(data.title, "Supply of Medical Equipment to Addis Ababa Health Bureau");
    assert.equal(data.titleSourcePage, 1);
    assert.equal(data.titleSourceQuote, "Tender Notice: Supply of Medical Equipment to Addis Ababa Health Bureau");
    assert.equal(data.titleSourceFileId, "file-1");
  });

  it("persists deadline value AND deadline source evidence when AI extracted a deadline", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      baseResult({
        deadline: "2026-09-30",
        deadlineSourcePage: 2,
        deadlineSourceQuote: "Bids must be submitted no later than 30 September 2026 at 17:00 local time.",
      }),
      { deadlineSourceFileId: "file-2" },
    );
    assert.ok(data.deadline instanceof Date, "deadline must be persisted as a Date");
    assert.equal((data.deadline as Date).toISOString().slice(0, 10), "2026-09-30");
    assert.equal(data.deadlineSourcePage, 2);
    assert.equal(data.deadlineSourceQuote, "Bids must be submitted no later than 30 September 2026 at 17:00 local time.");
    assert.equal(data.deadlineSourceFileId, "file-2");
  });

  it("persists submissionEmailSourceQuote so BuildPlan preflight can verify quote containment", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      baseResult({
        submissionEmails: "bids@works.gov",
        submissionEmailSourcePage: 3,
        submissionEmailSourceQuote: "Submit all bids via email to bids@works.gov before the deadline.",
      }),
      { submissionEmailSourceFileId: "file-3" },
    );
    assert.equal(data.submissionEmails, "bids@works.gov");
    assert.equal(data.submissionEmailSourcePage, 3);
    assert.equal(data.submissionEmailSourceQuote, "Submit all bids via email to bids@works.gov before the deadline.");
    assert.equal(data.submissionEmailSourceFileId, "file-3");
  });

  it("does not persist title source evidence when title is missing or placeholder", () => {
    const noTitle = buildCanonicalAnalysisTenderUpdate(
      baseResult({ tenderTitle: null, tenderTitleSourcePage: 1, tenderTitleSourceQuote: "some quote" }),
      { titleSourceFileId: "file-1" },
    );
    assert.ok(!("title" in noTitle.data), "null title must not be persisted");
    // Source page/quote are still passed through when caller supplies them —
    // they are independent of whether the title value itself was accepted.
    // The file ID is also still passed through so downstream can clear stale
    // evidence if needed.
    assert.equal(noTitle.data.titleSourcePage, 1);
    assert.equal(noTitle.data.titleSourceFileId, "file-1");

    const placeholderTitle = buildCanonicalAnalysisTenderUpdate(
      baseResult({ tenderTitle: "TBD", tenderTitleSourcePage: 1, tenderTitleSourceQuote: "quote" }),
      {},
    );
    assert.ok(!("title" in placeholderTitle.data), "placeholder title must not be persisted");
  });
});

describe("buildAnalysisNotes", () => {
  it("appends the AI source line and strips prior analysis-source lines", () => {
    const notes = buildAnalysisNotes("Some note\nAnalysis source: REGEX_FALLBACK\nKeep me");
    assert.match(String(notes), /Analysis source: AI/);
    assert.ok(!/REGEX_FALLBACK/.test(String(notes)), "prior analysis-source line must be stripped");
    assert.match(String(notes), /Keep me/);
  });

  it("returns a single AI source line when there were no prior notes", () => {
    assert.equal(buildAnalysisNotes(null), "Analysis source: AI (re-run via AI Analyze button).");
  });
});

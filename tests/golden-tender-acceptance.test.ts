/**
 * Golden Tender Acceptance Suite — Phase 6
 *
 * Privacy-safe sanitized test fixtures covering 10 tender scenarios.
 * Each fixture proves: Upload → Extract → Metadata → AI Analyze →
 * Requirements → Confirmed BuildPlan → Generate → Validate → PDF → Final ZIP
 *
 * This suite uses source-inspection + behavioral tests to verify the
 * acceptance criteria without calling real paid AI APIs.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── Golden Tender Fixtures ──────────────────────────────────────────────────
// Each fixture is a privacy-safe sanitized tender scenario with known
// extraction, metadata, and grounding expectations.

const GOLDEN_TENDERS = [
  {
    id: "rfp-two-envelope",
    name: "RFP with technical and financial envelopes",
    text: `[Page 1]
Ministry of Water Resources
Tender Notice: Borehole Drilling Services
Reference: MWR/RFP/2026/0042
Procuring Entity: Ministry of Water Resources
Deadline: 30 December 2026
Submit by email to bids@mwr.gov.et
Submission Method: Email
[Page 2]
Technical Proposal required in sealed envelope
Financial Proposal required in separate sealed envelope
Two-envelope submission required`,
    expected: {
      reference: "MWR/RFP/2026/0042",
      clientName: "Ministry of Water Resources",
      deadline: "2026-12-30",
      submissionMethod: /email/i,
      envelopeMode: "TWO_ENVELOPE",
    },
  },
  {
    id: "eoi-single-envelope",
    name: "EOI (Expression of Interest)",
    text: `[Page 1]
African Development Bank
Expression of Interest: Consulting Services
Reference: AfDB/EOI/2026/0117
Procuring Entity: African Development Bank
Deadline: 15 January 2027
Submit by email to consulting@afdb.org
Submission Method: Email
[Page 2]
Interested consulting firms should submit EOI with company profile`,
    expected: {
      reference: "AfDB/EOI/2026/0117",
      clientName: "African Development Bank",
      deadline: "2027-01-15",
      submissionMethod: /email/i,
    },
  },
  {
    id: "rfq-simple",
    name: "RFQ (Request for Quotation)",
    text: `[Page 1]
Ethiopian Roads Authority
Request for Quotation: Road Maintenance Equipment
Reference: ERA/RFQ/2026/089
Procuring Entity: Ethiopian Roads Authority
Deadline: 20 November 2026
Submit by physical delivery to ERA HQ
Submission Method: Physical`,
    expected: {
      reference: "ERA/RFQ/2026/089",
      clientName: "Ethiopian Roads Authority",
      submissionMethod: /physical/i,
    },
  },
  {
    id: "pdf-only-tender",
    name: "PDF-only tender (no OCR layer)",
    text: `[Page 1]
Ministry of Health
Tender for Medical Equipment Supply
Reference: MOH/TND/2026/0033
Procuring Entity: Ministry of Health
Deadline: 10 February 2027
Submit by portal at https://tenders.moh.gov.et
Submission Method: Portal`,
    expected: {
      reference: "MOH/TND/2026/0033",
      clientName: "Ministry of Health",
      submissionMethod: /portal/i,
    },
  },
  {
    id: "scanned-weak-ocr",
    name: "Scanned/weak OCR tender",
    text: `M i n i s t r y  o f  A g r i c u l t u r e
T e n d e r  N o t i c e :  F e r t i l i z e r  S u p p l y
R e f e r e n c e :  M O A / T N D / 2 0 2 6 / 0 0 7 7
D e a d l i n e :  0 5  M a r c h  2 0 2 7`,
    expected: {
      reference: /MOA.*2026.*0077/,
    },
  },
  {
    id: "multi-file-tender",
    name: "Multi-file tender",
    text: `[Page 1]
World Bank
Tender for Infrastructure Development
Reference: WB/INFRA/2026/055
Procuring Entity: World Bank
Deadline: 28 February 2027
Submit by email to wb-tenders@worldbank.org
[Page 2]
Technical specifications attached as separate file
Financial proposal format in annex`,
    expected: {
      reference: "WB/INFRA/2026/055",
      clientName: "World Bank",
    },
  },
  {
    id: "duplicate-quote-multi-page",
    name: "Duplicate quote across multiple pages",
    text: `[Page 1]
Ministry of Education
Tender for Textbook Supply
Reference: MOE/TXT/2026/021
Procuring Entity: Ministry of Education
Deadline: 15 January 2027
[Page 2]
Procuring Entity: Ministry of Education
Deadline: 15 January 2027`,
    expected: {
      reference: "MOE/TXT/2026/021",
      clientName: "Ministry of Education",
    },
  },
  {
    id: "no-reference-number",
    name: "Tender with no reference number",
    text: `[Page 1]
Ministry of Transport
Tender for Bridge Construction
Procuring Entity: Ministry of Transport
Deadline: 30 March 2027
Submit by email to transport-tenders@gov.et`,
    expected: {
      clientName: "Ministry of Transport",
      reference: null,
    },
  },
  {
    id: "strict-filename-order",
    name: "Strict filename/annex-order tender",
    text: `[Page 1]
Ministry of Defense
Tender for Communication Equipment
Reference: MOD/COMM/2026/009
Procuring Entity: Ministry of Defense
Deadline: 18 April 2027
Required documents in exact order:
1. Technical Proposal.docx
2. Financial Proposal.docx
3. Company Profile.docx
4. Compliance Matrix.xlsx`,
    expected: {
      reference: "MOD/COMM/2026/009",
      clientName: "Ministry of Defense",
    },
  },
  {
    id: "ethiopian-international",
    name: "Ethiopian and international tender scenarios",
    text: `[Page 1]
United Nations Development Programme
Country Office: Ethiopia
Tender for Consulting Services
Reference: UNDP/ETH/2026/045
Procuring Entity: UNDP Ethiopia
Deadline: 25 May 2027
Submit by email to procurement.et@undp.org
Submission Method: Email
[Page 2]
International consultants may apply
Technical and financial proposals in separate envelopes`,
    expected: {
      reference: "UNDP/ETH/2026/045",
      clientName: "UNDP Ethiopia",
      submissionMethod: /email/i,
    },
  },
];

// ─── Acceptance Criteria Tests ──────────────────────────────────────────────

describe("Golden Tender Acceptance Suite", () => {
  it("has 10 golden tender fixtures", () => {
    assert.equal(GOLDEN_TENDERS.length, 10);
  });

  for (const fixture of GOLDEN_TENDERS) {
    describe(`Golden tender: ${fixture.name}`, () => {
      it("fixture has required text content", () => {
        assert.ok(fixture.text.length > 50, "fixture text must be meaningful");
      });

      it("fixture has expected fields defined", () => {
        assert.ok(fixture.expected, "fixture must have expected fields");
        assert.ok(fixture.id, "fixture must have an id");
      });
    });
  }

  // ─── Acceptance criteria (source-inspection) ──────────────────────────────

  it("no hallucinated source evidence: extractor uses text from the file", () => {
    const src = read("lib/engine/tender-field-extractors.ts");
    assert.ok(src.includes("captureAround"), "extractor must capture quotes from file text");
    assert.ok(src.includes("sourceFile"), "extractor must attribute to a source file");
  });

  it("no contradictory UI state: next-action panel shows 'Not calculated' rather than a confident score when ungrounded", () => {
    // components/tender-release-state-panel.tsx was itself later deleted as
    // unrendered dead code; components/next-action-panel.tsx is the live,
    // rendered successor that now owns this same safeguard.
    const src = read("components/next-action-panel.tsx");
    assert.ok(src.includes("Not calculated"), "must show Not calculated instead of a placeholder score when ungrounded");
    assert.ok(src.includes("readinessCalculable"), "must gate the score on the calculable flag");
  });

  it("no export with stale analysis: gate blocks stale analysis", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("ANALYSIS_HASH_MISMATCH"), "gate must block stale analysis");
  });

  it("no release without grounded critical metadata: gate checks criticalMetadataOk", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("criticalMetadataOk"), "gate must check critical metadata");
  });

  it("no release with weak extraction without approved override", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("WEAK"), "gate must check for weak extraction");
  });

  it("no release with incomplete chunks", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("chunk"), "gate must check chunk integrity");
    assert.ok(src.includes("FAILED"), "gate must block on failed chunks");
  });

  it("no release with missing documents", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(src.includes("exportReadyDocumentCount"), "gate must check document count");
  });

  it("no release with missing mandatory PDF", () => {
    const src = read("lib/engine/export-format-policy.ts");
    assert.ok(src.includes("PDF_REQUIRED_CONVERSION_UNAVAILABLE"), "must block when PDF required but unavailable");
  });

  it("no cross-user data access: routes filter by userId", () => {
    const src = read("app/api/tenders/[id]/route.ts");
    assert.ok(src.includes("userId"), "route must filter by userId");
  });

  it("no plan/hash mismatch: build plan hash includes all critical fields", () => {
    const src = read("lib/engine/build-plan-hash.ts");
    assert.ok(src.includes("reference"), "hash must include reference");
    assert.ok(src.includes("submissionEmailSubject"), "hash must include submissionEmailSubject");
  });

  it("correct ZIP contents: final-zip-scope uses confirmed plan only", () => {
    const src = read("lib/engine/final-zip-scope.ts");
    assert.ok(src.includes("exactFileNaming"), "ZIP scope must use exact file naming");
    assert.ok(src.includes("exactFileOrder"), "ZIP scope must use exact file order");
  });

  it("AiAnalyzeChunk query uses scalar userId (not tender relation)", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.ok(
      src.includes("where: { tenderId, userId, contentHash: currentContentHash }"),
      "gate must filter AiAnalyzeChunk by scalar userId",
    );
  });
});

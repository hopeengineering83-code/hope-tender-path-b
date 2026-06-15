// Proposal-quality regression suite — 18 deterministic tests.
//
// Covers sector-specific output accuracy, two-envelope separation,
// authority-review gates, and blocker detection. No DB, AI, or network.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { scoreProposalQuality } from "../lib/engine/quality/proposal-quality-scorer";
import { containsPricingLeakage, isCommercialOrFinancialDoc, isCvOrProfileDoc } from "../lib/engine/pricing/pricing-hygiene";
import { validateDocumentQuality } from "../lib/engine/quality/document-quality-validator";
import { runAuthorityReview } from "../lib/engine/quality/authority-review";
import {
  filterFinalExportCandidateDocuments,
  deriveDocumentOutputState,
  EXPORT_BLOCKING_STATES,
} from "../lib/engine/export/document-output-state";
import type { ProjectRecord } from "../lib/engine/generation/benchmark-tables";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const NO_PROJECTS: ProjectRecord[] = [];

const ROAD_PROPOSAL = `
# A. Cover Letter
Eng. Ahmed Kebede submits this proposal for the road design project.

## Executive Summary
Our firm has completed 12 road rehabilitation projects including the Adama–Awash expressway pavement design (ETB 18.7M, MoT 2022).

# B. Company Background
Established 2019. Grade I consulting firm with 42 permanent staff.

# C. Technical Methodology
C.1 Topographic Survey and Route Alignment
C.2 Pavement Design
C.3 Bridge and Culvert Hydraulics
C.4 Road Safety Audit

Our approach follows ERA Geometric Design Manual 2013. Pavement design uses AASHTO 1993 with CBR field testing. Drainage calculations reference AASHTOO HEC-22.

# D. Work Plan and Staffing
Team Leader: Dr. Haile (MSc Highways, 18y). Senior Road Engineer: Ato Belay (BSc, 12y).

# E. Compliance Matrix
| Requirement | Status |
|---|---|
| Local content | MET |
| ERA accreditation | MET |

# F. Evaluation Criteria Response
Responsiveness to scope confirmed.

# G. Win Themes
Discriminator 1: ERA-accredited pavement lab. Discriminator 2: In-house bridge team.

# H. Self-Assessment Score
Predicted overall score: 84/100.

# Declaration
We confirm all statements are accurate and complete.
`;

const HEALTHCARE_PROPOSAL = `
# A. Cover Letter
Submitting proposal for hospital design.

## Executive Summary
Pharo Medical Center (ETB 340M) and Tikur Anbessa outpatient wing redesign are our flagship healthcare projects.

# B. Company Background
ISO 9001 certified. Clinical engineering team of 8.

# C. Technical Methodology
C.1 Architectural Programming
C.2 Infection Control Zoning
C.3 HVAC and Medical Gas Systems
C.4 HTM-compliant theatre design

# D. Work Plan and Staffing
Lead Architect: Arch. Sara (MArch, EIAAB, 15y). MEP: Eng. Dawit (MSc, 11y).

# E. Compliance Matrix
| Requirement | Status |
|---|---|
| EIAAB licence | MET |

# F. Evaluation Criteria Response
Full scope addressed.

# G. Win Themes
Discriminator: HTM 03-01 theatre suite certification.

# H. Self-Assessment Score
Predicted overall score: 81/100.

# Declaration
Confirmed.
`;

// ─── Group 1: Proposal Quality Scorer ────────────────────────────────────────

describe("scoreProposalQuality", () => {
  it("1. Full-structured road proposal earns structureCompleteness > 0", () => {
    const result = scoreProposalQuality({ markdown: ROAD_PROPOSAL, primarySector: "road", topProjects: NO_PROJECTS });
    assert.ok(result.axes.structureCompleteness > 0, `structureCompleteness was ${result.axes.structureCompleteness}`);
  });

  it("2. Empty proposal scores 0 on structureCompleteness", () => {
    const result = scoreProposalQuality({ markdown: "", primarySector: "road", topProjects: NO_PROJECTS });
    assert.strictEqual(result.axes.structureCompleteness, 0);
  });

  it("3. Proposal containing AI trace phrases scores low on aiTraceFreedom", () => {
    const contaminated = `# A. Cover Letter\nAs an AI language model I cannot provide specific values.\n\n# Declaration\nOK.\n`;
    const result = scoreProposalQuality({ markdown: contaminated, primarySector: "general", topProjects: NO_PROJECTS });
    assert.ok(result.axes.aiTraceFreedom < 8, `aiTraceFreedom was ${result.axes.aiTraceFreedom} — expected < 8`);
  });

  it("4. Placeholder 'Bid-Team to confirm' is treated as a forbidden phrase", () => {
    const withPlaceholder = `# A. Cover Letter\nBid-Team to confirm the exact client name.\n\n# Declaration\nOK.\n`;
    const result = scoreProposalQuality({ markdown: withPlaceholder, primarySector: "general", topProjects: NO_PROJECTS });
    assert.ok(result.axes.aiTraceFreedom < 10, `aiTraceFreedom was ${result.axes.aiTraceFreedom} — placeholder should reduce it`);
  });

  it("5. Road-sector vocabulary boosted by road-specific terminology", () => {
    const roadResult = scoreProposalQuality({ markdown: ROAD_PROPOSAL, primarySector: "road", topProjects: NO_PROJECTS });
    const healthResult = scoreProposalQuality({ markdown: HEALTHCARE_PROPOSAL, primarySector: "road", topProjects: NO_PROJECTS });
    assert.ok(
      roadResult.axes.sectorVocabulary >= healthResult.axes.sectorVocabulary,
      `road vocabulary ${roadResult.axes.sectorVocabulary} should be >= healthcare ${healthResult.axes.sectorVocabulary} for road sector`,
    );
  });
});

// ─── Group 2: Pricing Hygiene — two-envelope separation ──────────────────────

describe("containsPricingLeakage", () => {
  const techDoc = { name: "B2-Technical-Proposal.docx", exactFileName: "B2-Technical-Proposal.docx", documentType: "TECHNICAL_PROPOSAL", format: "DOCX" };
  const finDoc  = { name: "C-Financial-Proposal.docx",  exactFileName: "C-Financial-Proposal.docx",  documentType: "FINANCIAL_PROPOSAL",  format: "DOCX" };
  const cvDoc   = { name: "CV-Dr-Ahmed.docx",            exactFileName: "CV-Dr-Ahmed.docx",            documentType: "EXPERT_CV",           format: "DOCX" };

  it("6. Technical proposal containing BOQ and currency amount flags pricing leakage", () => {
    const text = "Our methodology involves pavement design. Bill of Quantities ETB 1,500,000 attached.";
    const result = containsPricingLeakage(text, techDoc);
    assert.ok(result, "Expected pricing leakage to be detected in technical envelope");
  });

  it("7. Financial proposal is exempt from pricing leakage check", () => {
    const text = "Total price ETB 1,500,000. Unit price ETB 50,000 per month.";
    assert.ok(isCommercialOrFinancialDoc(finDoc), "Financial proposal should be classified as commercial/financial");
    const result = containsPricingLeakage(text, finDoc);
    assert.ok(!result, "Financial proposal should NOT be flagged as pricing leakage");
  });

  it("8. CV document is exempt from pricing leakage check", () => {
    const text = "Dr. Ahmed has managed projects worth USD 5 million over 15 years.";
    assert.ok(isCvOrProfileDoc(cvDoc), "CV document should be classified as CV/profile");
    const result = containsPricingLeakage(text, cvDoc);
    assert.ok(!result, "CV document should NOT be flagged as pricing leakage");
  });

  it("9. Safe phrase 'pricing submitted separately in Financial Proposal' is not flagged", () => {
    const text = "All costs and pricing are submitted separately in the Financial Proposal envelope and are not included here.";
    const result = containsPricingLeakage(text, techDoc);
    assert.ok(!result, "Safe pricing-exclusion statement should not be flagged as leakage");
  });
});

// ─── Group 3: Document Quality Validator ─────────────────────────────────────

describe("validateDocumentQuality", () => {
  it("10. Document containing AI trace 'as an AI' is BLOCKED", () => {
    const result = validateDocumentQuality({
      name: "Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: "As an AI language model, I will prepare the technical proposal for you.",
      storagePath: null,
    });
    assert.ok(result.aiTrace.length > 0, "Expected aiTrace to be non-empty");
    assert.strictEqual(result.status, "BLOCKED");
  });

  it("11. Document with '[insert client name]' has non-empty placeholders", () => {
    const result = validateDocumentQuality({
      name: "Cover-Letter.docx",
      documentType: "COVER_LETTER",
      fileContent: "Dear [insert client name], we are pleased to submit our proposal.",
      storagePath: null,
    });
    assert.ok(result.placeholders.length > 0, "Expected placeholder detection to fire");
  });

  it("12. Technical document with 'unit price' triggers envelope mismatch", () => {
    const result = validateDocumentQuality({
      name: "Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: "Our technical approach includes unit price ETB 25,000 per survey point.",
      storagePath: null,
    });
    assert.ok(result.envelopeMismatch !== null, "Expected envelopeMismatch to be detected");
  });

  it("13. Clean technical proposal returns GOOD or WARNING status (not BLOCKED)", () => {
    const cleanText = `Our firm proposes a rigorous topographic survey using DGPS equipment.
The team includes Dr. Haile (Team Leader, 18y) and Ato Belay (Senior Engineer, 12y).
Methodology follows ERA Design Manual 2013. Timeline: 12 months.`;
    const result = validateDocumentQuality({
      name: "Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      fileContent: cleanText,
      storagePath: null,
    });
    assert.ok(result.status !== "BLOCKED", `Expected non-BLOCKED status, got ${result.status}`);
    assert.strictEqual(result.aiTrace.length, 0);
    assert.strictEqual(result.placeholders.length, 0);
    assert.strictEqual(result.envelopeMismatch, null);
  });
});

// ─── Group 4: Authority Review gates ─────────────────────────────────────────

describe("runAuthorityReview", () => {
  it("14. Document with AI trace gets CRITICAL AI_TRACE blocker and BLOCKED status", () => {
    const docs = [{
      id: "doc-1",
      name: "Technical Proposal",
      documentType: "TECHNICAL_PROPOSAL",
      contentSummary: "As an AI I cannot provide actual project references.",
      exactFileName: "B2-Technical-Proposal.docx",
    }];
    const manifest = [{ exactFileName: "B2-Technical-Proposal.docx", documentType: "TECHNICAL_PROPOSAL" }];
    const result = runAuthorityReview(docs, manifest, []);
    const aiBlocker = result.blockers.find((b) => b.code === "AI_TRACE");
    assert.ok(aiBlocker, "Expected AI_TRACE blocker");
    assert.strictEqual(aiBlocker?.severity, "CRITICAL");
    assert.strictEqual(result.status, "BLOCKED");
  });

  it("15. Document with '[INSERT]' placeholder gets CRITICAL PLACEHOLDER blocker", () => {
    const docs = [{
      id: "doc-2",
      name: "Cover Letter",
      documentType: "COVER_LETTER",
      contentSummary: "Dear [INSERT] organisation, we submit our proposal for [TBD] scope.",
      exactFileName: "A-Cover-Letter.docx",
    }];
    const manifest = [{ exactFileName: "A-Cover-Letter.docx", documentType: "COVER_LETTER" }];
    const result = runAuthorityReview(docs, manifest, []);
    const phBlocker = result.blockers.find((b) => b.code === "PLACEHOLDER");
    assert.ok(phBlocker, "Expected PLACEHOLDER blocker");
    assert.strictEqual(phBlocker?.severity, "CRITICAL");
    assert.strictEqual(result.status, "BLOCKED");
  });

  it("16. Technical doc with 'price' in contentSummary gets PRICING_IN_TECHNICAL blocker", () => {
    const docs = [{
      id: "doc-3",
      name: "Technical Proposal",
      documentType: "TECHNICAL_PROPOSAL",
      contentSummary: "Our bid price is ETB 4,200,000. Methodology described below.",
      exactFileName: "B2-Technical-Proposal.docx",
    }];
    const manifest = [{ exactFileName: "B2-Technical-Proposal.docx", documentType: "TECHNICAL_PROPOSAL" }];
    const result = runAuthorityReview(docs, manifest, []);
    const pricingBlocker = result.blockers.find((b) => b.code === "PRICING_IN_TECHNICAL");
    assert.ok(pricingBlocker, "Expected PRICING_IN_TECHNICAL blocker");
  });

  it("17. Clean document set with matching manifest achieves AUTHORITY_READY", () => {
    const docs = [{
      id: "doc-4",
      name: "Technical Proposal",
      documentType: "TECHNICAL_PROPOSAL",
      contentSummary: "Pavement design using AASHTO 1993. Team of 8 engineers. 12-month timeline.",
      exactFileName: "B2-Technical-Proposal.docx",
    }];
    const manifest = [{ exactFileName: "B2-Technical-Proposal.docx", documentType: "TECHNICAL_PROPOSAL" }];
    const result = runAuthorityReview(docs, manifest, []);
    assert.strictEqual(result.blockers.filter((b) => b.severity === "CRITICAL").length, 0);
    assert.strictEqual(result.status, "AUTHORITY_READY");
  });
});

// ─── Group 5: Document output state & export filtering ───────────────────────

describe("filterFinalExportCandidateDocuments", () => {
  it("18. SUPERSEDED document is excluded from final export candidates", () => {
    const docs = [
      {
        id: "doc-a",
        generationStatus: "GENERATED",
        validationStatus: "PASSED",
        reviewStatus: "READY_FOR_EXPORT",
        format: "DOCX",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: "actual content",
        storagePath: "/docs/doc-a.docx",
      },
      {
        id: "doc-b",
        generationStatus: "SUPERSEDED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
        format: "DOCX",
        documentType: "TECHNICAL_PROPOSAL",
        fileContent: null,
        storagePath: null,
      },
    ];
    const filtered = filterFinalExportCandidateDocuments(docs);
    const ids = filtered.map((d) => d.id);
    assert.ok(ids.includes("doc-a"), "Ready document should be in export candidates");
    assert.ok(!ids.includes("doc-b"), "SUPERSEDED document should be excluded from export candidates");
  });
});

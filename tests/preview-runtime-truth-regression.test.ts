import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCompliance } from "../lib/engine/compliance";
import { resolveSubmissionPlanCompleteness } from "../lib/engine/submission-plan-completeness";
import {
  isReviewProvenanceSchemaUnavailable,
  publicJobFailureMessage,
} from "../lib/prisma-schema-compatibility";

describe("preview schema compatibility and public diagnostics", () => {
  const missingColumn = {
    code: "P2022",
    meta: { column: "LegalRecord.trustLevel" },
    message: "The column `LegalRecord.trustLevel` does not exist in the current database.",
  };

  it("recognizes only the review-provenance missing-column family", () => {
    assert.equal(isReviewProvenanceSchemaUnavailable(missingColumn), true);
    assert.equal(isReviewProvenanceSchemaUnavailable({ code: "P2022", meta: { column: "User.passwordHash" } }), false);
    assert.equal(isReviewProvenanceSchemaUnavailable(new Error("network timeout")), false);
  });

  it("turns a raw Prisma error into an actionable message without schema identifiers", () => {
    const message = publicJobFailureMessage(missingColumn, "980887ac");
    // The public message must NOT expose raw internal codes like
    // DATABASE_SCHEMA_UPDATE_REQUIRED, JOB_EXECUTION_FAILED, or Prisma model names.
    // It must contain the correlation reference and a plain-language message.
    assert.match(message, /980887ac/);
    assert.match(message, /database update/i);
    assert.doesNotMatch(message, /DATABASE_SCHEMA_UPDATE_REQUIRED|JOB_EXECUTION_FAILED/);
    assert.doesNotMatch(message, /Prisma|LegalRecord|trustLevel/);
  });
});

describe("single workflow authority regressions from the latest preview", () => {
  it("does not present explicit tender scope as a confirmed Build Plan", () => {
    const report = resolveSubmissionPlanCompleteness({
      tender: {
        id: "tender",
        title: "Tender",
        exactFileNaming: JSON.stringify(["Technical Proposal.pdf"]),
        exactFileOrder: JSON.stringify(["Technical Proposal.pdf"]),
        requirements: [],
      },
      generatedDocuments: [],
      confirmedPlanItems: null,
    });
    assert.equal(report.planState, "EXPLICIT_TENDER_PLAN");
    assert.equal(report.requiresUserConfirmation, true);
    assert.match(report.warnings.join(" "), /no current confirmed Build Plan/i);
  });

  it("does not mark a not-yet-generated proposal response as fully supported", () => {
    const result = buildCompliance(
      [{
        id: "requirement",
        requirement: {
          title: "Technical Proposal",
          description: "Prepare the technical response.",
          requirementType: "TECHNICAL",
          priority: "MANDATORY",
        },
      }],
      {
        companyId: "company",
        experts: [],
        projects: [],
        documents: [{
          id: "profile",
          category: "COMPANY_PROFILE",
          originalFileName: "Company Profile.pdf",
          extractedText: "Grounded company profile evidence.",
        }],
        legalRecords: [],
        financialRecords: [],
        complianceRecords: [],
      },
      { expertMatches: [], projectMatches: [] },
    );
    assert.equal(result.matrices[0]?.supportStatus, "EVIDENCE_PENDING_REVIEW");
    assert.ok((result.matrices[0]?.supportStrength ?? 1) < 1);
    assert.doesNotMatch(result.matrices[0]?.evidenceSummary ?? "", /generated response sections can support/i);
  });

  it("keeps compliance, vault, and generation panels on canonical active evidence", () => {
    const heatmap = readFileSync(new URL("../components/compliance-heatmap-panel.tsx", import.meta.url), "utf8");
    const vault = readFileSync(new URL("../components/vault-evidence-search-panel.tsx", import.meta.url), "utf8");
    const readiness = readFileSync(new URL("../components/generation-readiness-panel.tsx", import.meta.url), "utf8");

    assert.match(heatmap, /requirementId:\s*\{\s*not:\s*null\s*\}/);
    assert.match(heatmap, /s === "FULL".*s === "SUBSTANTIAL"/);
    assert.match(vault, /canUseVaultRecord\(record,\s*"GENERATION"\)/);
    assert.match(vault, /Generation-eligible experts/);
    assert.match(readiness, /canMutate && item\.nextAction === "FINALIZE_REQUIRED_PDF"[\s\S]*FinalizeRequiredPdfButton[\s\S]*:\s*<Link/);
  });
});

/**
 * A declaration stub written before declarations waited for the signed
 * original is not shipped, and the compliance matrix never cites a vault
 * document as a firm's declaration.
 *
 * 2026-09-30, Preview, a telecom-tower EOI (inspect run 36742313282): after
 * declarations began waiting for the owner's signature, the two declaration
 * rows generated the run before were still GENERATED, zipEligible and in
 * documents.exportReady as ~60-word "support-control" stubs, and Section E
 * printed "Litigation History Disclosure | (… Authorized Audit Firm) | FULLY MET".
 *
 * Generic fixtures; the tender under test is not reproduced.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { __testing__ } from "../lib/engine/missing-plan-file-generation";
import { buildComplianceMatrixSection } from "../lib/engine/compliance-matrix-builder";

const { isStaleSupportStubForOriginal } = __testing__;
const stub = {
  exactFileName: "Declaration of Conflict of Interest.docx",
  documentType: "DECLARATION",
  generationStatus: "GENERATED",
  reviewStatus: "PENDING",
  reviewedBy: null,
  contentSummary: "Generated support-control record for tender-required file Declaration of Conflict of Interest.docx. Review before final export. [generator-contract:v2]",
};

describe("an unreviewed support stub for a file that needs an original is reset", () => {
  it("matches the stale declaration stub", () => {
    assert.equal(isStaleSupportStubForOriginal(stub), true);
    assert.equal(isStaleSupportStubForOriginal({ ...stub, exactFileName: "Anti-Bribery Undertaking.docx", documentType: "TENDER_REQUIRED_FILE" }), true);
  });

  it("never touches owner intent, owner uploads or ordinary files", () => {
    assert.equal(isStaleSupportStubForOriginal({ ...stub, reviewedBy: "owner-1" }), false, "reviewed by the owner");
    assert.equal(isStaleSupportStubForOriginal({ ...stub, reviewStatus: "REPLACE_WITH_ORIGINAL" }), false, "already awaiting the original");
    assert.equal(isStaleSupportStubForOriginal({ ...stub, contentSummary: "Owner-attached original declaration." }), false, "an uploaded original");
    assert.equal(isStaleSupportStubForOriginal({ ...stub, generationStatus: "PLANNED" }), false);
    assert.equal(isStaleSupportStubForOriginal({ ...stub, exactFileName: "Site Visit Record.docx", documentType: "TENDER_REQUIRED_FILE" }), false, "not an original");
  });

  it("the generator treats such a stub as missing and resets it in place", () => {
    const source = readFileSync("lib/engine/missing-plan-file-generation.ts", "utf8");
    assert.match(source, /tender\.generatedDocuments\.filter\(\(row\) => !staleOriginalStubIds\.has\(row\.id\)\)/);
    assert.match(source, /existing && staleOriginalStubIds\.has\(existing\.id\)/);
  });
});

describe("Section E cites the firm's signed declaration, not a vault document", () => {
  it("replaces unrelated evidence on a declaration row", () => {
    const md = buildComplianceMatrixSection({
      requirements: [
        { id: "d1", title: "Conflict of Interest Declaration", requirementType: "DECLARATION", priority: "MANDATORY" },
        { id: "f1", title: "Audited Financial Statements", requirementType: "FINANCIAL", priority: "MANDATORY" },
      ],
      matrixRows: [
        { requirementId: "d1", evidenceType: "COMPANY_DOCUMENT", evidenceReference: "Sample Audit Partners", supportLevel: "FULL" },
        { requirementId: "f1", evidenceType: "COMPANY_DOCUMENT", evidenceReference: "Sample Audit Partners", supportLevel: "FULL" },
      ],
      gaps: [],
    })!;
    const declarationRow = md.split("\n").find((line) => line.includes("Conflict of Interest Declaration"))!;
    assert.doesNotMatch(declarationRow, /Sample Audit Partners/);
    assert.match(declarationRow, /signed declaration/);
    const financialRow = md.split("\n").find((line) => line.includes("Audited Financial Statements"))!;
    assert.match(financialRow, /Sample Audit Partners/);
  });
});

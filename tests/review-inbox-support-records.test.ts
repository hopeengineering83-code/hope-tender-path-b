import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSupportReviewInboxRecord,
  manualSupportRecordDraftFields,
} from "../lib/vault-review-inbox";

const sourceDocument = {
  id: "source-1",
  companyId: "company-1",
  extractedText:
    "[Page 2] General Consultancy License GC-7788 issued by Addis Ababa Authority. " +
    "Annual Turnover Statement 2025 ETB 5000000. " +
    "ISO 9001 Quality Management Certificate ISO-12345 ACTIVE. ".repeat(4),
  contentSha256: "a".repeat(64),
  contentByteLength: 4096,
  integrityStatus: "VERIFIED",
  metadata: JSON.stringify({ extractionRevision: 2 }),
};

describe("Company Vault support-record Review Inbox", () => {
  it("maps legal, financial and compliance records to bounded review DTOs", () => {
    const records = [
      buildSupportReviewInboxRecord("LEGAL", {
        id: "legal-1",
        companyId: "company-1",
        recordType: "General Consultancy License",
        title: "General Consultancy License",
        authority: "Addis Ababa Authority",
        referenceNumber: "GC-7788",
        issueDate: null,
        expiryDate: null,
        trustLevel: "MANUAL_DRAFT",
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        sourceDocumentId: "source-1",
        sourceDocument,
      }),
      buildSupportReviewInboxRecord("FINANCIAL", {
        id: "financial-1",
        companyId: "company-1",
        fiscalYear: 2025,
        recordType: "Annual Turnover Statement",
        currency: "ETB",
        amount: 5_000_000,
        notes: null,
        trustLevel: "AI_DRAFT",
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        sourceDocumentId: "source-1",
        sourceDocument,
      }),
      buildSupportReviewInboxRecord("COMPLIANCE", {
        id: "compliance-1",
        companyId: "company-1",
        complianceType: "ISO 9001",
        title: "ISO 9001 Quality Management Certificate",
        status: "ACTIVE",
        evidenceSummary: null,
        referenceNumber: "ISO-12345",
        expiryDate: null,
        trustLevel: "AI_DRAFT",
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        sourceDocumentId: "source-1",
        sourceDocument,
      }),
    ];

    assert.deepEqual(records.map((record) => record.kind), ["LEGAL", "FINANCIAL", "COMPLIANCE"]);
    assert.ok(records.every((record) => record.canReview));
    assert.ok(records.every((record) => !("sourceDocument" in record)));
    assert.ok(records.every((record) => !("extractedText" in record)));
    assert.match(records[0]!.secondary, /GC-7788/);
    assert.match(records[1]!.secondary, /ETB 5000000/);
    assert.match(records[2]!.secondary, /ISO-12345/);
  });

  it("keeps unsupported manual entries as explicitly manual drafts", () => {
    assert.deepEqual(manualSupportRecordDraftFields("LEGAL"), {
      trustLevel: "MANUAL_DRAFT",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: "Manual legal record awaiting source-backed human review.",
    });
  });

  it("wires all three support families through the single paginated Review Inbox", () => {
    const route = readFileSync("app/api/company/knowledge/repair/route.ts", "utf8");
    const page = readFileSync("app/dashboard/company/review/page.tsx", "utf8");
    for (const family of ["legal", "financial", "compliance"]) {
      assert.match(route, new RegExp(`${family}Page`));
      assert.match(page, new RegExp(`${family}Page`));
    }
    for (const kind of ["LEGAL", "FINANCIAL", "COMPLIANCE"]) {
      assert.match(route, new RegExp(`buildSupportReviewInboxRecord\\("${kind}"`));
      assert.match(page, new RegExp(`kind="${kind}"`));
    }
  });

  it("manual support-record POST routes cannot stamp REVIEWED or reviewer identity", () => {
    for (const path of [
      "app/api/company/legal-records/route.ts",
      "app/api/company/financial-records/route.ts",
      "app/api/company/compliance-records/route.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /manualSupportRecordDraftFields\(/);
      assert.doesNotMatch(source, /trustLevel:\s*"REVIEWED"/);
    }
  });
});

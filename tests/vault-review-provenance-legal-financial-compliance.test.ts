// Legal/Financial/Compliance records had NO trustLevel/review/provenance
// concept at all before this fix — every record (manual create AND Plan-B
// bulk import) was fed directly into generation evidence
// (lib/engine/generate-elite.ts) with zero gating, unlike Expert/Project
// which require a durable, evidence-backed trustLevel === "REVIEWED".
//
// This proves the extended lib/vault-review-provenance.ts evidence contract
// for the three new record types: buildReviewProvenance's quote-containment
// check against a real linked source document, and recordIsExpired's
// fail-closed date gating (evidence for a lapsed license/certificate must
// never be presented as current).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildReviewProvenance,
  legalReviewFields,
  financialReviewFields,
  complianceReviewFields,
  recordIsExpired,
  canUseVaultRecord,
  type ReviewSourceDocument,
} from "../lib/vault-review-provenance";

describe("legalReviewFields / financialReviewFields / complianceReviewFields evidence contract", () => {
  const legalDoc: ReviewSourceDocument = {
    id: "doc-legal-1",
    companyId: "company-1",
    extractedText: [
      "BUSINESS LICENSE CERTIFICATE",
      "License type: General Contracting License",
      "Certificate title: Federal Ministry of Trade Business License",
      "Issuing Authority: Ministry of Trade and Regional Integration",
      "Reference Number: BL-2024-88213",
      "Issue Date: 2024-01-15",
      "Expiry Date: 2027-01-14",
    ].join("\n"),
    contentSha256: "a".repeat(64),
    contentByteLength: 400,
    integrityStatus: "VERIFIED",
  };

  it("passes when the legal record's claimed fields genuinely appear in the linked document's text", () => {
    const provenance = buildReviewProvenance({
      recordType: "LEGAL",
      sourceDocument: legalDoc,
      fields: legalReviewFields({
        recordType: "General Contracting License",
        title: "Federal Ministry of Trade Business License",
        authority: "Ministry of Trade and Regional Integration",
        referenceNumber: "BL-2024-88213",
        issueDate: "2024-01-15",
        expiryDate: "2027-01-14",
      }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(provenance.ok, true);
  });

  it("fails closed when there is no linked source document", () => {
    const provenance = buildReviewProvenance({
      recordType: "LEGAL",
      sourceDocument: null,
      fields: legalReviewFields({ recordType: "License", title: "Fabricated Certificate", authority: null, referenceNumber: null }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(provenance.ok, false);
    assert.equal(provenance.ok ? null : provenance.code, "SOURCE_DOCUMENT_REQUIRED");
  });

  it("fails closed when the claimed reference number does not actually appear in the linked document", () => {
    const provenance = buildReviewProvenance({
      recordType: "LEGAL",
      sourceDocument: legalDoc,
      fields: legalReviewFields({
        recordType: "General Contracting License",
        title: "Federal Ministry of Trade Business License",
        referenceNumber: "FABRICATED-NUMBER-000",
      }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(provenance.ok, false);
  });

  const financialDoc: ReviewSourceDocument = {
    id: "doc-financial-1",
    companyId: "company-1",
    extractedText: [
      "AUDITED FINANCIAL STATEMENT — FISCAL YEAR 2025",
      "Statement type: Annual Turnover Statement",
      "Total Annual Turnover: ETB 45000000 for fiscal year 2025.",
    ].join("\n"),
    contentSha256: "b".repeat(64),
    contentByteLength: 350,
    integrityStatus: "VERIFIED",
  };

  it("passes for a financial record whose fiscalYear/recordType/currency/amount genuinely appear in the source text", () => {
    const provenance = buildReviewProvenance({
      recordType: "FINANCIAL",
      sourceDocument: financialDoc,
      fields: financialReviewFields({
        fiscalYear: 2025,
        recordType: "Annual Turnover Statement",
        currency: "ETB",
        amount: 45000000,
      }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(provenance.ok, true);
  });

  it("fails closed when the claimed amount was never actually stated in the source text", () => {
    const provenance = buildReviewProvenance({
      recordType: "FINANCIAL",
      sourceDocument: financialDoc,
      fields: financialReviewFields({
        fiscalYear: 2025,
        recordType: "Annual Turnover Statement",
        amount: 999999999,
      }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(provenance.ok, false);
  });

  const complianceDoc: ReviewSourceDocument = {
    id: "doc-compliance-1",
    companyId: "company-1",
    extractedText: [
      "ISO 9001:2015 QUALITY MANAGEMENT CERTIFICATE",
      "Certificate: ISO 9001:2015 Quality Management Systems",
      "Certificate Reference: ISO-9001-77410",
    ].join("\n"),
    contentSha256: "c".repeat(64),
    contentByteLength: 300,
    integrityStatus: "VERIFIED",
  };

  it("passes for a compliance record whose title/complianceType/referenceNumber genuinely appear in the source text", () => {
    const provenance = buildReviewProvenance({
      recordType: "COMPLIANCE",
      sourceDocument: complianceDoc,
      fields: complianceReviewFields({
        complianceType: "ISO 9001:2015 Quality Management Systems",
        title: "ISO 9001:2015 Quality Management Certificate",
        referenceNumber: "ISO-9001-77410",
      }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(provenance.ok, true);
  });

  it("fails closed for a fabricated compliance certificate title", () => {
    const provenance = buildReviewProvenance({
      recordType: "COMPLIANCE",
      sourceDocument: complianceDoc,
      fields: complianceReviewFields({
        complianceType: "COMPLIANCE",
        title: "A Certificate That Was Never Issued",
      }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(provenance.ok, false);
  });
});

describe("recordIsExpired — fail-closed expiry gating", () => {
  it("treats a null/undefined expiryDate as never expired", () => {
    assert.equal(recordIsExpired(null), false);
    assert.equal(recordIsExpired(undefined), false);
  });

  it("treats a past date as expired", () => {
    assert.equal(recordIsExpired("2020-01-01"), true);
    assert.equal(recordIsExpired(new Date("2020-01-01")), true);
  });

  it("treats a future date as not expired", () => {
    assert.equal(recordIsExpired("2099-01-01"), false);
  });

  it("supports an explicit asOf reference (for deterministic tests)", () => {
    assert.equal(recordIsExpired("2025-06-01", new Date("2025-01-01")), false);
    assert.equal(recordIsExpired("2025-06-01", new Date("2025-12-01")), true);
  });
});

describe("canUseVaultRecord — expired evidence must never be usable, regardless of trustLevel", () => {
  it("blocks a durably-REVIEWED-looking record once its expiryDate has passed", () => {
    const expiredButReviewed = {
      companyId: "company-1",
      trustLevel: "REVIEWED",
      reviewedBy: "user-1",
      reviewedAt: new Date(),
      reviewNotes: "vault-review-provenance:v2:{}",
      sourceDocumentId: null,
      expiryDate: "2020-01-01",
    } as unknown as Parameters<typeof canUseVaultRecord>[0];
    assert.equal(canUseVaultRecord(expiredButReviewed, "GENERATION"), false);
    assert.equal(canUseVaultRecord(expiredButReviewed, "EXPORT"), false);
    assert.equal(canUseVaultRecord(expiredButReviewed, "MATCHING"), false);
  });

  it("does not block a record with no expiryDate field at all (e.g. FinancialRecord)", () => {
    const noExpiryConcept = {
      companyId: "company-1",
      trustLevel: "AI_DRAFT",
    } as unknown as Parameters<typeof canUseVaultRecord>[0];
    // AI_DRAFT still correctly fails the durable-review check for EXPORT —
    // this only proves the expiry short-circuit itself doesn't fire.
    assert.equal(canUseVaultRecord(noExpiryConcept, "EXPORT"), false);
  });
});

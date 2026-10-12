// Defect 4: FIELD_EVIDENCE_REQUIRED partial verification tests.
//
// buildPartialSourceVerificationProvenance succeeds when at least the
// identity field is verified, even if other fields are missing from source
// text. canUseVaultRecordField returns true for verified fields and false
// for unverified fields on the same record.
//
// Identity fields:
//   EXPERT  → fullName
//   PROJECT → name
//   LEGAL   → title
//   FINANCIAL → (fiscalYear + recordType)
//   COMPLIANCE → title

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildPartialSourceVerificationProvenance,
  canUseVaultRecordField,
  expertReviewFields,
  projectReviewFields,
  legalReviewFields,
  financialReviewFields,
  complianceReviewFields,
  type ReviewSourceDocument,
  type ReviewRecordState,
} from "../lib/vault-review-provenance";

const goodDoc: ReviewSourceDocument = {
  id: "doc-1",
  companyId: "company-1",
  extractedText: [
    "CURRICULUM VITAE",
    "Name of Expert: Fatima Al-Rashid",
    "Proposed Position: Senior Water Engineer",
    "18 years of professional experience in water and sanitation infrastructure.",
  ].join("\n"),
  contentSha256: "a".repeat(64),
  contentByteLength: 500,
  integrityStatus: "VERIFIED",
};

describe("Defect 4 — buildPartialSourceVerificationProvenance (Expert)", () => {
  it("succeeds when fullName is verified even if yearsExperience is missing from source text", () => {
    const result = buildPartialSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: goodDoc,
      fields: expertReviewFields({
        fullName: "Fatima Al-Rashid",
        title: "Senior Water Engineer",
        yearsExperience: 18, // this value IS in the text ("18 years of professional experience")
        disciplines: JSON.stringify([]),
        sectors: JSON.stringify([]),
        certifications: JSON.stringify([]),
      }),
      verificationMethod: "AI",
    });
    // All three fields appear in the text — full verification.
    assert.equal(result.ok, true);
    assert.deepEqual(result.verifiedFields.sort(), ["fullName", "title", "yearsExperience"].sort());
    assert.equal(result.unverifiedFields.length, 0);
    assert.ok(result.serialized);
  });

  it("succeeds when fullName is verified but yearsExperience value is DIFFERENT from source text", () => {
    // The CV says "18 years" but the imported record claims 25 years.
    // The old gate (buildSourceVerificationProvenance) would reject the
    // entire record. The new partial gate succeeds because the identity
    // (fullName) IS verified; yearsExperience stays in unverifiedFields
    // and canUseVaultRecordField returns false for it.
    const result = buildPartialSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: goodDoc,
      fields: expertReviewFields({
        fullName: "Fatima Al-Rashid",
        title: "Senior Water Engineer",
        yearsExperience: 25, // not in source text — only "18 years" appears
        disciplines: JSON.stringify([]),
        sectors: JSON.stringify([]),
        certifications: JSON.stringify([]),
      }),
      verificationMethod: "AI",
    });
    assert.equal(result.ok, true, "identity (fullName) is verified → record is SOURCE_VERIFIED");
    assert.ok(result.verifiedFields.includes("fullName"));
    assert.ok(result.verifiedFields.includes("title"));
    assert.ok(result.unverifiedFields.includes("yearsExperience"), "yearsExperience stays unverified");
    assert.ok(result.serialized);
  });

  it("fails closed when the identity field (fullName) is NOT in source text", () => {
    const result = buildPartialSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: goodDoc,
      fields: expertReviewFields({
        fullName: "A Completely Different Person Not In The Text",
        title: null,
        yearsExperience: null,
        disciplines: JSON.stringify([]),
        sectors: JSON.stringify([]),
        certifications: JSON.stringify([]),
      }),
      verificationMethod: "AI",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "FIELD_EVIDENCE_REQUIRED");
    assert.ok(result.unverifiedFields.includes("fullName"));
    assert.equal(result.serialized, null);
  });

  it("fails closed when there is no source document", () => {
    const result = buildPartialSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: null,
      fields: expertReviewFields({
        fullName: "Anyone",
        title: null,
        yearsExperience: null,
        disciplines: JSON.stringify([]),
        sectors: JSON.stringify([]),
        certifications: JSON.stringify([]),
      }),
      verificationMethod: "AI",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "SOURCE_DOCUMENT_REQUIRED");
  });

  it("fails closed when source bytes are not verified (integrityStatus !== VERIFIED)", () => {
    const result = buildPartialSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: { ...goodDoc, integrityStatus: "UNKNOWN" },
      fields: expertReviewFields({
        fullName: "Fatima Al-Rashid",
        title: null,
        yearsExperience: null,
        disciplines: JSON.stringify([]),
        sectors: JSON.stringify([]),
        certifications: JSON.stringify([]),
      }),
      verificationMethod: "AI",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "PROVENANCE_REQUIRED");
  });
});

describe("Defect 4 — buildPartialSourceVerificationProvenance (Project)", () => {
  it("succeeds when project name is verified even if contractValue is missing", () => {
    const projectDoc: ReviewSourceDocument = {
      id: "doc-2",
      companyId: "company-1",
      extractedText: "Project: Addis Ababa Water Supply Rehabilitation. Client: Addis Ababa Water and Sewerage Authority. Country: Ethiopia. Sector: Water.",
      contentSha256: "b".repeat(64),
      contentByteLength: 300,
      integrityStatus: "VERIFIED",
    };
    const result = buildPartialSourceVerificationProvenance({
      recordType: "PROJECT",
      sourceDocument: projectDoc,
      fields: projectReviewFields({
        name: "Addis Ababa Water Supply Rehabilitation",
        clientName: "Addis Ababa Water and Sewerage Authority",
        country: null,
        sector: null,
        serviceAreas: JSON.stringify([]),
        contractValue: 5_000_000, // not in source text
        currency: null,
      }),
      verificationMethod: "AI",
    });
    assert.equal(result.ok, true);
    assert.ok(result.verifiedFields.includes("name"));
    assert.ok(result.verifiedFields.includes("clientName"));
    assert.ok(result.unverifiedFields.includes("contractValue"));
  });

  it("fails closed when the project name is NOT in source text", () => {
    const projectDoc: ReviewSourceDocument = {
      id: "doc-2",
      companyId: "company-1",
      extractedText: "Project: Some Other Project Entirely. Client: Someone Else. Country: Kenya. Sector: Buildings. Duration: 24 months. Contract value: 4,500,000 USD.",
      contentSha256: "b".repeat(64),
      contentByteLength: 300,
      integrityStatus: "VERIFIED",
    };
    const result = buildPartialSourceVerificationProvenance({
      recordType: "PROJECT",
      sourceDocument: projectDoc,
      fields: projectReviewFields({
        name: "A Project That Was Never Mentioned Anywhere",
        clientName: null,
        country: null,
        sector: null,
        serviceAreas: JSON.stringify([]),
      }),
      verificationMethod: "AI",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "FIELD_EVIDENCE_REQUIRED");
    assert.ok(result.unverifiedFields.includes("name"));
  });
});

describe("Defect 4 — buildPartialSourceVerificationProvenance (Legal/Financial/Compliance)", () => {
  it("LEGAL: succeeds when title is verified, fails closed when title is missing", () => {
    const doc: ReviewSourceDocument = {
      id: "doc-legal",
      companyId: "company-1",
      extractedText: "BUSINESS LICENSE CERTIFICATE. License type: General Contracting License. Reference Number: BL-99101.",
      contentSha256: "c".repeat(64),
      contentByteLength: 200,
      integrityStatus: "VERIFIED",
    };
    const ok = buildPartialSourceVerificationProvenance({
      recordType: "LEGAL",
      sourceDocument: doc,
      fields: legalReviewFields({ recordType: "General Contracting License", title: "Business License Certificate", referenceNumber: "BL-99101" }),
      verificationMethod: "AI",
    });
    assert.equal(ok.ok, true);
    assert.ok(ok.verifiedFields.includes("title"));

    const bad = buildPartialSourceVerificationProvenance({
      recordType: "LEGAL",
      sourceDocument: doc,
      fields: legalReviewFields({ recordType: "General Contracting License", title: "A License That Does Not Exist" }),
      verificationMethod: "AI",
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "FIELD_EVIDENCE_REQUIRED");
    assert.ok(bad.unverifiedFields.includes("title"));
  });

  it("FINANCIAL: succeeds when fiscalYear AND recordType are both verified (composite identity)", () => {
    const doc: ReviewSourceDocument = {
      id: "doc-fin",
      companyId: "company-1",
      extractedText: "AUDITED FINANCIAL STATEMENT FOR FISCAL YEAR 2025. Statement type: Annual Turnover Statement. Currency: ETB. Amount: 5000000.",
      contentSha256: "d".repeat(64),
      contentByteLength: 200,
      integrityStatus: "VERIFIED",
    };
    const ok = buildPartialSourceVerificationProvenance({
      recordType: "FINANCIAL",
      sourceDocument: doc,
      fields: financialReviewFields({ fiscalYear: 2025, recordType: "Annual Turnover Statement", currency: null, amount: null }),
      verificationMethod: "AI",
    });
    assert.equal(ok.ok, true);
    assert.ok(ok.verifiedFields.includes("fiscalYear"));
    assert.ok(ok.verifiedFields.includes("recordType"));
  });

  it("FINANCIAL: fails closed when only one of (fiscalYear, recordType) is verified", () => {
    const doc: ReviewSourceDocument = {
      id: "doc-fin",
      companyId: "company-1",
      extractedText: "AUDITED FINANCIAL STATEMENT FOR FISCAL YEAR 2025. Statement type: Annual Turnover Statement. Currency: ETB.",
      contentSha256: "d".repeat(64),
      contentByteLength: 200,
      integrityStatus: "VERIFIED",
    };
    // fiscalYear matches "2025" but recordType "Wrong Type" does not appear.
    const result = buildPartialSourceVerificationProvenance({
      recordType: "FINANCIAL",
      sourceDocument: doc,
      fields: financialReviewFields({ fiscalYear: 2025, recordType: "Wrong Type" }),
      verificationMethod: "AI",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "FIELD_EVIDENCE_REQUIRED");
    assert.ok(result.unverifiedFields.includes("recordType"));
  });

  it("COMPLIANCE: succeeds when title is verified", () => {
    const doc: ReviewSourceDocument = {
      id: "doc-cmp",
      companyId: "company-1",
      extractedText: "ISO 9001:2015 QUALITY MANAGEMENT CERTIFICATE. Certificate Reference: ISO-12345. Issued by International Standards Organization.",
      contentSha256: "e".repeat(64),
      contentByteLength: 200,
      integrityStatus: "VERIFIED",
    };
    const ok = buildPartialSourceVerificationProvenance({
      recordType: "COMPLIANCE",
      sourceDocument: doc,
      fields: complianceReviewFields({ complianceType: "ISO", title: "ISO 9001:2015 Quality Management Certificate", referenceNumber: "ISO-12345" }),
      verificationMethod: "AI",
    });
    assert.equal(ok.ok, true);
    assert.ok(ok.verifiedFields.includes("title"));
  });
});

describe("Defect 4 — canUseVaultRecordField per-field trust", () => {
  it("returns true for verified fields and false for unverified fields on the same record", () => {
    // Build a partial verification: fullName verified, yearsExperience NOT.
    const result = buildPartialSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: goodDoc,
      fields: expertReviewFields({
        fullName: "Fatima Al-Rashid",
        title: "Senior Water Engineer",
        yearsExperience: 25, // not in source text
        disciplines: JSON.stringify([]),
        sectors: JSON.stringify([]),
        certifications: JSON.stringify([]),
      }),
      verificationMethod: "AI",
    });
    assert.equal(result.ok, true);

    // Construct a ReviewRecordState that the consumer would load from the DB.
    const record: ReviewRecordState = {
      trustLevel: "SOURCE_VERIFIED",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: result.serialized!,
      sourceDocumentId: goodDoc.id,
      sourceDocument: goodDoc,
      companyId: "company-1",
      // Include the identity fields canUseVaultRecordField needs to verify
      // provenance still matches the current record state.
      fullName: "Fatima Al-Rashid",
      title: "Senior Water Engineer",
      yearsExperience: 25,
      disciplines: JSON.stringify([]),
      sectors: JSON.stringify([]),
      certifications: JSON.stringify([]),
    } as unknown as ReviewRecordState;

    // fullName is verified → can use
    assert.equal(canUseVaultRecordField(record, "fullName"), true);
    // title is verified → can use
    assert.equal(canUseVaultRecordField(record, "title"), true);
    // yearsExperience is NOT verified → cannot use
    assert.equal(canUseVaultRecordField(record, "yearsExperience"), false);
  });

  it("returns false for every field when the record is not durably verified", () => {
    const record: ReviewRecordState = {
      trustLevel: "AI_DRAFT",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      sourceDocumentId: null,
      sourceDocument: null,
    } as unknown as ReviewRecordState;
    assert.equal(canUseVaultRecordField(record, "fullName"), false);
    assert.equal(canUseVaultRecordField(record, "title"), false);
    assert.equal(canUseVaultRecordField(record, "yearsExperience"), false);
  });

  it("returns false for a field name that does not appear in the provenance payload", () => {
    const result = buildPartialSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: goodDoc,
      fields: expertReviewFields({
        fullName: "Fatima Al-Rashid",
        title: "Senior Water Engineer",
        yearsExperience: 18,
        disciplines: JSON.stringify([]),
        sectors: JSON.stringify([]),
        certifications: JSON.stringify([]),
      }),
      verificationMethod: "AI",
    });
    assert.equal(result.ok, true);
    const record: ReviewRecordState = {
      trustLevel: "SOURCE_VERIFIED",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: result.serialized!,
      sourceDocumentId: goodDoc.id,
      sourceDocument: goodDoc,
      companyId: "company-1",
      fullName: "Fatima Al-Rashid",
      title: "Senior Water Engineer",
      yearsExperience: 18,
      disciplines: JSON.stringify([]),
      sectors: JSON.stringify([]),
      certifications: JSON.stringify([]),
    } as unknown as ReviewRecordState;
    // A field that was never part of the provenance payload.
    assert.equal(canUseVaultRecordField(record, "nonexistentField"), false);
  });
});

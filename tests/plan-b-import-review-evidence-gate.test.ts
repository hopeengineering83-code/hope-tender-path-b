// Plan B import: bulk import never persists REVIEWED, never writes
// reviewedBy/reviewedAt, and never accepts a caller-declared trust of
// REVIEWED. Stored bytes that pass the same source-verification gate
// the automatic Company Vault verifier uses (buildSourceVerificationProvenance,
// the same function lib/company-auto-verification.ts calls) promote the
// record to SOURCE_VERIFIED with null reviewer identity; anything else
// stays at AI_DRAFT so the next autoVerifyCompanyKnowledge pass
// re-decides. A caller that still sends `trustLevel: "REVIEWED"` is
// silently treated as if it had sent `AI_DRAFT` — the evidence-gate
// runs and may upgrade to SOURCE_VERIFIED, but no human-approval state
// is ever fabricated.
//
// This test proves the underlying evidence contract the route now
// depends on — the same buildSourceVerificationProvenance /
// expertReviewFields / projectReviewFields / legalReviewFields /
// financialReviewFields / complianceReviewFields functions, called with
// the same field shapes the route constructs — since exercising the
// full authenticated HTTP route requires Next.js request/session
// plumbing this suite doesn't otherwise mock.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  buildSourceVerificationProvenance,
  expertReviewFields,
  projectReviewFields,
  legalReviewFields,
  financialReviewFields,
  complianceReviewFields,
  type ReviewSourceDocument,
} from "../lib/vault-review-provenance";

const route = readFileSync("app/api/company/plan-b-import/route.ts", "utf8");

describe("plan-b-import refuses to persist REVIEWED and routes through source verification", () => {
  it("imports buildSourceVerificationProvenance (not buildReviewProvenance) from vault-review-provenance", () => {
    assert.match(route, /import \{[^}]*buildSourceVerificationProvenance[^}]*\} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/vault-review-provenance"/);
    assert.doesNotMatch(route, /buildReviewProvenance\(/);
  });

  it("default requested trust is AI_DRAFT, not REVIEWED", () => {
    // The default branch of requestedTrust() returns "AI_DRAFT".
    const idx = route.indexOf("function requestedTrust(");
    assert.ok(idx > -1, "requestedTrust must exist");
    const region = route.slice(idx, idx + 400);
    assert.match(region, /return requested === "AI_DRAFT" \|\| requested === "REGEX_DRAFT" \|\| requested === "REVIEWED" \|\| requested === "SOURCE_VERIFIED"/);
    assert.match(region, /: "AI_DRAFT"/);
  });

  it("all five upsert sites write reviewedBy: null and reviewedAt: null (no fabricated reviewer)", () => {
    // There must be no remaining `reviewedBy: ... ? userId : null` or
    // `reviewedAt: ... ? now : null` patterns anywhere in the route.
    assert.doesNotMatch(route, /reviewedBy:\s*effectiveTrust\s*===\s*"REVIEWED"\s*\?\s*\w+/);
    assert.doesNotMatch(route, /reviewedAt:\s*effectiveTrust\s*===\s*"REVIEWED"\s*\?\s*\w+/);
    // The route must NOT contain any literal persistence of trustLevel: "REVIEWED"
    // as data (a `trustLevel: "REVIEWED"` token in a data: { ... } object).
    // Comments mentioning "REVIEWED" are fine — only the persisted value matters.
    // Strip // comments and /* */ comments before scanning.
    const stripped = route
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(stripped, /trustLevel:\s*"REVIEWED"/);
  });

  it("uses decidePlanBTrust helper that returns SOURCE_VERIFIED or AI_DRAFT, never REVIEWED", () => {
    const idx = route.indexOf("function decidePlanBTrust(");
    assert.ok(idx > -1, "decidePlanBTrust must exist");
    // Defect 4: the function is longer now because it tries full verification
    // first, then partial, then falls back to AI_DRAFT. Use a larger slice.
    const region = route.slice(idx, idx + 3000);
    assert.match(region, /buildSourceVerificationProvenance\(/);
    assert.match(region, /trustLevel: "SOURCE_VERIFIED"/);
    assert.match(region, /trustLevel: "AI_DRAFT"/);
    // Defect 4: the function must also call buildPartialSourceVerificationProvenance
    // so identity-verified records with unverified inferred fields become
    // SOURCE_VERIFIED instead of being rejected as AI_DRAFT.
    assert.match(region, /buildPartialSourceVerificationProvenance\(/);
  });

  it("links the created record to a real persisted CompanyDocument via sourceDocumentId", () => {
    assert.match(route, /sourceDocumentId: linkedSourceDoc\?\.id \?\? null/);
    assert.match(route, /documentByFileName\.set\(/);
  });

  it("response reports requestedTrust and persistedTrustRange (no trustLevel field that could read REVIEWED)", () => {
    assert.match(route, /requestedTrust: importTrust/);
    assert.match(route, /persistedTrustRange:\s*\["SOURCE_VERIFIED", "AI_DRAFT"\]/);
    assert.doesNotMatch(route, /\n\s*trustLevel:\s*importTrust,/);
  });
});

describe("buildSourceVerificationProvenance evidence contract (as wired by plan-b-import)", () => {
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

  it("passes when the expert's claimed fields genuinely appear in the linked document's text", () => {
    const provenance = buildSourceVerificationProvenance({
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
    assert.equal(provenance.ok, true);
  });

  it("fails closed when there is no linked source document at all (the old default-REVIEWED path)", () => {
    const provenance = buildSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: null,
      fields: expertReviewFields({
        fullName: "Fabricated Name",
        title: null,
        yearsExperience: null,
        disciplines: JSON.stringify([]),
        sectors: JSON.stringify([]),
        certifications: JSON.stringify([]),
      }),
      verificationMethod: "AI",
    });
    assert.equal(provenance.ok, false);
  });

  it("fails closed when the claimed fields do not actually appear in the linked document's text", () => {
    const provenance = buildSourceVerificationProvenance({
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
    assert.equal(provenance.ok, false);
  });

  it("the same gate applies to projects (projectReviewFields)", () => {
    const projectDoc: ReviewSourceDocument = {
      id: "doc-2",
      companyId: "company-1",
      extractedText: "Project: Addis Ababa Water Supply Rehabilitation. Client: Addis Ababa Water and Sewerage Authority. Country: Ethiopia.",
      contentSha256: "b".repeat(64),
      contentByteLength: 300,
      integrityStatus: "VERIFIED",
    };
    const ok = buildSourceVerificationProvenance({
      recordType: "PROJECT",
      sourceDocument: projectDoc,
      fields: projectReviewFields({
        name: "Addis Ababa Water Supply Rehabilitation",
        clientName: "Addis Ababa Water and Sewerage Authority",
        country: "Ethiopia",
        sector: null,
        serviceAreas: JSON.stringify([]),
      }),
      verificationMethod: "AI",
    });
    assert.equal(ok.ok, true);

    const fabricated = buildSourceVerificationProvenance({
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
    assert.equal(fabricated.ok, false);
  });
});

// Legal/Financial/Compliance records get the same source-verification
// gate as Expert/Project — same evidence contract, same fail-closed
// behavior, same refusal to persist REVIEWED.
describe("plan-b-import wires the same source-verification gate for legal/financial/compliance records", () => {
  it("imports legalReviewFields/financialReviewFields/complianceReviewFields and calls decidePlanBTrust for each type", () => {
    assert.match(route, /import \{[^}]*legalReviewFields[^}]*\} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/vault-review-provenance"/);
    assert.match(route, /recordType: "LEGAL"/);
    assert.match(route, /recordType: "FINANCIAL"/);
    assert.match(route, /recordType: "COMPLIANCE"/);
  });

  it("upsertLegalRecord/upsertFinancialRecord/upsertComplianceRecord each call decidePlanBTrust and persist reviewedBy: null, reviewedAt: null", () => {
    for (const fn of ["upsertLegalRecord", "upsertFinancialRecord", "upsertComplianceRecord"]) {
      const idx = route.indexOf(`async function ${fn}(`);
      assert.ok(idx > -1, `${fn} must exist`);
      const region = route.slice(idx, idx + 2400);
      assert.match(region, /decidePlanBTrust\(/);
      assert.match(region, /reviewedBy: null/);
      assert.match(region, /reviewedAt: null/);
      assert.match(region, /sourceDocumentId: linkedSourceDoc\?\.id \?\? null/);
    }
  });

  it("the call sites thread documentByFileName/documentBySha256/importTrust/userId/now/notes through a shared context, and roll up evidenceDowngraded/warnings", () => {
    assert.match(route, /const recordTrustCtx: PlanBRecordTrustContext = \{ documentByFileName, documentBySha256, importTrust, userId, now, notes \};/);
    assert.match(route, /upsertLegalRecord\(tx, company\.id, record, recordTrustCtx\)/);
    assert.match(route, /upsertFinancialRecord\(tx, company\.id, record, recordTrustCtx\)/);
    assert.match(route, /upsertComplianceRecord\(tx, company\.id, record, recordTrustCtx\)/);
  });

  it("buildSourceVerificationProvenance passes for a genuinely matching legal record and fails closed for a fabricated one", () => {
    const doc: ReviewSourceDocument = {
      id: "doc-legal-1",
      companyId: "company-1",
      extractedText: "BUSINESS LICENSE CERTIFICATE. License type: General Contracting License. Reference Number: BL-99101. Issuing Authority: Ministry of Trade and Regional Integration.",
      contentSha256: "d".repeat(64),
      contentByteLength: 200,
      integrityStatus: "VERIFIED",
    };
    const ok = buildSourceVerificationProvenance({
      recordType: "LEGAL",
      sourceDocument: doc,
      fields: legalReviewFields({ recordType: "General Contracting License", title: "General Contracting License", referenceNumber: "BL-99101" }),
      verificationMethod: "AI",
    });
    assert.equal(ok.ok, true);

    const fabricated = buildSourceVerificationProvenance({
      recordType: "LEGAL",
      sourceDocument: doc,
      fields: legalReviewFields({ recordType: "General Contracting License", title: "A License That Does Not Exist", referenceNumber: "FAKE-000" }),
      verificationMethod: "AI",
    });
    assert.equal(fabricated.ok, false);
  });

  it("the same gate applies to financial and compliance records", () => {
    const financialDoc: ReviewSourceDocument = {
      id: "doc-financial-1",
      companyId: "company-1",
      extractedText: "AUDITED FINANCIAL STATEMENT FOR FISCAL YEAR 2025. Statement type: Annual Turnover Statement. Total Annual Turnover: ETB 5000000 for fiscal year 2025.",
      contentSha256: "e".repeat(64),
      contentByteLength: 200,
      integrityStatus: "VERIFIED",
    };
    assert.equal(buildSourceVerificationProvenance({
      recordType: "FINANCIAL",
      sourceDocument: financialDoc,
      fields: financialReviewFields({ fiscalYear: 2025, recordType: "Annual Turnover Statement", currency: "ETB", amount: 5000000 }),
      verificationMethod: "AI",
    }).ok, true);
    assert.equal(buildSourceVerificationProvenance({
      recordType: "FINANCIAL",
      sourceDocument: financialDoc,
      fields: financialReviewFields({ fiscalYear: 2025, recordType: "Annual Turnover Statement", amount: 999 }),
      verificationMethod: "AI",
    }).ok, false);

    const complianceDoc: ReviewSourceDocument = {
      id: "doc-compliance-1",
      companyId: "company-1",
      extractedText: "ISO 9001:2015 QUALITY MANAGEMENT CERTIFICATE. Certificate: ISO 9001:2015 Quality Management Certificate. Certificate Reference: ISO-12345.",
      contentSha256: "f".repeat(64),
      contentByteLength: 200,
      integrityStatus: "VERIFIED",
    };
    assert.equal(buildSourceVerificationProvenance({
      recordType: "COMPLIANCE",
      sourceDocument: complianceDoc,
      fields: complianceReviewFields({ complianceType: "ISO", title: "ISO 9001:2015 Quality Management Certificate", referenceNumber: "ISO-12345" }),
      verificationMethod: "AI",
    }).ok, true);
    assert.equal(buildSourceVerificationProvenance({
      recordType: "COMPLIANCE",
      sourceDocument: complianceDoc,
      fields: complianceReviewFields({ complianceType: "ISO", title: "A Certificate Never Issued" }),
      verificationMethod: "AI",
    }).ok, false);
  });
});

// Plan-B bulk import used to set trustLevel: "REVIEWED" (including by
// DEFAULT when importPolicy.trustLevel was omitted) purely from the
// caller's self-declared value, with reviewedBy/reviewedAt stamped
// unconditionally. That bypassed the same buildReviewProvenance evidence
// gate every other path to "REVIEWED" enforces (app/api/company/experts/[id]
// and .../projects/[id]'s review actions) — no sourceDocumentId link was
// ever set, no quote-containment check ever ran, and downstream generation
// (lib/engine/generate-elite.ts) trusts trustLevel === "REVIEWED" alone. A
// caller could mark fabricated records "REVIEWED" and have them used
// directly as evidence in a generated, submitted proposal.
//
// The fix wires the exact same buildReviewProvenance() gate into
// app/api/company/plan-b-import/route.ts: a record can only persist as
// REVIEWED when it links to a real, persisted CompanyDocument (built from
// the payload's sourceDocuments) whose extractedText genuinely contains the
// record's claimed field values. Otherwise it is downgraded to AI_DRAFT and
// a warning is returned, regardless of what the caller requested.
//
// This test proves the underlying evidence contract the route now depends
// on — the same buildReviewProvenance/expertReviewFields/projectReviewFields
// functions, called with the same field shapes the route constructs — since
// exercising the full authenticated HTTP route requires Next.js
// request/session plumbing this suite doesn't otherwise mock.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  buildReviewProvenance,
  expertReviewFields,
  projectReviewFields,
  legalReviewFields,
  financialReviewFields,
  complianceReviewFields,
  type ReviewSourceDocument,
} from "../lib/vault-review-provenance";

const route = readFileSync("app/api/company/plan-b-import/route.ts", "utf8");

describe("plan-b-import wires the real review-evidence gate (no more self-declared REVIEWED)", () => {
  it("imports and calls buildReviewProvenance before trusting REVIEWED", () => {
    assert.match(route, /import \{[^}]*buildReviewProvenance[^}]*\} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/vault-review-provenance"/);
    assert.match(route, /buildReviewProvenance\(\{/);
  });

  it("downgrades to AI_DRAFT and never blindly trusts a self-declared REVIEWED", () => {
    const idx = route.indexOf('if (importTrust === "REVIEWED")');
    assert.ok(idx > -1, "the evidence-gate branch must exist");
    const region = route.slice(idx, idx + 700);
    assert.match(region, /provenance\.ok/);
    assert.match(region, /effectiveTrust = "AI_DRAFT"/);
    assert.match(region, /evidenceDowngraded \+= 1/);
  });

  it("links the created record to a real persisted CompanyDocument via sourceDocumentId", () => {
    assert.match(route, /sourceDocumentId: linkedSourceDoc\?\.id \?\? null/);
    assert.match(route, /documentByFileName\.set\(/);
  });
});

describe("buildReviewProvenance evidence contract (as wired by plan-b-import)", () => {
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
    const provenance = buildReviewProvenance({
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
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(provenance.ok, true);
  });

  it("fails closed when there is no linked source document at all (the old default-REVIEWED path)", () => {
    const provenance = buildReviewProvenance({
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
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(provenance.ok, false);
  });

  it("fails closed when the claimed fields do not actually appear in the linked document's text", () => {
    const provenance = buildReviewProvenance({
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
      reviewerId: "user-1",
      reviewedAt: new Date(),
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
    const ok = buildReviewProvenance({
      recordType: "PROJECT",
      sourceDocument: projectDoc,
      fields: projectReviewFields({
        name: "Addis Ababa Water Supply Rehabilitation",
        clientName: "Addis Ababa Water and Sewerage Authority",
        country: "Ethiopia",
        sector: null,
        serviceAreas: JSON.stringify([]),
      }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(ok.ok, true);

    const fabricated = buildReviewProvenance({
      recordType: "PROJECT",
      sourceDocument: projectDoc,
      fields: projectReviewFields({
        name: "A Project That Was Never Mentioned Anywhere",
        clientName: null,
        country: null,
        sector: null,
        serviceAreas: JSON.stringify([]),
      }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(fabricated.ok, false);
  });
});

// Legal/Financial/Compliance records previously had NO trustLevel concept at
// all — every Plan-B-imported record was fed directly into generation
// evidence regardless of the caller's importPolicy. This closes the same
// class of bug the Expert/Project fix above closed, for these three types.
describe("plan-b-import wires the same evidence gate for legal/financial/compliance records", () => {
  it("imports legalReviewFields/financialReviewFields/complianceReviewFields and calls buildReviewProvenance for each type", () => {
    assert.match(route, /import \{[^}]*legalReviewFields[^}]*\} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/vault-review-provenance"/);
    assert.match(route, /recordType: "LEGAL"/);
    assert.match(route, /recordType: "FINANCIAL"/);
    assert.match(route, /recordType: "COMPLIANCE"/);
  });

  it("upsertLegalRecord/upsertFinancialRecord/upsertComplianceRecord each downgrade to AI_DRAFT and never blindly trust a self-declared REVIEWED", () => {
    for (const fn of ["upsertLegalRecord", "upsertFinancialRecord", "upsertComplianceRecord"]) {
      const idx = route.indexOf(`async function ${fn}(`);
      assert.ok(idx > -1, `${fn} must exist`);
      const region = route.slice(idx, idx + 2400);
      assert.match(region, /provenance\.ok/);
      assert.match(region, /effectiveTrust = "AI_DRAFT"/);
      assert.match(region, /evidenceDowngraded = 1/);
      assert.match(region, /sourceDocumentId: linkedSourceDoc\?\.id \?\? null/);
    }
  });

  it("the call sites thread documentByFileName/importTrust/userId/now/notes through a shared context, and roll up evidenceDowngraded/warnings", () => {
    assert.match(route, /const recordTrustCtx: PlanBRecordTrustContext = \{ documentByFileName, importTrust, userId, now, notes \};/);
    assert.match(route, /upsertLegalRecord\(tx, company\.id, record, recordTrustCtx\)/);
    assert.match(route, /upsertFinancialRecord\(tx, company\.id, record, recordTrustCtx\)/);
    assert.match(route, /upsertComplianceRecord\(tx, company\.id, record, recordTrustCtx\)/);
  });

  it("buildReviewProvenance passes for a genuinely matching legal record and fails closed for a fabricated one", () => {
    const doc: ReviewSourceDocument = {
      id: "doc-legal-1",
      companyId: "company-1",
      extractedText: "BUSINESS LICENSE CERTIFICATE. License type: General Contracting License. Reference Number: BL-99101. Issuing Authority: Ministry of Trade and Regional Integration.",
      contentSha256: "d".repeat(64),
      contentByteLength: 200,
      integrityStatus: "VERIFIED",
    };
    const ok = buildReviewProvenance({
      recordType: "LEGAL",
      sourceDocument: doc,
      fields: legalReviewFields({ recordType: "General Contracting License", title: "General Contracting License", referenceNumber: "BL-99101" }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    });
    assert.equal(ok.ok, true);

    const fabricated = buildReviewProvenance({
      recordType: "LEGAL",
      sourceDocument: doc,
      fields: legalReviewFields({ recordType: "General Contracting License", title: "A License That Does Not Exist", referenceNumber: "FAKE-000" }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
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
    assert.equal(buildReviewProvenance({
      recordType: "FINANCIAL",
      sourceDocument: financialDoc,
      fields: financialReviewFields({ fiscalYear: 2025, recordType: "Annual Turnover Statement", currency: "ETB", amount: 5000000 }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    }).ok, true);
    assert.equal(buildReviewProvenance({
      recordType: "FINANCIAL",
      sourceDocument: financialDoc,
      fields: financialReviewFields({ fiscalYear: 2025, recordType: "Annual Turnover Statement", amount: 999 }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    }).ok, false);

    const complianceDoc: ReviewSourceDocument = {
      id: "doc-compliance-1",
      companyId: "company-1",
      extractedText: "ISO 9001:2015 QUALITY MANAGEMENT CERTIFICATE. Certificate: ISO 9001:2015 Quality Management Certificate. Certificate Reference: ISO-12345.",
      contentSha256: "f".repeat(64),
      contentByteLength: 200,
      integrityStatus: "VERIFIED",
    };
    assert.equal(buildReviewProvenance({
      recordType: "COMPLIANCE",
      sourceDocument: complianceDoc,
      fields: complianceReviewFields({ complianceType: "ISO", title: "ISO 9001:2015 Quality Management Certificate", referenceNumber: "ISO-12345" }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    }).ok, true);
    assert.equal(buildReviewProvenance({
      recordType: "COMPLIANCE",
      sourceDocument: complianceDoc,
      fields: complianceReviewFields({ complianceType: "ISO", title: "A Certificate Never Issued" }),
      reviewerId: "user-1",
      reviewedAt: new Date(),
    }).ok, false);
  });
});

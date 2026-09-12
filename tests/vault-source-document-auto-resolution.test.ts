/**
 * Owner UAT finding: the Requirements and Evidence panel demanded "Add the
 * missing expert CV source document to Company Vault" while the vault already
 * held the experts and three generated CVs sat Ready in the package.
 *
 * Cause: every verification query in autoVerifyCompanyKnowledge is scoped to
 * `sourceDocumentId: { not: null }`, so a record the extraction left unlinked
 * was never examined. It stayed a draft, canUseVaultRecord refused it, matching
 * skipped it, and the panel asked the owner to run the search the app had
 * declined to run.
 *
 * resolveUnlinkedVaultSourceDocuments performs that search using the verifier
 * itself, so it can only ever link what verification would then accept.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { deriveAutomaticSourceVerification } from "../lib/company-auto-verification";
import { expertReviewFields } from "../lib/vault-review-provenance";

const EXPERT = {
  fullName: "Daniel Getachew Tadesse",
  title: "Senior Water Resources Engineer",
  yearsExperience: 15,
  disciplines: JSON.stringify(["Water Resources Engineering"]),
  sectors: JSON.stringify(["Water Supply"]),
  certifications: JSON.stringify([]),
};

function documentContaining(text: string) {
  return {
    id: "doc-1",
    companyId: "company-1",
    extractedText: text,
    contentSha256: "a".repeat(64),
    contentByteLength: text.length,
    integrityStatus: "VERIFIED",
    metadata: "{}",
  };
}

describe("unlinked vault records are resolved against owned documents", () => {
  it("a document that names the expert promotes the record — no upload needed", () => {
    const document = documentContaining(
      "Company profile. Key personnel: Daniel Getachew Tadesse, Senior Water Resources Engineer, " +
      "15 years of professional experience. Disciplines: Water Resources Engineering. Sectors: Water Supply.",
    );
    const decision = deriveAutomaticSourceVerification({
      recordType: "EXPERT",
      sourceDocument: document,
      fields: expertReviewFields(EXPERT),
      priorTrustLevel: "AI_DRAFT",
    });
    assert.equal(decision.ok, true, "an owned document naming the expert must prove the record");
    if (decision.ok) {
      assert.equal(decision.reviewState.trustLevel, "SOURCE_VERIFIED");
    }
  });

  it("fails closed when no owned document proves the expert", () => {
    const decision = deriveAutomaticSourceVerification({
      recordType: "EXPERT",
      sourceDocument: documentContaining("Company profile with no personnel section whatsoever."),
      fields: expertReviewFields(EXPERT),
      priorTrustLevel: "AI_DRAFT",
    });
    assert.equal(decision.ok, false, "an unrelated document must never promote the record");
  });

  it("resolution refuses to link when there is no source document at all", () => {
    const decision = deriveAutomaticSourceVerification({
      recordType: "EXPERT",
      sourceDocument: null,
      fields: expertReviewFields(EXPERT),
      priorTrustLevel: "AI_DRAFT",
    });
    assert.equal(decision.ok, false);
  });
});

describe("auto-verification runs source-document resolution first", () => {
  const src = readFileSync("lib/company-auto-verification.ts", "utf8");

  it("exports the resolution pass", () => {
    assert.match(src, /export async function resolveUnlinkedVaultSourceDocuments/);
  });

  it("runs resolution before the verification queries", () => {
    const resolutionCall = src.indexOf("await resolveUnlinkedVaultSourceDocuments(companyId)");
    const expertQuery = src.indexOf("prisma.expert.findMany", src.indexOf("export async function autoVerifyCompanyKnowledge"));
    assert.ok(resolutionCall > -1, "autoVerifyCompanyKnowledge must invoke the resolution pass");
    assert.ok(
      resolutionCall < expertQuery,
      "resolution must run before the sourceDocumentId-scoped verification queries",
    );
  });

  it("links only what the verifier itself would promote", () => {
    // The candidate search must go through deriveAutomaticSourceVerification —
    // no second, looser matching rule may be introduced here.
    assert.match(
      src,
      /soleProvingDocument[\s\S]*?deriveAutomaticSourceVerification\(\{[\s\S]*?\}\)\.ok/,
    );
  });

  it("fails closed when two owned documents have indistinguishable authority", () => {
    // Picking either of two equally-proving documents would attribute the
    // record's provenance to a document that may not be its real source, so
    // ambiguity must leave the record unlinked.
    assert.match(src, /return proving\.length === 1 \? proving\[0\] : null;/);
    assert.doesNotMatch(src, /documents\.find\(\(document\) =>/);
  });

  it("only considers records the owner already owns, undeleted and machine-eligible", () => {
    assert.match(src, /sourceDocumentId: null, trustLevel: \{ in: MACHINE_ELIGIBLE_TRUST \}/);
    assert.match(src, /where: \{ companyId, deletedAt: null, sourceDocumentId: null/);
  });
});

describe("requirement coverage copy does not instruct an upload the app has not attempted", () => {
  const src = readFileSync("app/api/tenders/[id]/requirement-coverage/route.ts", "utf8");

  it("expert and project gaps report the completed automatic search", () => {
    assert.match(src, /Every Company Vault document was searched automatically/);
    assert.doesNotMatch(src, /Add the missing expert CV source document to Company Vault/);
    assert.doesNotMatch(src, /Add the missing project-reference source document to Company Vault/);
  });
});

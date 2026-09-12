import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildSourceVerificationProvenance, canUseVaultRecord, expertReviewFields } from "../lib/vault-review-provenance";
import {
  deriveTruthfulReleaseStatus,
  truthfulEvidenceMessage,
} from "../components/generation-action-panel";

test("live evidence release presentation is truthful", () => {
  const sourceText = "CURRICULUM VITAE\nName: Amina Noor\nTitle: Water Engineer\nAmina Noor has 12 years of Water Engineering experience delivering verified public infrastructure assignments.";
  const sourceDocument = {
    id: "owned-source",
    companyId: "company-1",
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText).digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
    metadata: JSON.stringify({ extractionRevision: 1 }),
  };
  const fields = { fullName: "Amina Noor", title: "Water Engineer", yearsExperience: 12, disciplines: JSON.stringify(["Water Engineering"]) };
  const provenance = buildSourceVerificationProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(fields),
    verificationMethod: "HYBRID",
  });
  assert.equal(provenance.ok, true, JSON.stringify(provenance));
  if (!provenance.ok) throw new Error("invalid source-verification fixture");
  const sourceVerified = {
    ...fields,
    companyId: "company-1",
    trustLevel: "SOURCE_VERIFIED",
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: provenance.serialized,
    sourceDocumentId: "owned-source",
    sourceDocument,
  };
  assert.equal(canUseVaultRecord(sourceVerified, "GENERATION"), true);

  const evidenceBlocked = {
    ready: false,
    counts: { selectedExperts: 0, reviewedExpertMatches: 0 },
    blockers: [{
      code: "ALL_EXPERTS_UNREVIEWED",
      message: "Selected expert matches are unreviewed. Review at least one selected expert before generation.",
    }],
    fullProposalBlockers: [{
      code: "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE",
      message: "1/4 mandatory requirements have FULL/SUBSTANTIAL coverage. Confirm more evidence.",
    }],
  };

  assert.equal(deriveTruthfulReleaseStatus(evidenceBlocked, null, null, false), "GENUINE_SOURCE_BLOCKED");
  assert.equal(deriveTruthfulReleaseStatus(evidenceBlocked, null, null, true), "PROCESSING_AUTOMATICALLY");

  const noSelection = truthfulEvidenceMessage(
    "ALL_EXPERTS_UNREVIEWED",
    evidenceBlocked.blockers[0].message,
    evidenceBlocked.counts,
  );
  assert.doesNotMatch(noSelection, /selected expert matches are unreviewed/i);
  assert.match(noSelection, /No eligible source-backed expert evidence/i);

  const eligibleUnselected = truthfulEvidenceMessage(
    "NO_SELECTED_REVIEWED_EXPERTS",
    "No reviewed experts have been selected as evidence yet",
    { selectedExperts: 0, reviewedExpertMatches: 1 },
  );
  assert.match(eligibleUnselected, /Eligible source-backed expert matches exist, but none are selected/i);

  const coverage = truthfulEvidenceMessage(
    "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE",
    evidenceBlocked.fullProposalBlockers[0].message,
    evidenceBlocked.counts,
  );
  assert.doesNotMatch(coverage, /Confirm more evidence/i);
  assert.match(coverage, /Add genuine owned source evidence for unsupported requirements/i);
});

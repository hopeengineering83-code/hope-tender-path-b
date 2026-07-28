import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { fallbackProposal, selectReviewedEvidenceForAIDraft } from "../lib/engine/ai-proposal-fallback";
import { buildSourceVerificationProvenance, expertReviewFields } from "../lib/vault-review-provenance";

function build(requirements: string[]) {
  return fallbackProposal({
    tenderTitle: "Sample Tender",
    requirements,
    companyName: "Hope",
    companyProfile: "Reviewed profile.",
    serviceLines: "Design, Supervision",
    expertLines: ["Dr A | Team Lead"],
    projectLines: ["Project X | Client Y"],
    differentiators: ["Strong hospital track record"],
    submissionRules: ["Submit technical envelope only"],
    aiError: "provider timeout",
  });
}

describe("ai-proposal fallback is tender-scoped", () => {
  it("does not force technical/team/project sections when not required", () => {
    const out = build(["MANDATORY FORM: Signed declaration"]);
    assert.ok(!out.includes("## Proposed Team"));
    assert.ok(!out.includes("## Relevant Experience"));
    assert.ok(!out.includes("## Technical Response"));
    assert.ok(!out.includes("## Evidence-Backed Differentiators"));
    assert.ok(!out.includes("Service lines in company vault"));
  });

  it("includes only sections implied by requirements", () => {
    const out = build([
      "MANDATORY EXPERT: Team Leader CV",
      "MANDATORY PROJECT_EXPERIENCE: similar project references",
      "MANDATORY TECHNICAL: methodology and workplan",
    ]);
    assert.ok(out.includes("## Proposed Team"));
    assert.ok(out.includes("## Relevant Experience"));
    assert.ok(out.includes("## Technical Response"));
    assert.ok(out.includes("## Evidence-Backed Differentiators"));
  });

  it("does not expose raw provider error details in fallback body", () => {
    const out = build(["MANDATORY FORM: Signed declaration"]);
    assert.ok(!out.includes("provider timeout"));
  });
});

describe("selectReviewedEvidenceForAIDraft", () => {
  // Eligibility is decided by canUseVaultRecord(..., "GENERATION"), so a bare
  // { trustLevel: "REVIEWED" } object is correctly NOT usable — it carries no
  // provenance binding it to any owned, byte-verified source document. These
  // fixtures therefore build real durable provenance; the assertions below
  // still test the same thing they always did (selected wins over vault, vault
  // is the fallback, drafts are never returned).
  function usable(id: number) {
    const companyId = "company-ai-proposal-fallback-scope";
    const fullName = `Expert ${id}`;
    const text = [
      "CURRICULUM VITAE",
      `Name of Key Expert: ${fullName}`,
      `${fullName} is a Senior Consultant with 15 years of experience in General Consultancy Services.`,
    ].join("\n");
    const sourceDocument = {
      id: `doc-${id}`,
      companyId,
      extractedText: text,
      contentSha256: createHash("sha256").update(text).digest("hex"),
      contentByteLength: Buffer.byteLength(text),
      integrityStatus: "VERIFIED",
      metadata: JSON.stringify({ extractionRevision: 1 }),
    };
    const fields = {
      fullName,
      title: "Senior Consultant",
      yearsExperience: 15,
      disciplines: JSON.stringify(["General Consultancy Services"]),
      sectors: JSON.stringify([]),
      certifications: JSON.stringify([]),
    };
    const provenance = buildSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument,
      fields: expertReviewFields(fields),
      verificationMethod: "HYBRID",
    });
    assert.equal(provenance.ok, true);
    if (!provenance.ok) throw new Error("fixture provenance failed");
    return {
      ...fields,
      id,
      companyId,
      trustLevel: "SOURCE_VERIFIED",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: provenance.serialized,
      sourceDocumentId: sourceDocument.id,
      sourceDocument,
    };
  }
  const draft = (id: number, trustLevel: string) => ({ trustLevel, id });

  it("uses usable selected evidence when present", () => {
    const out = selectReviewedEvidenceForAIDraft(
      [usable(1), draft(2, "AI_DRAFT") as unknown as ReturnType<typeof usable>],
      [usable(3)],
    );
    assert.deepEqual(out.evidence.map((x) => x.id), [1]);
    assert.equal(out.usedReviewedVaultFallback, false);
  });

  it("falls back to usable vault evidence when the selected set has none", () => {
    const out = selectReviewedEvidenceForAIDraft(
      [draft(2, "AI_DRAFT") as unknown as ReturnType<typeof usable>],
      [usable(3)],
    );
    assert.deepEqual(out.evidence.map((x) => x.id), [3]);
    assert.equal(out.usedReviewedVaultFallback, true);
  });

  it("never returns draft rows when no usable evidence exists", () => {
    const out = selectReviewedEvidenceForAIDraft(
      [draft(2, "AI_DRAFT"), draft(4, "REGEX_DRAFT")],
      [],
    );
    assert.deepEqual(out.evidence, []);
    assert.equal(out.usedReviewedVaultFallback, false);
  });
});

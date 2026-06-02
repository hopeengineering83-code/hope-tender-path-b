// Regression tests for Gap 9 — reconcileGeneratedDocuments.
//
// Pins the four stale docs from the production screenshot to their
// expected reconciliation actions when the current plan no longer
// contains them:
//   • "Financial capacity and audited statement evidence.pdf"
//   • "Submission method, deadline and delivery rules.docx"
//   • "Tender forms and templates.docx"
//   • "Legal eligibility, registration and licensing evidence.docx"

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { reconcileGeneratedDocuments, applyReconcileDecisions } from "../lib/engine/reconcile-generated-docs";
import type { SubmissionPlan, GeneratedDocumentLike } from "../lib/engine/submission-plan";

const emptyPlan: SubmissionPlan = {
  tenderId: "t1",
  files: [],
  quantityRules: [],
  forbiddenContentRules: [],
  brandingRules: { letterheadAllowed: true, signatureAllowed: true, stampAllowed: true, coverPageAllowed: true },
  warnings: [],
};

function planWith(...files: Array<{ id: string; name: string; type?: string; format?: "PDF" | "DOCX" }>): SubmissionPlan {
  return {
    ...emptyPlan,
    files: files.map((f, idx) => ({
      canonicalId: f.id,
      exactFileName: f.name,
      documentType: f.type ?? "GENERIC",
      required: true,
      exactOrder: idx + 1,
      format: f.format ?? "PDF",
      envelope: "TECHNICAL" as const,
      sourceRequirementIds: [],
    })),
  };
}

describe("reconcileGeneratedDocuments — exact and normalised matches", () => {
  it("exact filename match keeps the doc as planned", () => {
    const plan = planWith({ id: "f1", name: "Technical Proposal.pdf" });
    const docs: GeneratedDocumentLike[] = [{ id: "d1", name: "Technical Proposal", exactFileName: "Technical Proposal.pdf" }];
    const [decision] = reconcileGeneratedDocuments({ plan, generatedDocuments: docs });
    assert.equal(decision.action, "KEEP_AS_PLANNED");
    assert.equal(decision.matchedPlanFileId, "f1");
  });

  it("normalised match keeps when only case/extension/separators differ", () => {
    const plan = planWith({ id: "f1", name: "Technical Proposal.pdf" });
    const docs: GeneratedDocumentLike[] = [{ id: "d1", name: "technical_proposal", exactFileName: "technical-proposal.docx" }];
    const [decision] = reconcileGeneratedDocuments({ plan, generatedDocuments: docs });
    assert.equal(decision.action, "KEEP_AS_PLANNED");
  });
});

describe("reconcileGeneratedDocuments — documentType / semantic match", () => {
  it("relinks when documentType uniquely identifies a plan file", () => {
    const plan = planWith({ id: "f1", name: "TechnicalProposal_v2.pdf", type: "TECHNICAL_PROPOSAL" });
    const docs: GeneratedDocumentLike[] = [{ id: "d1", name: "Technical Approach", documentType: "TECHNICAL_PROPOSAL" }];
    const [decision] = reconcileGeneratedDocuments({ plan, generatedDocuments: docs });
    assert.equal(decision.action, "RELINK_TO_PLAN");
    assert.equal(decision.matchedPlanFileId, "f1");
  });

  it("semantic match relinks 'Financial capacity and audited statement' to 'Audited Financial Statements'", () => {
    const plan = planWith({ id: "f1", name: "Audited Financial Statements 2024.pdf" });
    const docs: GeneratedDocumentLike[] = [
      { id: "d1", name: "Financial capacity and audited statement evidence.pdf", exactFileName: "Financial capacity and audited statement evidence.pdf" },
    ];
    const [decision] = reconcileGeneratedDocuments({ plan, generatedDocuments: docs });
    assert.equal(decision.action, "RELINK_TO_PLAN");
    assert.equal(decision.matchedPlanFileId, "f1");
  });
});

describe("reconcileGeneratedDocuments — supersede when no match", () => {
  it("the four screenshot orphans all supersede when plan is empty", () => {
    const orphans: GeneratedDocumentLike[] = [
      { id: "d1", name: "Financial capacity and audited statement evidence.pdf" },
      { id: "d2", name: "Submission method, deadline and delivery rules.docx" },
      { id: "d3", name: "Tender forms and templates.docx" },
      { id: "d4", name: "Legal eligibility, registration and licensing evidence.docx" },
    ];
    const decisions = reconcileGeneratedDocuments({ plan: emptyPlan, generatedDocuments: orphans });
    for (const d of decisions) {
      assert.equal(d.action, "MARK_SUPERSEDED", `${d.documentName} should be SUPERSEDED when plan is empty`);
    }
  });

  it("supersedes when the plan only contains UNRELATED files", () => {
    const plan = planWith({ id: "f1", name: "Cover Letter.pdf" });
    const orphan: GeneratedDocumentLike[] = [{ id: "d1", name: "Legal eligibility, registration and licensing evidence.docx" }];
    const [decision] = reconcileGeneratedDocuments({ plan, generatedDocuments: orphan });
    assert.equal(decision.action, "MARK_SUPERSEDED");
  });
});

describe("reconcileGeneratedDocuments — ambiguity safety", () => {
  it("does NOT relink ambiguously when multiple plan files share a semantic category", () => {
    const plan = planWith(
      { id: "f1", name: "Tax Clearance Certificate.pdf" },
      { id: "f2", name: "Business Registration Certificate.pdf" },
    );
    // Both plan files are LEGAL_REGISTRATION — ambiguous. The doc should
    // be marked SUPERSEDED instead of guessing.
    const docs: GeneratedDocumentLike[] = [{ id: "d1", name: "Legal eligibility, registration and licensing evidence.docx" }];
    const [decision] = reconcileGeneratedDocuments({ plan, generatedDocuments: docs });
    assert.equal(decision.action, "MARK_SUPERSEDED");
  });
});

describe("applyReconcileDecisions — DB applier", () => {
  it("counts each action and writes the right update payload", async () => {
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const mockClient = {
      generatedDocument: {
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: args.where.id, data: args.data });
        },
      },
    };

    const result = await applyReconcileDecisions(mockClient, [
      { documentId: "k1", documentName: "kept", action: "KEEP_AS_PLANNED", rationale: "exact" },
      { documentId: "r1", documentName: "relink", action: "RELINK_TO_PLAN", matchedPlanFileName: "Cover Letter.pdf", rationale: "semantic" },
      { documentId: "s1", documentName: "stale", action: "MARK_SUPERSEDED", rationale: "no match" },
    ]);

    assert.equal(result.kept, 1);
    assert.equal(result.relinked, 1);
    assert.equal(result.superseded, 1);
    // KEEP_AS_PLANNED should be a no-op DB write.
    assert.equal(updates.length, 2);
    // The SUPERSEDED row must set generationStatus = SUPERSEDED.
    const supersededUpdate = updates.find((u) => u.id === "s1");
    assert.equal(supersededUpdate?.data.generationStatus, "SUPERSEDED");
  });
});

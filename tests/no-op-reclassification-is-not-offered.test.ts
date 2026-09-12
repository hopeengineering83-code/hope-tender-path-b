import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression pin: the workflow reported
//   "Done — reclassified TECHNICAL_PROPOSAL → TECHNICAL_PROPOSAL"
// as a completed owner action.
//
// normalizeDocumentType is explicitly designed to return the CURRENT type when
// a document is already correctly typed, so "the normalised type equals the
// stored type" is the normal case. The panel offered the action on every
// actionable row anyway, and the route wrote the same value, wrote an audit
// entry, and reported success. That is a no-op reported as work: it pollutes
// the audit log and tells the owner a problem was addressed while the row's
// real problem is untouched.

import {
  planDocumentReclassification,
  normalizeDocumentType,
} from "../lib/engine/document-type-normalizer";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("planDocumentReclassification — no-op detection", () => {
  it("reports no change for a document already typed TECHNICAL_PROPOSAL", () => {
    const plan = planDocumentReclassification({
      name: "Technical Proposal",
      exactFileName: "Technical Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      reviewStatus: "PENDING",
    });
    assert.equal(plan.normalizedType, "TECHNICAL_PROPOSAL");
    assert.equal(plan.changesType, false);
    assert.equal(plan.changesReviewStatus, false);
    assert.equal(plan.wouldChange, false);
    assert.match(plan.detail, /already classified as TECHNICAL_PROPOSAL/);
    assert.doesNotMatch(plan.detail, /TECHNICAL_PROPOSAL\s*→\s*TECHNICAL_PROPOSAL/);
  });

  it("reports a real change when the type is genuinely wrong", () => {
    const plan = planDocumentReclassification({
      name: "Trade Licence",
      exactFileName: "Trade Licence.pdf",
      documentType: "TECHNICAL_PROPOSAL",
      reviewStatus: "PENDING",
    });
    assert.equal(plan.normalizedType, "LEGAL_EVIDENCE");
    assert.equal(plan.wouldChange, true);
    assert.equal(plan.reviewStatus, "REPLACE_WITH_ORIGINAL");
    assert.match(plan.detail, /TECHNICAL_PROPOSAL\s*→\s*LEGAL_EVIDENCE/);
  });

  it("reports a change when only the reviewStatus needs correcting", () => {
    // Type is already right, but an official original still needs its
    // REPLACE_WITH_ORIGINAL flag — that IS work, so it must not be suppressed.
    const plan = planDocumentReclassification({
      name: "Bid Bond",
      exactFileName: "Bid Bond.pdf",
      documentType: "BID_FORM",
      reviewStatus: "PENDING",
    });
    assert.equal(plan.changesType, false);
    assert.equal(plan.changesReviewStatus, true);
    assert.equal(plan.wouldChange, true);
  });

  it("is consistent with normalizeDocumentType for every input", () => {
    const docs = [
      { name: "Technical Proposal", exactFileName: "Technical Proposal.docx", documentType: "TECHNICAL_PROPOSAL" },
      { name: "Expert CVs", exactFileName: "Expert CVs.docx", documentType: "TECHNICAL_PROPOSAL" },
      { name: "Audited Financial Statements", exactFileName: "Audited Financials.pdf", documentType: null },
      { name: "Compliance Matrix", exactFileName: "Compliance Matrix.xlsx", documentType: "COMPLIANCE_MATRIX" },
    ];
    for (const doc of docs) {
      const plan = planDocumentReclassification(doc);
      assert.equal(plan.normalizedType, normalizeDocumentType(doc.name, doc.exactFileName, doc.documentType));
    }
  });
});

describe("The no-op is neither written, audited, nor offered", () => {
  it("the route returns changed:false and skips the write and the audit entry", () => {
    const src = read("app/api/tenders/[id]/documents/[docId]/plan-action/route.ts");
    assert.ok(src.includes("planDocumentReclassification"), "route must plan before writing");
    assert.ok(src.includes("NO_CHANGE_REQUIRED"), "route must report the no-op explicitly");
    // The early return must come before both the update and the logAction call.
    const guard = src.indexOf("if (!plan.wouldChange)");
    const update = src.indexOf("prisma.generatedDocument.update");
    const audit = src.indexOf("await logAction({");
    assert.ok(guard > 0 && guard < update, "no-op must return before the update");
    assert.ok(guard < audit, "no-op must return before the audit entry");
  });

  it("the batch auto-classify route counts unchanged documents separately", () => {
    const src = read("app/api/tenders/[id]/submission-plan/auto-classify/route.ts");
    assert.ok(src.includes("planDocumentReclassification"));
    assert.ok(/if \(!plan\.wouldChange\) \{ unchanged\+\+; continue; \}/.test(src),
      "already-correct documents must be counted as unchanged, not classified");
    assert.ok(src.includes("unchanged,"), "the response must report the unchanged count");
  });

  it("the plan row exposes the reclassification target so the panel can decide", () => {
    const loader = read("lib/engine/submission-plan-completeness.ts");
    assert.ok(loader.includes("reclassifyTo"), "the row must carry the target");
    assert.ok(
      /return plan\.wouldChange \? plan\.normalizedType\.toUpperCase\(\) : null;/.test(loader),
      "the target must be null when reclassifying would change nothing",
    );
  });

  it("the panel offers the action only when there is a target", () => {
    const panel = read("components/submission-plan-completeness-panel.tsx");
    assert.ok(/\{row\.reclassifyTo \?/.test(panel), "the button must be conditional on a real target");
    assert.ok(panel.includes("Type already correct"), "rows with nothing to do must say so");
    assert.ok(panel.includes("json.changed === false"), "the panel must not say Done for a no-op");
  });
});

/**
 * "Cites no evidence" and "was told nothing to look for" are not the same
 * verdict, and only one of them should block a package.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A real owner run produced a Technical Proposal PDF of ~12,963 words, scored
 * 68/100 and QUALITY_FAILED, with MISSING_EVIDENCE_REFERENCE among its issue
 * codes. AUTO_FINALIZE then failed as AUTO_FINALIZE_NOT_CONVERGED →
 * GENERATED_DOCUMENT_QUALITY_FAILED.
 *
 * countEvidenceReferences() returns 0 in two different situations: the
 * document cites none of the selected evidence, or it was handed no names to
 * look for. assessCurrentDocumentQualityBatch() — the entry point
 * final-submission-readiness.ts uses on the AUTO_FINALIZE path — had no
 * parameter for evidence names at all, so it always scored with an empty list
 * and always produced MISSING_EVIDENCE_REFERENCE, no matter what the document
 * actually cited.
 *
 * validate.ts already passed the names. So the same document could pass
 * validation and then fail readiness on a content verdict for which no content
 * evidence was ever supplied. Two gates disagreeing about one document is the
 * defect.
 *
 * The check itself is NOT weakened: a technical proposal that genuinely cites
 * none of its selected experts or projects is still flagged. The last describe
 * block is what proves that.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assessGeneratedDocumentQuality } from "../lib/engine/document-quality-gate";

const BODY = "Our methodology for the hospital assignment is set out below. ".repeat(40);

function issuesFor(text: string, evidence: { selectedExpertNames?: string[]; selectedProjectNames?: string[] }) {
  return assessGeneratedDocumentQuality({
    doc: {
      id: "d1",
      name: "Technical Proposal",
      exactFileName: "01-Technical-Proposal.pdf",
      documentType: "TECHNICAL_PROPOSAL",
      format: "PDF",
    },
    visibleText: `Technical Proposal\n\n${text}`,
    rawFileContent: null,
    hasStoragePath: true,
    requirements: [],
    ...evidence,
  }).issues.map((i) => i.code);
}

describe("a document that cites its evidence is recognised", () => {
  it("does not flag a proposal naming a selected expert", () => {
    const text = `${BODY} The Team Leader for this assignment is Abebe Tesfaye.`;
    assert.ok(!issuesFor(text, { selectedExpertNames: ["Abebe Tesfaye"] }).includes("MISSING_EVIDENCE_REFERENCE"));
  });

  it("does not flag a proposal naming a selected project", () => {
    const text = `${BODY} Comparable assignment: Adama Town Water Supply Distribution Network.`;
    assert.ok(
      !issuesFor(text, { selectedProjectNames: ["Adama Town Water Supply Distribution Network"] })
        .includes("MISSING_EVIDENCE_REFERENCE"),
    );
  });
});

describe("the empty-name case is what produced the false positive", () => {
  it("reproduces the old behaviour: no names supplied means the issue always fires", () => {
    // This is the AUTO_FINALIZE path's exact situation before the fix. The
    // document below cites a real expert by name and is still flagged, because
    // the scorer was given nothing to match against.
    const text = `${BODY} The Team Leader for this assignment is Abebe Tesfaye.`;
    assert.ok(
      issuesFor(text, {}).includes("MISSING_EVIDENCE_REFERENCE"),
      "with no names supplied the check cannot succeed — which is why the caller must supply them",
    );
  });
});

describe("the check still catches a proposal that cites nothing", () => {
  it("flags a technical proposal naming none of the selected evidence", () => {
    // The rule is correct and must survive: if evidence was selected and the
    // proposal ignores it, that is a real defect.
    const codes = issuesFor(BODY, {
      selectedExpertNames: ["Abebe Tesfaye"],
      selectedProjectNames: ["Adama Town Water Supply Distribution Network"],
    });
    assert.ok(codes.includes("MISSING_EVIDENCE_REFERENCE"));
  });
});

describe("the AUTO_FINALIZE path actually supplies the names", () => {
  // The behavioural tests above prove the scorer uses names when it gets them.
  // This proves the readiness gate hands them over — the half that was missing.
  const SRC = readFileSync(path.join(process.cwd(), "lib/engine/final-submission-readiness.ts"), "utf8");

  it("passes selected expert and project names into the quality batch", () => {
    const start = SRC.indexOf("assessCurrentDocumentQualityBatch(");
    assert.ok(start > 0, "the readiness gate must score documents");
    const call = SRC.slice(start, start + 400);
    assert.ok(call.includes("selectedExpertNames"), "expert names must reach the quality batch");
    assert.ok(call.includes("selectedProjectNames"), "project names must reach the quality batch");
  });

  it("uses the same selected-only population validate.ts uses", () => {
    // Different populations would put the two gates back into disagreement,
    // just more subtly than before.
    assert.ok(
      /expertMatches:\s*\{\s*where:\s*\{\s*isSelected:\s*true\s*\}/.test(SRC),
      "expert matches must be filtered to isSelected, as validate.ts does",
    );
    assert.ok(
      /projectMatches:\s*\{\s*where:\s*\{\s*isSelected:\s*true\s*\}/.test(SRC),
      "project matches must be filtered to isSelected, as validate.ts does",
    );
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { selectAutomaticEvidenceForRequirement, type AutomaticEvidenceCandidate } from "../lib/engine/automatic-requirement-coverage";

const candidate: AutomaticEvidenceCandidate = {
  recordType: "GENERATED_DOCUMENT", recordId: "pdf", label: "Technical Proposal.pdf",
  searchableText: "Technical Proposal.pdf Email submission only to procurement@example.org using the required email subject",
  evidenceKinds: ["OUTPUT_ARTIFACT", "METHODOLOGY_NARRATIVE"], evidenceKey: "pdf:hash",
  sourceDocumentId: "pdf", sourceContentHash: "a".repeat(64), sourceByteLength: 1000,
  selected: true, generatedReady: true, exactFileName: "Technical Proposal.pdf",
  facets: { visibleTextInspected: true },
};

test("validated artifact text can substantially prove a submission instruction", () => {
  const selected = selectAutomaticEvidenceForRequirement({
    id: "req", title: "Email Submission Guidelines", description: "Email submission only using the required email subject",
    requirementType: "SUBMISSION", priority: "MANDATORY", restrictions: null, requiredQuantity: 1,
    exactFileName: null, sourceTenderFileId: "file", sourcePageNumber: 1, sourceExactQuote: "Email submission only using the required email subject",
  }, [candidate]);
  assert.ok(["FULL", "SUBSTANTIAL"].includes(selected[0]?.supportLevel));
});

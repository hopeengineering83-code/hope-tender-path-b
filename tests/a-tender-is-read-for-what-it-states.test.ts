// A ToR read on 2026-10-06 (feasibility study): the panel showed reference
// "will" ("Terms of Reference will …"), project title "The proposed project
// has four main areas of intervention:", and demanded a submission deadline
// the document never states. The app takes what the tender states and asks for
// nothing it does not.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { isValidReferenceNumber } from "../lib/engine/metadata-validators";
import { inferTenderMetadata } from "../lib/engine/tender-metadata";
import { parseTenderDocumentIntelligence } from "../lib/engine/source-driven-tender-text-parser";
import { resolveTenderOperationGate } from "../lib/engine/tender-operation-gate";

const TOR = [
  "TERMS OF REFERENCE",
  "CONSULTANCY SERVICE FOR FEASIBILITY STUDY",
  "These Terms of Reference will guide the consultant for The proposed project has four main areas of intervention:",
  "1. Water supply 2. Sanitation 3. Hygiene 4. Governance",
  "The following documents must be submitted before the set tender closing.",
].join("\n");

describe("a tender is read for what it states", () => {
  it("a word or a phrase is not a reference; a coded one is", () => {
    for (const bad of ["will", "only", "The proposed project has four"]) assert.equal(isValidReferenceNumber(bad), false, bad);
    for (const good of ["WHH-ETH-2026-014", "PHARO-RFP", "AA/PROC/ARCH", "2026-024"]) assert.equal(isValidReferenceNumber(good), true, good);
    assert.equal(inferTenderMetadata(TOR, "ToR.pdf").reference, null);
  });

  it("prose that runs into a list does not replace the tender's title", () => {
    const intel = parseTenderDocumentIntelligence(TOR, { tenderTitle: "CONSULTANCY SERVICE FOR FEASIBILITY STUDY" } as never);
    assert.equal(intel.projectTitle, "CONSULTANCY SERVICE FOR FEASIBILITY STUDY");
    const labelled = parseTenderDocumentIntelligence(`${TOR}\nProject title: Rural WASH Systems Feasibility Study`, { tenderTitle: "CONSULTANCY SERVICE FOR FEASIBILITY STUDY" } as never);
    assert.equal(labelled.projectTitle, "Rural WASH Systems Feasibility Study");
  });

  it("an unstated deadline does not block the final package; a placeholder value does", () => {
    const base = {
      tender: { id: "t", title: "Feasibility Study", reference: null, clientName: "WHH", deadline: null, submissionMethod: "Portal", submissionEmails: null, submissionAddress: null, country: "Ethiopia", metadataContaminated: false, analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED" },
      requirements: [{ priority: "MANDATORY" }],
      overrides: [],
      buildPlan: { ok: true, items: [] },
      operation: "FINAL_SUBMISSION_READY" as const,
    };
    const absent = resolveTenderOperationGate(base as never);
    assert.ok(!absent.blockers.some((b) => b.includes("deadline")), absent.blockers.join("; "));
    const placeholder = resolveTenderOperationGate({ ...base, tender: { ...base.tender, clientName: "TBD" } } as never);
    assert.ok(placeholder.blockers.some((b) => b.includes("clientName")));
  });
});

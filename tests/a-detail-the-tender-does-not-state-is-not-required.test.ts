// Owner policy ABSENT_TENDER_FACT_IS_NOT_REQUIRED (2026-09-24):
//
//   "if particular things are not found in the tender details, that means they
//    are not necessary ... Some tenders may not have all necessary details, so
//    the App must act accordingly, use the information available and generate
//    proposals."
//
// These tests drive a tender that states ONLY its title through the Build Plan
// gate (draft and final) and the canonical field-state resolver every panel
// renders, and prove nothing blocks. The counterpart is pinned too: a value
// that IS present but wrong (a placeholder such as "Not") still blocks, and so
// does the delivery endpoint a stated method depends on.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { validateCriticalMetadataEvidenceForBuildPlan } from "../lib/engine/build-plan";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";
import { classifyTenderFactAuthority, ABSENT_TENDER_FACT_IS_NOT_REQUIRED } from "../lib/engine/tender-fact-authority";

const FILE_ID = "file-1";
const FILE_TEXT = "Request for Proposal: Design of a Community Water Scheme. The consultant shall prepare a feasibility study.";
const FILES = [{ id: FILE_ID, extractedText: FILE_TEXT, totalPages: 4 }];

function titleOnlyTender(patch: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Design of a Community Water Scheme",
    titleSourceFileId: FILE_ID,
    titleSourcePage: 1,
    titleSourceQuote: "Request for Proposal: Design of a Community Water Scheme",
    reference: null,
    clientName: null,
    procuringEntityName: null,
    deadline: null,
    submissionMethod: null,
    submissionEmails: null,
    submissionAddress: null,
    submissionEmailSubject: null,
    metadataContaminated: false,
    contactDetailsSourceJson: null,
    ...patch,
  };
}

function gate(tender: Record<string, unknown>, mode: "draft" | "final") {
  return validateCriticalMetadataEvidenceForBuildPlan(tender as any, FILES as any[], [], mode);
}

function panel(tender: Record<string, unknown>) {
  return resolveCanonicalFieldState({
    tender: tender as CanonicalResolverInput["tender"],
    overrides: [],
    hasExtractedRequirements: true,
    submissionMethodContext: (tender.submissionMethod as string | null) ?? undefined,
    activeTenderFileIds: new Set([FILE_ID]),
    activeFiles: FILES,
  });
}

describe("a detail the tender does not state is not required", () => {
  it("the policy constant is on", () => {
    assert.equal(ABSENT_TENDER_FACT_IS_NOT_REQUIRED, true);
  });

  for (const mode of ["draft", "final"] as const) {
    it(`Build Plan gate (${mode}) passes a tender with no client, reference, deadline or submission method`, () => {
      const v = gate(titleOnlyTender(), mode);
      assert.deepEqual(v.blockers, []);
      assert.equal(v.ok, true);
    });
  }

  it("the panels agree: the absent fields are NOT_STATED and block nothing", () => {
    const r = panel(titleOnlyTender());
    for (const key of ["clientName", "reference", "deadline", "submissionMethod"]) {
      const f = r.fields.find((x) => x.fieldKey === key);
      assert.ok(f, `field ${key} is resolved`);
      assert.equal(f!.blockerReason, null, `${key} must not block`);
      assert.equal(f!.status, "NOT_STATED", `${key} is recorded as not stated`);
    }
    assert.equal(r.hasGenerationBlocker, false);
    assert.equal(r.hasExportBlocker, false);
  });

  it("the authority classifier calls an absent critical fact NOT_STATED_IN_SOURCE, never blocking", () => {
    const c = classifyTenderFactAuthority({
      field: "deadline",
      effectiveValue: null,
      rawValue: null,
      override: null,
      isSourceGrounded: false,
      policyCtx: { submissionMethod: null },
    } as any);
    assert.equal(c.authority, "NOT_STATED_IN_SOURCE");
    assert.equal(c.blocksDraft, false);
    assert.equal(c.blocksFinalExport, false);
  });
});

describe("a detail that IS present but wrong still blocks", () => {
  it("a placeholder reference (\"Not\") blocks the final gate", () => {
    const v = gate(titleOnlyTender({ reference: "Not", referenceSourceFileId: FILE_ID, referenceSourcePage: 1, referenceSourceQuote: "Not" }), "final");
    assert.equal(v.ok, false);
    assert.ok(v.blockers.some((b) => /reference/i.test(b)), JSON.stringify(v.blockers));
  });

  it("an unrecognisable stated submission method blocks", () => {
    const v = gate(titleOnlyTender({ submissionMethod: "zzz" }), "final");
    assert.equal(v.ok, false);
  });

  it("an email method with no email address blocks: the package could not be delivered", () => {
    const v = gate(titleOnlyTender({ submissionMethod: "email submission" }), "final");
    assert.equal(v.ok, false);
    assert.ok(v.blockers.some((b) => /submissionEmails/.test(b)), JSON.stringify(v.blockers));
  });
});

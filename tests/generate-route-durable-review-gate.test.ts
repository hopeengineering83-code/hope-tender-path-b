// Real gap found while auditing every generation consumer of Expert/Project
// trustLevel: app/api/tenders/[id]/generate/route.ts — the route that
// actually produces submittable documents — used a raw
// `trustLevel === "REVIEWED"` check in three places instead of the
// canonical isDurablyReviewed() the rest of the codebase (Engine matching,
// generate-elite.ts) already requires:
//
// 1. fillPlannedSupportDocuments()'s experts/projects text, quoted directly
//    into a generated, submittable support DOCX.
// 2. The reviewedExpertCount/draftExperts gate that blocks generation when
//    "NONE have been reviewed."
// 3. The "empty vault hard gate" that blocks generation entirely when the
//    company vault has zero reviewed evidence — this also had no
//    deletedAt filter, so a soft-deleted REVIEWED expert/project could
//    incorrectly satisfy the gate.
//
// A record stamped trustLevel="REVIEWED" without real, byte-verified
// provenance (or a soft-deleted one) could therefore be quoted as evidence
// in an actual generated document, or incorrectly unblock generation, while
// the Engine and generate-elite.ts would both reject the exact same record.
//
// Further refinement: isDurablyReviewed() alone was still stricter than the
// canonical GENERATION policy used by tender-generation-readiness.ts,
// canonical-tender-readiness.ts, and matching-quality.ts, all of which
// accept a durably SOURCE_VERIFIED record (machine-verified against the
// company's own byte-verified source document) as well as a durably
// REVIEWED one. This route now delegates to canUseVaultRecord(record,
// "GENERATION") so the actual document-generation route is no stricter
// than every other GENERATION consumer.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");

describe("generate/route.ts delegates evidence eligibility to the canonical durable-review authority", () => {
  it("imports the canonical resolver", () => {
    assert.match(source, /import \{ canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT \} from ".*vault-review-provenance"/);
  });

  it("fillPlannedSupportDocuments filters generated-document evidence text through canUseVaultRecord(..., \"GENERATION\") and excludes soft-deleted records", () => {
    assert.match(source, /tender\.expertMatches\.filter\(\(m\) => m\.expert && !m\.expert\.deletedAt && canUseVaultRecord\(m\.expert, "GENERATION"\)\)/);
    assert.match(source, /tender\.projectMatches\.filter\(\(m\) => m\.project && !m\.project\.deletedAt && canUseVaultRecord\(m\.project, "GENERATION"\)\)/);
  });

  it("the reviewed/draft gate uses canUseVaultRecord(..., \"GENERATION\"), not a raw trustLevel check", () => {
    assert.match(source, /draftExperts = selectedExpertMatches\.filter\(\(m\) => !canUseVaultRecord\(m\.expert, "GENERATION"\)\)/);
    assert.match(source, /draftProjects = selectedProjectMatches\.filter\(\(m\) => !canUseVaultRecord\(m\.project, "GENERATION"\)\)/);
  });

  it("the empty-vault hard gate excludes soft-deleted records and uses canUseVaultRecord(..., \"GENERATION\")", () => {
    assert.match(source, /prisma\.expert\.findMany\(\{ where: \{ company: \{ userId \}, deletedAt: null \}, select: VAULT_REVIEW_CONSUMER_SELECT\.EXPERT \}\)/);
    assert.match(source, /prisma\.project\.findMany\(\{ where: \{ company: \{ userId \}, deletedAt: null \}, select: VAULT_REVIEW_CONSUMER_SELECT\.PROJECT \}\)/);
    assert.match(source, /vaultExpertsForGate\.filter\(\(e\) => canUseVaultRecord\(e, "GENERATION"\)\)/);
    assert.match(source, /vaultProjectsForGate\.filter\(\(p\) => canUseVaultRecord\(p, "GENERATION"\)\)/);
  });

  it("no remaining raw trustLevel===REVIEWED evidence-eligibility check and no stale isDurablyReviewed reference in this file", () => {
    assert.doesNotMatch(source, /trustLevel === "REVIEWED"/);
    assert.doesNotMatch(source, /trustLevel !== "REVIEWED"/);
    assert.doesNotMatch(source, /isDurablyReviewed/);
  });
});

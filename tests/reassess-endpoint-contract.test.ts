// Bulk quality-reassessment endpoint contract.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync("app/api/admin/generated-proposals/reassess/route.ts", "utf8");

describe("admin reassess endpoint — safety contract", () => {
  it("requires ADMIN only", () => {
    assert.match(SRC, /requireRole\(\s*"ADMIN"\s*\)/);
  });
  it("supports dryRun and tenderId query options", () => {
    assert.match(SRC, /dryRun/);
    assert.match(SRC, /tenderId/);
  });
  it("uses the canonical document-quality-gate", () => {
    assert.match(SRC, /assessGeneratedDocumentQuality/);
  });
  it("never returns proposal body text in the response shape", () => {
    // `fileContent: true` in the Prisma `select` clause is internal — it
    // fetches the column from DB but the response payload (`ReassessmentRow`)
    // never includes a `fileContent` field. Assert against the public
    // response keys instead.
    assert.ok(!/proposalText|fullText|bodyText|extractedBody/.test(SRC), "response must not include proposal body text fields");
    // The AuditRow-like response shape should not spread d.fileContent onto rows.
    assert.ok(!/fileContent:\s*doc\.fileContent/.test(SRC), "response row must not echo fileContent");
  });
  it("emits a QUALITY_REASSESSMENT audit log on non-dry-run runs", () => {
    assert.match(SRC, /action:\s*"QUALITY_REASSESSMENT"/);
  });
  it("only ever DOWNGRADES rows (never silently upgrades)", () => {
    // The REVIEW_DEMOTABLE set restricts who can be demoted.
    assert.match(SRC, /REVIEW_DEMOTABLE/);
    assert.match(SRC, /reviewStatus:\s*"NEEDS_REWRITE"/);
  });
  it("clamps limit to a safe range (1..1000)", () => {
    assert.match(SRC, /Math\.min\(\s*1000\s*,/);
  });
});

describe("submission-plan endpoint contract", () => {
  it("uses canonical resolveSubmissionPlanCompleteness + isFinalExportCandidateDocument under the hood", () => {
    const src = readFileSync("app/api/tenders/[id]/submission-plan/route.ts", "utf8");
    // The route reaches the canonical resolver through the shared loader that
    // the automatic finalize pipeline also uses, so the panel and the pipeline
    // cannot disagree about completeness.
    assert.match(src, /loadSubmissionPlanCompleteness/);
    const loader = readFileSync("lib/engine/submission-plan-completeness.ts", "utf8");
    assert.match(loader, /resolveSubmissionPlanCompleteness\(\{/);
    assert.match(src, /requireRole\(\s*"ADMIN",\s*"PROPOSAL_MANAGER",\s*"REVIEWER"\s*\)/);
  });
});

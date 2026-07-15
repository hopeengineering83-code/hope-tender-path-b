import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const reviewPage = readFileSync("app/dashboard/company/review/page.tsx", "utf8");
const repairRoute = readFileSync("app/api/company/knowledge/repair/route.ts", "utf8");
const expertBatch = readFileSync("app/api/company/experts/batch/route.ts", "utf8");
const projectBatch = readFileSync("app/api/company/projects/batch/route.ts", "utf8");

describe("company review privacy and pagination contracts", () => {
  it("does not fetch or render raw company expert/project narratives", () => {
    assert.doesNotMatch(reviewPage, /fetch\("\/api\/company"\)/);
    assert.doesNotMatch(reviewPage, /sourceSnippet|expert\.profile|project\.summary/);
    assert.match(reviewPage, /Only bounded summaries reach this page/);
    assert.match(reviewPage, /<details/);
  });

  it("uses bounded server pagination for experts and projects", () => {
    assert.match(repairRoute, /const RECORD_PAGE_SIZE = 10/);
    assert.match(repairRoute, /skip: \(pagination\.expertPage - 1\) \* RECORD_PAGE_SIZE/);
    assert.match(repairRoute, /skip: \(pagination\.projectPage - 1\) \* RECORD_PAGE_SIZE/);
    assert.match(repairRoute, /take: RECORD_PAGE_SIZE/g);
    assert.match(reviewPage, /Previous page/);
    assert.match(reviewPage, /Next page/);
  });

  it("replaces raw document names with server-created safe labels", () => {
    assert.match(repairRoute, /fileName: safeVaultFileLabel\(doc\.category, index\)/);
    assert.doesNotMatch(reviewPage, /originalFileName|storagePath|extractedText/);
  });

  it("treats legacy REVIEWED rows without provenance as blocked", () => {
    assert.match(repairRoute, /unsupportedReviewedExperts/);
    assert.match(repairRoute, /unsupportedReviewedProjects/);
    assert.match(repairRoute, /effectiveReviewTrustLevel/);
    assert.match(reviewPage, /Blocked — provenance required/);
  });
});

describe("batch review ownership, audit, and partial-failure contracts", () => {
  for (const [kind, source] of [["expert", expertBatch], ["project", projectBatch]] as const) {
    it(`${kind} review validates tenant ownership and owned source evidence`, () => {
      assert.match(source, /companyId: company\.id/);
      assert.match(source, /record\.sourceDocument\?\.companyId === company\.id/);
      assert.match(source, /buildReviewProvenance/);
      assert.match(source, /NOT_FOUND_OR_NOT_OWNED/);
      assert.match(source, /FIELD_EVIDENCE_REQUIRED/);
    });

    it(`${kind} review persists record state and audit identity in one transaction`, () => {
      assert.match(source, /prisma\.\$transaction\(async \(tx\)/);
      assert.match(source, /reviewedBy: actor\.id/);
      assert.match(source, /reviewedAt/);
      assert.match(source, /reviewNotes: candidate\.serialized/);
      assert.match(source, /await tx\.auditLog\.create/);
      assert.match(source, /sourceContentHash/);
      assert.match(source, /evidenceFields/);
    });

    it(`${kind} review returns accepted and rejected per-record results`, () => {
      assert.match(source, /accepted: updatedIds\.map/);
      assert.match(source, /rejected,/);
      assert.match(source, /status: updatedIds\.length > 0 \? 200 : 422/);
    });
  }
});

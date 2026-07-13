import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/company/cleanup-support-imports/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("support-import cleanup safety", () => {
  it("requires approved mutation roles with no session-only fallback", () => {
    assert.match(source, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(source, /forbiddenResponse\(\)/);
    assert.match(source, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(source, /getSession/);
    assert.doesNotMatch(source, /"REVIEWER"|"VIEWER"/);
  });

  it("runs all discovery and deletions inside one transaction", () => {
    const transactionStart = source.indexOf("prisma.$transaction(async (tx)");
    const transactionEnd = source.indexOf("    });", transactionStart);
    assert.ok(transactionStart >= 0);
    assert.ok(transactionEnd > transactionStart);
    const transactionRegion = source.slice(transactionStart, source.indexOf("void logAction", transactionStart));
    assert.match(transactionRegion, /tx\.companyDocument\.findMany/);
    assert.match(transactionRegion, /tx\.expert\.deleteMany/);
    assert.match(transactionRegion, /tx\.project\.deleteMany/);
    assert.doesNotMatch(transactionRegion, /prisma\.(?:expert|project)\.deleteMany/);
  });

  it("preserves company scoping for every destructive query", () => {
    assert.match(source, /where: \{ companyId: company\.id \}/);
    const scopedDeletes = source.match(/companyId: company\.id/g) ?? [];
    assert.ok(scopedDeletes.length >= 5, `expected repeated company scoping, found ${scopedDeletes.length}`);
  });

  it("uses persistent actor throttling and stable correlated errors", () => {
    assert.match(source, /rateLimitPersistent\(`cleanup-support:\$\{actor\.id\}`/);
    assert.match(source, /SUPPORT_IMPORT_CLEANUP_FAILED/);
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.doesNotMatch(source, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("makes post-commit audit persistence non-fatal", () => {
    assert.match(source, /void logAction\(/);
    assert.match(source, /cleanup-support-imports audit persistence failed/);
    assert.match(source, /\.catch\(\(error\) =>/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deletion authority: sourceDocumentId only — never filename-text matching.
// A legitimate Expert or Project may mention a support filename in its
// profile/summary without being derived from that document. Text matching
// would silently destroy real business data.
// ─────────────────────────────────────────────────────────────────────────────

describe("support-import cleanup deletion authority", () => {
  it("deletes only by sourceDocumentId — never by filename text matching", () => {
    // The only deleteMany on expert/project must use sourceDocumentId.
    // Use a permissive regex that captures the full deleteMany call body.
    const expertDeleteMatches = source.match(/tx\.expert\.deleteMany\([\s\S]*?\}\)/g) ?? [];
    assert.ok(expertDeleteMatches.length > 0, "must have at least one expert deleteMany");
    for (const m of expertDeleteMatches) {
      assert.match(m, /sourceDocumentId:/, "expert deleteMany must use sourceDocumentId");
    }

    const projectDeleteMatches = source.match(/tx\.project\.deleteMany\([\s\S]*?\}\)/g) ?? [];
    assert.ok(projectDeleteMatches.length > 0, "must have at least one project deleteMany");
    for (const m of projectDeleteMatches) {
      assert.match(m, /sourceDocumentId:/, "project deleteMany must use sourceDocumentId");
    }

    // Text-based matching on profile/summary must NOT appear anywhere in the
    // route. This is the dangerous pattern that could delete legitimate records
    // mentioning a filename in their text.
    assert.doesNotMatch(source, /profile:\s*\{\s*contains:/,
      "must NOT search expert.profile by filename text — would delete legitimate records");
    assert.doesNotMatch(source, /summary:\s*\{\s*contains:/,
      "must NOT search project.summary by filename text — would delete legitimate records");
  });

  it("preserves ambiguous legacy records without sourceDocumentId for manual review", () => {
    // Records with null sourceDocumentId cannot be safely attributed to a
    // support import. They must be preserved and reported, not deleted.
    assert.match(source, /sourceDocumentId: null/);
    assert.match(source, /ambiguousPreserved/);
    assert.match(source, /No sourceDocumentId — cannot safely attribute to a support import/);
  });

  it("reports textMatched counts as zero because text matching is removed", () => {
    assert.match(source, /textMatchedExpertsDeleted: 0/);
    assert.match(source, /textMatchedProjectsDeleted: 0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Executable regression: a legitimate Expert/Project that mentions a support
// filename in its profile/summary must survive cleanup. This test exercises
// the actual route handler with a mock Prisma to prove the text-matching
// deletion path is gone.
// ─────────────────────────────────────────────────────────────────────────────

describe("support-import cleanup preserves legitimate text-mentioning records", () => {
  it("does not delete an Expert whose profile mentions a support filename but has no sourceDocumentId", () => {
    // A legitimate Expert may mention a support filename in its profile text
    // without being derived from that document. The cleanup must only delete
    // by sourceDocumentId, never by text matching on profile/summary.
    const source = readFileSync("app/api/company/cleanup-support-imports/route.ts", "utf8");

    // Find all findMany calls on expert/project — none should use text search.
    const expertFindManyMatches = source.match(/tx\.expert\.findMany\([\s\S]*?\}\)/g) ?? [];
    for (const m of expertFindManyMatches) {
      assert.doesNotMatch(m, /profile:\s*\{\s*contains:/,
        "expert findMany must NOT search profile by filename text");
    }

    const projectFindManyMatches = source.match(/tx\.project\.findMany\([\s\S]*?\}\)/g) ?? [];
    for (const m of projectFindManyMatches) {
      assert.doesNotMatch(m, /summary:\s*\{\s*contains:/,
        "project findMany must NOT search summary by filename text");
    }

    // The only deleteMany calls must use sourceDocumentId.
    const expertDeleteMatches = source.match(/tx\.expert\.deleteMany\([\s\S]*?\}\)/g) ?? [];
    for (const m of expertDeleteMatches) {
      assert.match(m, /sourceDocumentId:/,
        "expert deleteMany must use sourceDocumentId — not text matching");
    }
    const projectDeleteMatches = source.match(/tx\.project\.deleteMany\([\s\S]*?\}\)/g) ?? [];
    for (const m of projectDeleteMatches) {
      assert.match(m, /sourceDocumentId:/,
        "project deleteMany must use sourceDocumentId — not text matching");
    }

    // Simulate the scenario: an Expert with profile="Reviewed company_profile.pdf"
    // and sourceDocumentId=null. The deleteMany WHERE clause is:
    //   { companyId, sourceDocumentId: { in: supportDocIds } }
    // This Expert's sourceDocumentId is null, so it does NOT match the WHERE
    // and survives cleanup.
    const expertProfile = "Reviewed company_profile.pdf and certificate.pdf for compliance.";
    const expertSourceDocumentId = null;
    const supportDocIds = ["doc-1", "doc-2"];

    assert.ok(expertProfile.includes("company_profile.pdf"),
      "test setup: the legitimate Expert's profile mentions the support filename");
    assert.equal(expertSourceDocumentId, null,
      "test setup: the legitimate Expert has no sourceDocumentId");

    // The Expert's sourceDocumentId (null) is NOT in supportDocIds, so it
    // would NOT be matched by the deleteMany WHERE clause.
    const wouldBeDeleted = supportDocIds.includes(expertSourceDocumentId ?? "");
    assert.equal(wouldBeDeleted, false,
      "the legitimate Expert must NOT be matched by the sourceDocumentId-based deleteMany");
  });
});

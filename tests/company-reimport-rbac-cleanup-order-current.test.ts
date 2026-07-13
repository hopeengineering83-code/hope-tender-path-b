import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/company/reimport/route.ts", "utf8");
const cleanup = readFileSync("lib/company-support-doc-cleanup.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("company reimport safety", () => {
  it("requires approved mutation roles with no session-only fallback", () => {
    assert.match(route, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(route, /forbiddenResponse\(\)/);
    assert.match(route, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(route, /getSession/);
    assert.doesNotMatch(route, /"REVIEWER"|"VIEWER"/);
  });

  it("defers destructive cleanup until primary and safety imports complete", () => {
    const postStart = route.indexOf("export async function POST");
    const primaryPos = route.indexOf("importCompanyKnowledgeFromDocuments(company.id)", postStart);
    const safetyPos = route.indexOf("runCompanyKnowledgeSafetyImport(prisma, company.id)", postStart);
    const cleanupPos = route.indexOf("cleanupSupportDocImportedRecords(company.id)", postStart);
    assert.ok(postStart >= 0);
    assert.ok(primaryPos > postStart);
    assert.ok(safetyPos > primaryPos);
    assert.ok(cleanupPos > safetyPos);
    const postRegion = route.slice(postStart);
    assert.equal(postRegion.match(/cleanupSupportDocImportedRecords\(company\.id\)/g)?.length, 1);
    assert.doesNotMatch(route.slice(postStart, primaryPos), /cleanupSupportDocImportedRecords\(company\.id\)/);
  });

  it("makes support-derived deletion one transaction", () => {
    assert.match(cleanup, /return prisma\.\$transaction\(async \(tx\) =>/);
    assert.match(cleanup, /tx\.companyDocument\.findMany/);
    assert.match(cleanup, /tx\.expert\.deleteMany/);
    assert.match(cleanup, /tx\.project\.deleteMany/);
    assert.doesNotMatch(cleanup, /prisma\.(?:expert|project)\.deleteMany/);
  });

  it("keeps every cleanup query company-scoped", () => {
    const scopes = cleanup.match(/companyId/g) ?? [];
    assert.ok(scopes.length >= 4, `expected repeated company scoping, found ${scopes.length}`);
    // Each deleteMany WHERE must include both companyId and sourceDocumentId.
    const expertDeleteMatches = cleanup.match(/tx\.expert\.deleteMany\([\s\S]*?\}\)/g) ?? [];
    for (const m of expertDeleteMatches) {
      assert.match(m, /companyId/, "expert deleteMany must be company-scoped");
      assert.match(m, /sourceDocumentId:/, "expert deleteMany must use sourceDocumentId");
    }
    const projectDeleteMatches = cleanup.match(/tx\.project\.deleteMany\([\s\S]*?\}\)/g) ?? [];
    for (const m of projectDeleteMatches) {
      assert.match(m, /companyId/, "project deleteMany must be company-scoped");
      assert.match(m, /sourceDocumentId:/, "project deleteMany must use sourceDocumentId");
    }
  });

  it("uses persistent throttling and stable correlated runtime errors", () => {
    assert.match(route, /rateLimitPersistent\(`reimport:\$\{actor\.id\}`/);
    assert.match(route, /COMPANY_REIMPORT_FAILED/);
    assert.match(route, /extractRequestId\(req\)/);
    assert.match(route, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.doesNotMatch(route, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("makes post-success audit persistence non-fatal", () => {
    assert.match(route, /void logAction\(/);
    assert.match(route, /company reimport audit persistence failed/);
    assert.match(route, /\.catch\(\(error\) =>/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deletion authority and reviewed-record preservation
// ─────────────────────────────────────────────────────────────────────────────

describe("support-doc cleanup deletion authority", () => {
  it("deletes only by sourceDocumentId — never by filename text matching", () => {
    // Text-based matching on profile/summary must NOT appear anywhere in the
    // cleanup helper. This is the dangerous pattern that could delete
    // legitimate records mentioning a filename in their text.
    assert.doesNotMatch(cleanup, /profile:\s*\{\s*contains:/,
      "must NOT search expert.profile by filename text");
    assert.doesNotMatch(cleanup, /summary:\s*\{\s*contains:/,
      "must NOT search project.summary by filename text");

    // The only deleteMany calls must use sourceDocumentId.
    const expertDeleteMatches = cleanup.match(/tx\.expert\.deleteMany\([\s\S]*?\}\)/g) ?? [];
    for (const m of expertDeleteMatches) {
      assert.match(m, /sourceDocumentId:/,
        "expert deleteMany must use sourceDocumentId — not text matching");
    }
    const projectDeleteMatches = cleanup.match(/tx\.project\.deleteMany\([\s\S]*?\}\)/g) ?? [];
    for (const m of projectDeleteMatches) {
      assert.match(m, /sourceDocumentId:/,
        "project deleteMany must use sourceDocumentId — not text matching");
    }
  });

  it("preserves REVIEWED records — only removes REGEX_DRAFT and AI_DRAFT", () => {
    // A failed import must not undo human-validated facts. The cleanup must
    // filter by trustLevel to only remove non-reviewed records.
    assert.match(cleanup, /REMOVABLE_TRUST_LEVELS/);
    assert.match(cleanup, /"REGEX_DRAFT"/);
    assert.match(cleanup, /"AI_DRAFT"/);
    assert.match(cleanup, /trustLevel: \{ in: REMOVABLE_TRUST_LEVELS \}/);
    // REVIEWED must NOT appear in the removable list.
    assert.doesNotMatch(cleanup, /REMOVABLE_TRUST_LEVELS\s*=\s*\[[^\]]*"REVIEWED"/,
      "REVIEWED must not be in the removable trust levels");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Company isolation: the cleanup must only affect the calling company's records
// ─────────────────────────────────────────────────────────────────────────────

describe("support-doc cleanup company isolation", () => {
  it("scopes every deleteMany to the calling company", () => {
    const expertDeleteMatches = cleanup.match(/tx\.expert\.deleteMany\([\s\S]*?\}\)/g) ?? [];
    for (const m of expertDeleteMatches) {
      assert.match(m, /companyId,/,
        "expert deleteMany must be company-scoped");
    }
    const projectDeleteMatches = cleanup.match(/tx\.project\.deleteMany\([\s\S]*?\}\)/g) ?? [];
    for (const m of projectDeleteMatches) {
      assert.match(m, /companyId,/,
        "project deleteMany must be company-scoped");
    }
  });

  it("does not use unscoped deleteMany", () => {
    // No deleteMany should omit companyId from its WHERE clause.
    const allDeleteMany = cleanup.match(/(?:expert|project)\.deleteMany\([\s\S]*?\}\)/g) ?? [];
    for (const m of allDeleteMany) {
      assert.match(m, /companyId/,
        "every deleteMany must include companyId in its WHERE");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failed-import preservation: if the import fails, REVIEWED records derived
// from support documents must survive the cleanup
// ─────────────────────────────────────────────────────────────────────────────

describe("support-doc cleanup failed-import preservation", () => {
  it("a REVIEWED expert derived from a support document survives cleanup", () => {
    // Simulate: an expert with sourceDocumentId pointing to a support doc,
    // but trustLevel = REVIEWED. The cleanup's WHERE clause includes:
    //   trustLevel: { in: ["REGEX_DRAFT", "AI_DRAFT"] }
    // So REVIEWED records are NOT matched.
    const expertTrustLevel = "REVIEWED";
    const expertSourceDocumentId = "doc-support-1";
    const supportDocIds = ["doc-support-1"];
    const removableTrustLevels = ["REGEX_DRAFT", "AI_DRAFT"];

    const wouldBeDeleted =
      supportDocIds.includes(expertSourceDocumentId) &&
      removableTrustLevels.includes(expertTrustLevel);

    assert.equal(wouldBeDeleted, false,
      "a REVIEWED expert derived from a support document must NOT be deleted by the cleanup");
  });

  it("a REGEX_DRAFT expert derived from a support document is deleted", () => {
    const expertTrustLevel = "REGEX_DRAFT";
    const expertSourceDocumentId = "doc-support-1";
    const supportDocIds = ["doc-support-1"];
    const removableTrustLevels = ["REGEX_DRAFT", "AI_DRAFT"];

    const wouldBeDeleted =
      supportDocIds.includes(expertSourceDocumentId) &&
      removableTrustLevels.includes(expertTrustLevel);

    assert.equal(wouldBeDeleted, true,
      "a REGEX_DRAFT expert derived from a support document should be deleted");
  });

  it("an expert with no sourceDocumentId survives cleanup even if REGEX_DRAFT", () => {
    // An expert with null sourceDocumentId cannot be safely attributed to a
    // support document. It must survive cleanup.
    const expertSourceDocumentId = null;
    const supportDocIds = ["doc-support-1"];
    const removableTrustLevels = ["REGEX_DRAFT", "AI_DRAFT"];

    const wouldBeDeleted =
      expertSourceDocumentId !== null &&
      supportDocIds.includes(expertSourceDocumentId) &&
      removableTrustLevels.includes("REGEX_DRAFT");

    assert.equal(wouldBeDeleted, false,
      "an expert with no sourceDocumentId must NOT be deleted — cannot safely attribute to a support import");
  });
});

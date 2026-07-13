import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/tenders/[id]/requirements/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

describe("manual requirement provenance", () => {
  it("does not allow manual input to claim SOURCE_GROUNDED", () => {
    assert.match(source, /MANUAL_SOURCE_ORIGINS = \["HUMAN_ENTERED", "NOT_STATED", "CANDIDATE_REVIEW"\]/);
    const schemaStart = source.indexOf("const manualRequirementSchema");
    const schemaEnd = source.indexOf("type ManualAudit");
    const schemaRegion = source.slice(schemaStart, schemaEnd);
    assert.doesNotMatch(schemaRegion, /SOURCE_GROUNDED/);
  });

  it("persists no fabricated source evidence or confidence", () => {
    assert.match(source, /sourceExactQuote: null/);
    assert.match(source, /sourceTenderFileId: null/);
    assert.match(source, /sourcePageNumber: null/);
    assert.match(source, /sourceExtractionMethod: "MANUAL"/);
    assert.match(source, /sourceConfidence: 0/);
    assert.match(source, /sourceGrounded: false/);
  });

  it("keeps reason, classification, actor, and time in durable audit provenance", () => {
    assert.match(source, /entityType: "TenderRequirement"/);
    assert.match(source, /sourceOrigin: data\.sourceOrigin/);
    assert.match(source, /reason: data\.reason/);
    assert.match(source, /requestId/);
    assert.match(source, /prisma\.auditLog\.findMany/);
    assert.match(source, /manualEnteredBy/);
    assert.match(source, /manualEnteredAt/);
    assert.match(source, /legacyManualReason/);
  });

  it("keeps tenant isolation and mutation throttling", () => {
    const ownerChecks = source.match(/where: \{ id: tenderId, userId: actor\.id \}/g) ?? [];
    assert.equal(ownerChecks.length, 2);
    assert.match(source, /rateLimitPersistent\(`manual-requirement:\$\{actor\.id\}`/);
    assert.match(source, /MUTATION_RATE_LIMIT/);
    assert.match(source, /await prismaReady/);
  });

  it("preserves mandatory-source fail-closed semantics in the response", () => {
    assert.match(source, /sourceGrounded: !isManual && Boolean\(requirement\.sourceTenderFileId/);
    assert.match(source, /sourceOrigin: isManual \? audit\?\.sourceOrigin \?\? "HUMAN_ENTERED" : "SOURCE_GROUNDED"/);
  });

  it("handles null and malformed audit metadata without crashing the GET endpoint", () => {
    // The audit row's metadata field can be null per the Prisma schema.
    // Passing null to JSON.parse would throw and crash the GET endpoint.
    // The route must skip rows with null metadata.
    assert.match(source, /if \(!row\.metadata\) continue/);
    // parseManualAuditMetadata must handle malformed JSON gracefully.
    const parseFnPos = source.indexOf("function parseManualAuditMetadata");
    const parseFnRegion = source.slice(parseFnPos, parseFnPos + 600);
    assert.match(parseFnRegion, /try\s*\{/);
    assert.match(parseFnRegion, /catch/);
  });

  it("a mandatory manual requirement cannot satisfy the source-grounding release gate", () => {
    // A manual requirement has sourceGrounded: false and sourceConfidence: 0.
    // The release gate must reject it.
    assert.match(source, /sourceGrounded: false/);
    assert.match(source, /sourceConfidence: 0/);
    // The response must not mark manual requirements as source-grounded.
    assert.match(source, /sourceGrounded: !isManual && Boolean\(requirement\.sourceTenderFileId/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});

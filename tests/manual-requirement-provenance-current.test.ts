import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/requirements/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

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

  it("keeps Vercel Git deployment disabled", () => {
    assert.equal(vercel.git?.deploymentEnabled, false);
  });
});

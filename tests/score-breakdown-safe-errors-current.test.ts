import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/tenders/[id]/score-breakdown/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

describe("score-breakdown safe response boundary", () => {
  it("keeps runtime errors stable and correlated", () => {
    assert.doesNotMatch(source, /sanitizeError/);
    assert.doesNotMatch(source, /detail:\s*(?:error|message)/);
    assert.match(source, /SCORE_BREAKDOWN_RUNTIME_ERROR/);
    assert.match(source, /Score breakdown could not be loaded/);
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
  });

  it("keeps owner scoping and non-enumerating not-found behavior", () => {
    assert.match(source, /where: \{ id, userId: actor\.id \}/);
    assert.match(source, /TENDER_NOT_FOUND/);
    assert.match(source, /status: 404/);
  });

  it("preserves all twelve canonical scoring dimensions", () => {
    const dimensions = [
      "DISCIPLINE_FIT",
      "SCOPE_COVERAGE",
      "SENIORITY_OR_SCALE",
      "SECTOR_FIT",
      "ROLE_RECENCY",
      "EVIDENCE_QUALITY",
      "COMPLIANCE_CRITICALITY",
      "PORTFOLIO_CONTRIBUTION",
      "MANDATORY_ELIGIBILITY",
      "DELIVERY_RISK",
      "DIFFERENTIATION",
      "COMMERCIAL_VALUE",
    ];
    for (const dimension of dimensions) assert.match(source, new RegExp(`"${dimension}"`));
    assert.match(source, /computeWeightedScore/);
    assert.match(source, /deriveCorrectiveActions/);
    assert.match(source, /score < 40/);
  });

  it("preserves expert and project queries and display output", () => {
    assert.match(source, /tenderExpertMatch\.findMany/);
    assert.match(source, /tenderProjectMatch\.findMany/);
    assert.match(source, /matchScoreBreakdown\.findMany/);
    assert.match(source, /dimensionOrder: DIMENSION_ORDER/);
    assert.match(source, /correctiveActionSummary/);
  });

  it("keeps the route read-only", () => {
    assert.doesNotMatch(source, /\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\(/);
  });

  it("keeps Vercel Git deployment enabled for main (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.main, true);
  });
});

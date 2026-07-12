import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/admin/generated-proposals/audit/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("admin generated-proposal audit response boundary", () => {
  it("returns a stable correlated runtime error without exception detail", () => {
    const catchStart = source.lastIndexOf("  } catch (error) {");
    const catchRegion = source.slice(catchStart);
    assert.match(catchRegion, /ADMIN_AUDIT_RUNTIME_ERROR/);
    assert.match(catchRegion, /requestId/);
    assert.match(catchRegion, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.doesNotMatch(catchRegion, /sanitizeError/);
    assert.doesNotMatch(catchRegion, /detail:/);
    assert.doesNotMatch(catchRegion, /error\.message/);
    assert.doesNotMatch(catchRegion, /String\(error\)/);
  });

  it("keeps the endpoint ADMIN-only and bounded", () => {
    assert.match(source, /requireRole\("ADMIN"\)/);
    assert.match(source, /Math\.min\(200/);
    assert.match(source, /take: limitParam \* 2/);
  });

  it("preserves metadata-only document selection", () => {
    assert.match(source, /fileContent: true/);
    assert.match(source, /storagePath: true/);
    assert.match(source, /documents: visibleRows/);
    assert.doesNotMatch(source, /visibleText\s*[,}]/);
    assert.doesNotMatch(source, /inlineBase64\s*[,}]/);
    assert.doesNotMatch(source, /fileContent:\s*document\.fileContent/);
  });

  it("preserves all audit issue flags and quality checks", () => {
    for (const flag of [
      "aiTraceIssue",
      "placeholderIssue",
      "bidTeamToConfirmIssue",
      "pricingLeakageIssue",
      "genericContentIssue",
      "unsupportedClaimRisk",
      "internalTraceabilityIssue",
      "officialOriginalPlaceholderRisk",
      "missingContentIssue",
      "duplicatedSectionsIssue",
    ]) {
      assert.match(source, new RegExp(`\\b${flag}\\b`));
    }
    assert.match(source, /assessGeneratedDocumentQuality/);
    assert.match(source, /validateFileSignature/);
    assert.match(source, /documentHygieneIssues/);
    assert.match(source, /containsPricingLeakage/);
  });

  it("keeps Vercel Git deployment disabled", () => {
    assert.equal(vercel.git?.deploymentEnabled, false);
  });
});

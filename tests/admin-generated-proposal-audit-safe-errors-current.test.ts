import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/admin/generated-proposals/audit/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

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

  it("preserves metadata-only response output", () => {
    assert.match(source, /fileContent: true/);
    assert.match(source, /storagePath: true/);
    const responseStart = source.indexOf("    return NextResponse.json({\n      success: true");
    const catchStart = source.lastIndexOf("  } catch (error) {");
    assert.ok(responseStart >= 0 && catchStart > responseStart);
    const responseRegion = source.slice(responseStart, catchStart);
    assert.match(responseRegion, /documents: visibleRows/);
    assert.doesNotMatch(responseRegion, /visibleText/);
    assert.doesNotMatch(responseRegion, /inlineBase64/);
    assert.doesNotMatch(responseRegion, /fileContent/);
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

  it("keeps Vercel Git deployment enabled for main (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.main, true);
  });
});

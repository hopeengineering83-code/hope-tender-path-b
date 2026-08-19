import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const codeOnly = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

describe("pipeline authority non-negotiables — manual AI Analyze / manual Run Engine", () => {
  it("client upload nudges ONLY EXTRACT_TEXT — never AI_ANALYZE", () => {
    const source = read("lib/ui/auto-pipeline.ts");
    assert.match(source, /jobType=EXTRACT_TEXT/);
    assert.match(source, /processingJobId/);
    // The browser must NOT nudge AI_ANALYZE. The comment explicitly documents
    // that AI_ANALYZE_WORKER_ENDPOINT is intentionally NOT exported.
    assert.match(source, /AI_ANALYZE_WORKER_ENDPOINT is intentionally NOT exported/i);
    assert.doesNotMatch(source, /export const AI_ANALYZE_WORKER_ENDPOINT/);
    assert.match(source, /Run AI Analyze/i);
  });

  it("workflow step links are navigation-only and execute no pipeline mutations", () => {
    const source = codeOnly(read("components/workflow-step-links.tsx"));
    assert.doesNotMatch(source, /fetch\s*\(/);
    assert.doesNotMatch(source, /runManualAction|wakeWorker/);
  });

  it("Company Vault repair uses byte re-import, not extracted-text-only repair", () => {
    for (const path of ["app/dashboard/company/page.tsx", "components/company-vault-verification-page.tsx"]) {
      const source = read(path);
      assert.match(source, /fetch\("\/api\/company\/reimport",\s*\{\s*method\s*:\s*"POST"/);
      assert.doesNotMatch(source, /fetch\("\/api\/company\/knowledge\/repair",\s*\{\s*method\s*:\s*"POST"/);
    }
  });

  it("workflow center projects action contracts but executes no mutation", () => {
    const source = read("app/api/tenders/[id]/workflow-center/route.ts");
    assert.doesNotMatch(source, /actionUrl\s*:/);
    assert.doesNotMatch(source, /actionMethod\s*:/);
    assert.match(source, /actionKind: action\.mutation \? "mutation" as const : "navigation" as const/);
    assert.match(source, /mutation: action\.mutation/);
    assert.doesNotMatch(source, /fetch\s*\(|axios\./);
  });

  it("partial analysis remains terminally non-successful", () => {
    const source = read("lib/ai-job-handlers-legacy.ts");
    assert.match(source, /Partial \/ fallback \/ provider-exhausted/);
    assert.match(source, /do NOT create or\s*\n\s*\/\/ unlock GeneratedDocument rows/);
    assert.match(source, /if \(exec\.completedChunks > 0\) return "PARTIAL_SUCCESS"/);
  });

  it("mixed documents are processed without fabricating reviewed trust", () => {
    const routePage = read("app/dashboard/company/review/page.tsx");
    const verificationPage = read("components/company-vault-verification-page.tsx");
    const ingestion = read("lib/company-vault-ingestion.ts");
    assert.match(routePage, /company-vault-verification-page/);
    assert.match(verificationPage, /Automatic Verification/);
    assert.match(verificationPage, /No human approval step is required/);
    // Ingestion no longer carries its own findSourceDocument helper: source
    // binding was unified onto the canonical remapper so full and partial
    // verification cannot disagree about what "identity verified" means.
    // Pinning the delegation is stronger than pinning the old private helper
    // — a second in-file matcher reappearing is exactly the regression this
    // guards against.
    assert.match(ingestion, /remapUnlinkedVaultSources/);
    assert.match(ingestion, /source quote did not bind unambiguously to one strongest owned document/);
    // The one assertion here that is about safety rather than structure:
    // ingestion must never manufacture human review.
    assert.doesNotMatch(ingestion, /trustLevel:\s*"REVIEWED"/);
  });
});

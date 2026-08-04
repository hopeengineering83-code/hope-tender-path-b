import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const codeOnly = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

describe("pipeline authority non-negotiables", () => {
  it("client upload wakes extraction only and cannot start AI Analyze", () => {
    const source = read("lib/ui/auto-pipeline.ts");
    assert.match(source, /jobType=EXTRACT_TEXT/);
    assert.doesNotMatch(source, /run-next\?jobType=AI_ANALYZE/);
    assert.doesNotMatch(source, /manual-ai-analyze/);
    assert.match(source, /AI Analyze remains an explicit action|select AI Analyze/i);
  });

  it("reports a failed worker wake honestly instead of promising a scheduler", () => {
    const source = codeOnly(read("components/workflow-step-links.tsx"));
    assert.match(source, /Queued, but the background worker could not be started from here/);
    assert.match(source, /It stays queued and runs when a worker next picks it up/);
    assert.doesNotMatch(source, /scheduled background worker will continue it/);
    assert.match(source, /if \(!response\.ok\) setMessage\(couldNotStart\)/);
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
    assert.match(ingestion, /findSourceDocument/);
    assert.match(ingestion, /source quote did not bind to one owned document/);
    assert.doesNotMatch(ingestion, /trustLevel:\s*"REVIEWED"/);
  });
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("pipeline authority non-negotiables", () => {
  it("client upload flow cannot POST AI Analyze", () => {
    const source = read("lib/ui/auto-pipeline.ts");
    assert.doesNotMatch(source, /fetch\([^)]*ai-analyze/);
    assert.match(source, /server is the single orchestration owner/i);
  });

  it("Company Vault repair uses byte re-import, not extracted-text-only repair", () => {
    const source = read("lib/ui/auto-pipeline.ts");
    assert.match(source, /const endpoint = "\/api\/company\/reimport"/);
    assert.doesNotMatch(source, /company\/knowledge\/repair/);
  });

  it("workflow center cannot directly mutate gated stages", () => {
    const source = read("app/api/tenders/[id]/workflow-center/route.ts");
    assert.doesNotMatch(source, /actionUrl\s*:/);
    assert.doesNotMatch(source, /actionMethod\s*:/);
    assert.match(source, /actionKind: "navigation" as const/);
  });

  it("partial analysis remains terminally non-successful", () => {
    // AI_ANALYZE's implementation lives in ai-job-handlers-legacy.ts —
    // lib/ai-job-handlers.ts now only re-exports it and locally overrides
    // EXTRACT_TEXT's getHandler branch.
    const source = read("lib/ai-job-handlers-legacy.ts");
    assert.match(source, /Partial \/ fallback \/ provider-exhausted/);
    assert.match(source, /do NOT create or\s*\n\s*\/\/ unlock GeneratedDocument rows/);
    assert.match(source, /if \(exec\.completedChunks > 0\) return "PARTIAL_SUCCESS"/);
  });

  it("mixed documents are processed and records are reviewable", () => {
    const review = read("app/dashboard/company/review/page.tsx");
    const ingestion = read("lib/company-vault-ingestion.ts");
    // Updated: the review page no longer mentions "dedicated sources remain
    // strongest" — it now says "Company documents detected and processed"
    assert.match(review, /Company documents detected/i);
    assert.match(ingestion, /findSourceDocument/);
    assert.match(ingestion, /source quote did not bind to one owned document/);
    assert.doesNotMatch(ingestion, /trustLevel:\s*"REVIEWED"/);
  });
});

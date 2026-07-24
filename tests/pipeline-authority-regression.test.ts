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
  });

  it("partial analysis remains terminally non-successful", () => {
    const source = read("lib/ai-job-handlers.ts");
    assert.match(source, /Partial \/ fallback \/ provider-exhausted/);
    assert.match(source, /do NOT create or\s*\n\s*\/\/ unlock GeneratedDocument rows/);
    assert.match(source, /if \(exec\.completedChunks > 0\) return "PARTIAL_SUCCESS"/);
  });

  it("Company Vault summary documents remain non-authoritative for expert and project proof", () => {
    const source = read("app/dashboard/company/review/page.tsx");
    assert.match(source, /support summaries cannot prove individual CV or project claims/i);
    assert.match(source, /Expert CV/);
    assert.match(source, /Project Reference/);
  });
});

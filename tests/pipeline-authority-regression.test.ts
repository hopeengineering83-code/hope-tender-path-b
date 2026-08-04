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
    // This used to be pinned to a helper in lib/ui/auto-pipeline.ts that no
    // production file ever imported, so it proved the endpoint of dead code.
    // The guarantee is unchanged — repair must re-read stored bytes rather than
    // patch extracted text — but it now has to hold where repair is actually
    // invoked, which is the two Vault controls.
    for (const path of ["app/dashboard/company/page.tsx", "components/company-vault-verification-page.tsx"]) {
      const source = read(path);
      assert.match(
        source,
        /fetch\("\/api\/company\/reimport",\s*\{\s*method\s*:\s*"POST"/,
        `${path} must repair through the byte re-import route`,
      );
      // knowledge/repair is a diagnostics READ. It must never be the repair
      // mutation: it reports on extracted text and cannot restore source bytes.
      assert.doesNotMatch(
        source,
        /fetch\("\/api\/company\/knowledge\/repair",\s*\{\s*method\s*:\s*"POST"/,
        `${path} must not use the diagnostics route as a repair mutation`,
      );
    }
  });

  it("workflow center cannot directly mutate gated stages", () => {
    const source = read("app/api/tenders/[id]/workflow-center/route.ts");
    assert.doesNotMatch(source, /actionUrl\s*:/);
    assert.doesNotMatch(source, /actionMethod\s*:/);
    assert.match(source, /actionKind: "navigation" as const/);
  });

  it("partial analysis remains terminally non-successful", () => {
    const source = read("lib/ai-job-handlers-legacy.ts");
    assert.match(source, /Partial \/ fallback \/ provider-exhausted/);
    assert.match(source, /do NOT create or\s*\n\s*\/\/ unlock GeneratedDocument rows/);
    assert.match(source, /if \(exec\.completedChunks > 0\) return "PARTIAL_SUCCESS"/);
  });

  it("mixed documents are processed and the active Vault page exposes automatic verification", () => {
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

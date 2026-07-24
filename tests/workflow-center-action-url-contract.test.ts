// Workflow Center route — action URL contract tests.
//
// The workflow-center route (app/api/tenders/[id]/workflow-center/route.ts)
// emits one stage object per workflow step. Each stage has an actionName +
// actionKind + actionLabel. Stages whose mutation can be fired with no
// user-choosable parameters (Build Plan, Match Evidence, Generate, Validate,
// AI Analyze) ALSO emit actionUrl + actionMethod so the Action Center can
// fire the mutation directly — instead of falling through to scroll-to-panel.
//
// This test verifies the route source code declares actionUrl for the
// expected stages. It is a source-level test (not an HTTP test) so it runs
// without a database and is deterministic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readRouteSource(): string {
  return readFileSync(
    resolve(process.cwd(), "app/api/tenders/[id]/workflow-center/route.ts"),
    "utf8",
  );
}

describe("workflow-center route — actionUrl contract", () => {
  const source = readRouteSource();

  it("declares actionUrl for stage 3 (AI Analyze)", () => {
    // The route emits an object literal for each stage. We verify the
    // stage 3 object includes actionUrl by checking the source contains
    // the URL pattern in the right place. We can't easily parse the AST
    // in a test, so we check that the AI Analyze URL appears at least once.
    assert.match(
      source,
      /actionUrl:\s*`\/api\/tenders\/\$\{tenderId\}\/ai-analyze\?mode=background`/,
    );
  });

  it("declares actionUrl for stage 6 (Build Submission Plan)", () => {
    assert.match(
      source,
      /actionUrl:\s*`\/api\/tenders\/\$\{tenderId\}\/submission-plan\/build`/,
    );
  });

  it("declares actionUrl for stage 7 (Link Vault Evidence)", () => {
    assert.match(
      source,
      /actionUrl:\s*`\/api\/tenders\/\$\{tenderId\}\/link-vault-evidence-auto`/,
    );
  });

  it("declares actionUrl for stage 8 (Generate)", () => {
    assert.match(
      source,
      /actionUrl:\s*`\/api\/tenders\/\$\{tenderId\}\/generate-missing-plan-files`/,
    );
  });

  it("declares actionUrl for stage 9 (Validate Docs)", () => {
    assert.match(
      source,
      /actionUrl:\s*`\/api\/tenders\/\$\{tenderId\}\/validate`/,
    );
  });

  it("does NOT declare actionUrl for stage 1 (Manage Files) — requires user file selection", () => {
    // Stage 1 cannot fire from the Action Center because uploading requires
    // the user to pick files. The route MUST NOT set actionUrl for stage 1.
    // We approximate this by checking that the stage-1 object literal does
    // not contain actionUrl — the source has a comment explaining why.
    const stageOneBlock = source.match(/stage:\s*1,[\s\S]*?pageLedgers/);
    if (stageOneBlock) {
      assert.doesNotMatch(stageOneBlock[0], /actionUrl:/, "Stage 1 must NOT declare actionUrl — file upload requires user file selection");
    }
  });

  it("does NOT declare actionUrl for stage 10 (Export) — download requires verification panel", () => {
    // Stage 10 scrolls to the export panel because the download button
    // there carries the byte-integrity verification UI. A direct GET from
    // the Action Center would skip the verification panel.
    const stageTenBlock = source.match(/stage:\s*10,[\s\S]*?\}\s*,\s*\]/);
    if (stageTenBlock) {
      assert.doesNotMatch(stageTenBlock[0], /actionUrl:/, "Stage 10 must NOT declare actionUrl — download requires the verification panel");
    }
  });

  it("every actionUrl is paired with actionMethod: POST", () => {
    // Every mutation actionUrl must specify POST. A GET mutation would be
    // wrong (mutations change state and must not be cacheable).
    const actionUrlLines = source.match(/actionUrl:\s*`[^`]+`,/g) ?? [];
    for (const line of actionUrlLines) {
      // Find the actionMethod that follows within 4 lines.
      const idx = source.indexOf(line);
      const tail = source.slice(idx, idx + 200);
      assert.match(tail, /actionMethod:\s*"POST"/, `actionUrl line "${line}" must be followed by actionMethod: "POST"`);
    }
  });
});

describe("workflow-center route — actionKind contract", () => {
  const source = readRouteSource();

  it("every stage declares actionKind using isMutationAction", () => {
    // Every stage must classify its action as mutation or readonly using
    // the shared isMutationAction helper. This prevents drift between the
    // route and the recovery-command-actions registry.
    const stages = source.match(/\{\s*stage:\s*\d+,/g) ?? [];
    const actionKindDeclarations = (source.match(/actionKind:\s*isMutationAction/g) ?? []).length;
    assert.equal(
      actionKindDeclarations,
      stages.length,
      `Expected ${stages.length} actionKind declarations (one per stage), got ${actionKindDeclarations}`,
    );
  });
});

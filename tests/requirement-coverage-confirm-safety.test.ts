import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("requirement coverage confirmation safety", () => {
  const panel = readFileSync("components/requirement-coverage-panel.tsx", "utf8");
  const route = readFileSync("app/api/tenders/[id]/requirement-coverage/confirm/route.ts", "utf8");

  it("does not bulk-confirm auto-linked suggestions as FULL support", () => {
    assert.doesNotMatch(panel, /supportLevel:\s*"FULL"/);
    assert.match(panel, /Confirm all as partial/);
    assert.match(panel, /Confirm partial evidence/);
  });

  it("warns reviewers that auto-linked evidence cannot become FULL without traceability review", () => {
    assert.match(panel, /Auto-linked vault suggestions can only be confirmed as PARTIAL/);
    assert.match(panel, /FULL\/SUBSTANTIAL coverage requires a compliance-matrix confirmation with traceable source support/);
  });

  it("caps direct strong-support requests to PARTIAL in the confirm endpoint", () => {
    assert.match(route, /requested === "FULL" \|\| requested === "SUBSTANTIAL"/);
    assert.match(route, /level:\s*"PARTIAL"/);
    assert.match(route, /supportLevelCapped/);
    assert.match(route, /requestedSupportLevel/);
  });
});

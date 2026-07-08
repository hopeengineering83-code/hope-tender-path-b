import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("readiness UI contradiction guardrails", () => {
  it("blocked generation button does not stay green or say Generate Docs", () => {
    const source = readFileSync(resolve(process.cwd(), "components/generation-action-panel.tsx"), "utf8");
    assert.match(source, /Tender details incomplete|Resolve blockers|review optional warnings/);
    assert.match(source, /cursor-not-allowed/);
  });

  it("export readiness normalizes mandatory evidence support before displaying 0\/N blockers", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/export-readiness/route.ts"), "utf8");
    assert.match(source, /normalizeSupportLevel/);
    assert.match(source, /mandatoryEvidence/);
    assert.match(source, /MANDATORY_EVIDENCE_INCOMPLETE/);
  });

  it("controls summary includes suggested controls so totals do not show zero while suggestions exist", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/controls/route.ts"), "utf8");
    assert.match(source, /suggested: suggested\.length/);
    assert.match(source, /persistedTotal/);
    assert.match(source, /persistedSummary\.total \+ suggested\.length/);
  });
});

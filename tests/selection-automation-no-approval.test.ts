import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readApp(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("automatic evidence selection has no browser-only approval gate", () => {
  const source = readApp("components/selection-approval-panel.tsx");

  it("does not expose approval actions or approved client state", () => {
    assert.doesNotMatch(source, /Approve Selection & Continue/);
    assert.doesNotMatch(source, /Selection Approved/);
    assert.doesNotMatch(source, /setApproved|\[approved,\s*setApproved\]/);
    assert.doesNotMatch(source, /approveSelection/);
  });

  it("labels the persisted result as Engine-selected evidence", () => {
    assert.match(source, /Engine-selected evidence/);
    assert.match(source, /Downstream processing continues automatically/);
    assert.match(source, /id="selected-evidence"/);
  });

  it("keeps authorized exception edits bound to the persisted matches route", () => {
    assert.match(source, /fetch\(`\/api\/tenders\/\$\{tenderId\}\/matches`/);
    assert.match(source, /method: "PUT"/);
    assert.match(source, /disabled=\{!canMutate \|\| busy\}/);
  });
});

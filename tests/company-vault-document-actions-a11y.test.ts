import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("app/dashboard/company/page.tsx", "utf8");

describe("Company Vault document row actions", () => {
  it("keeps row actions keyboard discoverable with focus-within, not hover only", () => {
    assert.match(source, /group-focus-within:opacity-100/);
    assert.match(source, /focus-visible:outline/);
  });

  it("uses mobile/tablet friendly touch targets for document row actions", () => {
    assert.match(source, /min-h-8 min-w-8/);
  });

  it("requires explicit confirmation before deleting a Company Vault document", () => {
    assert.match(source, /window\.confirm\(/);
    assert.match(source, /removes it from future evidence selection and cannot be undone/);
  });

  it("prevents duplicate delete clicks and reports safe user-facing failures", () => {
    assert.match(source, /deletingDocId/);
    assert.match(source, /if \(deletingDocId\) return/);
    assert.match(source, /We could not delete that Company Vault document/);
    assert.doesNotMatch(source, /String\(err\)|stack|trace/i);
  });
});

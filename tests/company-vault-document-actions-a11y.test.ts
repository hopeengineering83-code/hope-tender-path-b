import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("app/dashboard/company/page.tsx", "utf8");

describe("Company Vault document row actions", () => {
  it("keeps row actions keyboard discoverable with focus-within, not hover only", () => {
    assert.match(source, /group-focus-within:opacity-100/);
    assert.match(source, /focus-visible:outline/);
  });

  it("uses mobile/tablet friendly touch targets and visible text labels for document row actions", () => {
    assert.match(source, /min-h-8 rounded border/);
    assert.match(source, /min-h-8 rounded-md/);
    assert.match(source, />Re-extract<|>Re-extract<\/button>/);
    assert.match(source, />Download<\/a>/);
    assert.match(source, /Deleting…" : "Delete"/);
  });

  it("uses an accessible in-page confirmation instead of native window.confirm", () => {
    assert.doesNotMatch(source, /window\.confirm\(/);
    assert.match(source, /confirmingDeleteDocId/);
    assert.match(source, /role="region"/);
    assert.match(source, /aria-labelledby=\{`delete-confirm-title-\$\{doc\.id\}`\}/);
    assert.match(source, /aria-describedby=\{`delete-confirm-help-\$\{doc\.id\}`\}/);
    assert.match(source, /aria-expanded=\{confirmingDeleteDocId===doc\.id\}/);
    assert.match(source, /aria-controls=\{`delete-confirm-\$\{doc\.id\}`\}/);
    assert.match(source, /Yes, delete document/);
    assert.match(source, /removes it from future evidence selection and cannot be undone/);
  });

  it("prevents duplicate delete clicks and reports safe user-facing failures", () => {
    assert.match(source, /deletingDocId/);
    assert.match(source, /if \(deletingDocId\) return/);
    assert.match(source, /disabled=\{deletingDocId!==null\}/);
    assert.match(source, /deleteButtonRefs/);
    assert.match(source, /confirmDeleteButtonRefs/);
    assert.match(source, /else delete deleteButtonRefs\.current\[doc\.id\]/);
    assert.match(source, /else delete confirmDeleteButtonRefs\.current\[doc\.id\]/);
    assert.match(source, /requestAnimationFrame\(\(\) => confirmDeleteButtonRefs/);
    assert.match(source, /requestAnimationFrame\(\(\) => deleteButtonRefs/);
    assert.match(source, /onDeleteConfirmationKeyDown/);
    assert.match(source, /event\.key !== "Escape"/);
    assert.match(source, /Press Escape to cancel/);
    assert.match(source, /We could not delete that Company Vault document/);
    assert.match(source, /role="alert" aria-live="assertive"/);
    assert.doesNotMatch(source, /String\(err\)|stack|trace/i);
  });
});

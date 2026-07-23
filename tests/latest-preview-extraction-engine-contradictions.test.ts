import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("latest preview — extraction truth has one meaning", () => {
  it("source-file status distinguishes page coverage from quality score", () => {
    const source = read("components/tender-source-files-panel.tsx");
    assert.match(source, /Coverage \/ quality/);
    assert.match(source, /quality \$\{quality\}\/100/);
    assert.doesNotMatch(source, /\$\{Math\.round\(file\.extractionScore\)\}% extraction/);
  });

  it.skip("snapshot diagnostics use canonical ledger or persisted aggregate coverage and hide clean duplicates", () => {
    // Skipped: component was deleted as dead code.
  });
});

describe("latest preview — Engine outcome is canonical and provenance-aware", () => {
  it("runtime reviewed-vault counts use durable source provenance", () => {
    const source = read("lib/company-ingestion-readiness.ts");
    assert.match(source, /function hasRuntimeReviewAuthorityShape/);
    assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(record, "sourceDocumentId"\)/);
    assert.match(source, /durableReview: hasRuntimeReviewAuthorityShape\(record\) \? isDurablyReviewed\(record\) : undefined/);
    assert.match(source, /source-verified reviewed experts/);
    assert.match(source, /source-verified reviewed projects/);
  });

  it("postconditions do not emit both zero-row and no-selection blockers for the same evidence class", () => {
    const source = read("lib/engine/engine-postconditions.ts");
    assert.match(source, /if \(expertReqCount > 0 && totalExperts === 0\)[\s\S]*else if \(expertReqCount > 0 && reviewedExperts === 0\)/);
    assert.match(source, /if \(projectReqCount > 0 && totalProjects === 0\)[\s\S]*else if \(projectReqCount > 0 && reviewedProjects === 0\)/);
    assert.match(source, /NO_SELECTED_SOURCE_VERIFIED_EXPERTS_AFTER_ENGINE/);
    assert.match(source, /NO_SELECTED_SOURCE_VERIFIED_PROJECTS_AFTER_ENGINE/);
  });

  it("Engine panel presents one blocked outcome and one deduplicated gap list", () => {
    const source = read("components/engine-action-panel.tsx");
    assert.match(source, /Engine run completed, but matching is blocked\./);
    assert.match(source, /Background Engine run completed, but matching is blocked\./);
    assert.match(source, /const visibleBlockers =/);
    assert.match(source, /new Set\(result\.blockers\.map/);
    assert.match(source, /Blocking evidence gaps/);
    assert.doesNotMatch(source, />Follow-up items</);
    assert.doesNotMatch(source, /<strong>Detail:<\/strong>/);
  });
});

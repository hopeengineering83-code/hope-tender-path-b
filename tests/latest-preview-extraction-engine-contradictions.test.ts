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
});

describe("latest preview — Engine outcome is canonical and provenance-aware", () => {
  it("runtime Vault eligibility uses durable source or review authority", () => {
    const provenance = read("lib/vault-review-provenance.ts");
    const matching = read("lib/engine/matching-eligibility.ts");
    assert.match(provenance, /isDurablyReviewed\(record\) \|\| isDurablySourceVerified\(record\)/);
    assert.match(matching, /canUseVaultRecordSafely/);
    assert.doesNotMatch(provenance, /all non-expired company records are usable/i);
  });

  it("postconditions do not emit both zero-row and no-selection blockers for the same evidence class", () => {
    const source = read("lib/engine/engine-postconditions.ts");
    assert.match(source, /if \(expertReqCount > 0 && totalExperts === 0\)[\s\S]*else if \(expertReqCount > 0 && reviewedExperts === 0\)/);
    assert.match(source, /if \(projectReqCount > 0 && totalProjects === 0\)[\s\S]*else if \(projectReqCount > 0 && reviewedProjects === 0\)/);
    assert.match(source, /NO_SELECTED_SOURCE_VERIFIED_EXPERTS_AFTER_ENGINE/);
    assert.match(source, /NO_SELECTED_SOURCE_VERIFIED_PROJECTS_AFTER_ENGINE/);
  });

  // The Engine-panel blocked-outcome case was removed with the panel. The
  // blocker CODES asserted above are produced server-side and still matter;
  // how one deleted panel formatted them does not.
});

// PR #866 FINAL SAFETY FIX — fallback approval must never imply generation/export is unlocked.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

describe("PR #866 final safety — fallback wording", () => {

  // The four tender-recovery-command-center.tsx checks that used to live here
  // are removed -- that file was deleted as unrendered dead code (nothing
  // imports or renders it). export-readiness-panel.tsx below is the live,
  // rendered panel that owns this same fallback-approval contract.

  it("export-readiness-panel.tsx does NOT say 'Regex fallback analysis approved'", () => {
    const src = read("components/export-readiness-panel.tsx");
    assert.ok(!/Regex fallback analysis approved/i.test(src), "must NOT say 'Regex fallback analysis approved'");
  });

  it("export-readiness-panel.tsx fallback message says generation/export remain blocked", () => {
    const src = read("components/export-readiness-panel.tsx");
    assert.match(src, /generation and export remain blocked until full AI analysis succeeds/);
  });

  it("NO component implies fallback/partial/regex unblocks or unlocks generation/export", () => {
    const files = [
      // tender-recovery-command-center.tsx and final-submission-control-center.tsx
      // were deleted as unrendered dead code (nothing imports or renders
      // either); export-readiness-panel.tsx below is the live successor to
      // both and remains covered.
      "components/export-readiness-panel.tsx",
      "components/ai-analyze-recovery-panel.tsx",
      "components/ai-analyze-panel.tsx",
      "components/generation-readiness-panel.tsx",
      "components/analysis-quality-panel.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      assert.ok(
        !/fallback.*unblock|fallback.*unlock|partial.*unblock|partial.*unlock|regex.*unblock|regex.*unlock/i.test(src),
        `${f} must NOT imply fallback/partial/regex unblocks or unlocks generation/export`,
      );
    }
  });
});

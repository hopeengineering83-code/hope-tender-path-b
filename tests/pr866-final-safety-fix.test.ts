// PR #866 FINAL SAFETY FIX — fallback approval must never imply generation/export is unlocked.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

describe("PR #866 final safety — fallback wording", () => {

  it("tender-recovery-command-center.tsx does NOT contain 'generation unblocked'", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(!/generation unblocked/i.test(src), "must NOT contain 'generation unblocked'");
  });

  it("tender-recovery-command-center.tsx does NOT contain 'fallback analysis approved'", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(!/fallback analysis approved/i.test(src), "must NOT contain 'fallback analysis approved'");
  });

  it("tender-recovery-command-center.tsx does NOT contain 'approve below'", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(!/approve below/i.test(src), "must NOT contain 'approve below'");
  });

  it("tender-recovery-command-center.tsx fallback approval says generation/export remain blocked", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.match(src, /Fallback note saved for audit\. Generation and export remain blocked until full AI analysis succeeds\./);
  });

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
      "components/tender-recovery-command-center.tsx",
      "components/export-readiness-panel.tsx",
      "components/ai-analyze-recovery-panel.tsx",
      "components/ai-analyze-panel.tsx",
      "components/generation-readiness-panel.tsx",
      "components/final-submission-control-center.tsx",
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

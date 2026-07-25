// Screenshot contradictions round 2 — regression tests.
//
// Tests fixes for issues found in 3 production screenshots:
// 1. ⚡ Unicode dingbat in engine-action-panel (should be plain text)
// 2. setError(e.message) in recovery command center (should use safe message)
// 3. throw new Error(json.error) in lifecycle load (should not surface API error text)

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Screenshot round 2 — no Unicode dingbats in engine-action-panel", () => {
  it("does not use ⚡ Unicode dingbat", () => {
    const src = read("components/engine-action-panel.tsx");
    assert.ok(!/[⚡]/.test(src), "must not use raw ⚡ Unicode char");
  });

  it("does not use ⏳ Unicode dingbat", () => {
    const src = read("components/engine-action-panel.tsx");
    assert.ok(!/[⏳]/.test(src), "must not use raw ⏳ Unicode char");
  });
});

// "Screenshot round 2 — recovery command center error safety" describe block
// removed -- components/tender-recovery-command-center.tsx was deleted as
// unrendered dead code (nothing imports or renders it). It was the only
// component that ever fetched `/api/tenders/${tenderId}/lifecycle` directly
// from the client; its live successor, components/next-action-panel.tsx, is
// a server component that reads getCanonicalTenderWorkflowDecision() via
// Prisma with no client-side fetch/setError/lifecycle-load path at all, so
// there is nothing to redirect these two assertions to.

describe("Screenshot round 2 — no raw Unicode dingbats remaining", () => {
  it("no ⚡ or ⏳ in any component (excluding comments in icons.tsx)", () => {
    const { execFileSync } = require("node:child_process");
    const files = execFileSync("git", ["ls-files", "components/"], { encoding: "utf8" })
      .trim().split("\n").filter((f: string) => f.endsWith(".tsx"));
    const offenders: string[] = [];
    for (const file of files) {
      if (file === "components/icons.tsx") continue; // icons.tsx documents dingbats in comments
      const src = read(file);
      // Check for dingbats in actual code (not comments)
      const lines = src.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue; // skip comments
        if (/[⚡⏳]/.test(line)) {
          offenders.push(`${file}: ${trimmed}`);
          break;
        }
      }
    }
    assert.deepEqual(offenders, [], `no components should use ⚡ or ⏳ Unicode dingbats in code: ${offenders.join(", ")}`);
  });
});

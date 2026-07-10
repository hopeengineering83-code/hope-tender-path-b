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

describe("Screenshot round 2 — recovery command center error safety", () => {
  it("does not pass raw e.message to setError", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(
      !/setError\(e\s*instanceof\s*Error\s*\?\s*e\.message/.test(src),
      "must not pass raw e.message to setError",
    );
    assert.ok(
      !/setError\(e\.message/.test(src),
      "must not pass raw e.message to setError",
    );
  });

  it("lifecycle load does not throw new Error(json.error) — uses safe static message", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    // The lifecycle load function must not surface API error text.
    // Check that the lifecycle fetch block uses a safe static message.
    assert.ok(
      src.includes('throw new Error("Failed to load lifecycle state")'),
      "lifecycle load must use safe static error message",
    );
    // Check that the lifecycle catch block does not pass raw e.message
    assert.ok(
      !/setError\(e\s*instanceof\s*Error\s*\?\s*e\.message/.test(src),
      "lifecycle catch must not pass raw e.message to setError",
    );
  });
});

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

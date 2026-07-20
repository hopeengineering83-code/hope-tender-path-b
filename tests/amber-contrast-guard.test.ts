import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const layout = readFileSync("app/layout.tsx", "utf8");
const guard = readFileSync("components/amber-contrast-guard.tsx", "utf8");

describe("legacy amber contrast guard", () => {
  it("is mounted once at the root layout", () => {
    assert.match(layout, /AmberContrastGuard/);
    assert.equal((layout.match(/<AmberContrastGuard\s*\/>/g) ?? []).length, 1);
  });

  it("maps residual amber-700 utilities to the WCAG-oriented amber-800 foreground", () => {
    assert.match(guard, /\.text-amber-700/);
    assert.match(guard, /#92400e/);
    assert.match(guard, /!important/);
  });
});

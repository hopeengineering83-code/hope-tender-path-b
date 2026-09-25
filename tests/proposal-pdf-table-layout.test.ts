import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("proposal PDF table presentation", () => {
  const source = readFileSync("lib/engine/proposal-pdf.ts", "utf8");

  it("anchors the table top border before rows change the cursor", () => {
    assert.match(source, /const tableTopY = ctx\.y;/);
    assert.match(source, /const tableStartPage = currentPage\(ctx\);/);
    assert.match(source, /tableStartPage\.drawLine\([\s\S]*?y: tableTopY/);
    assert.doesNotMatch(source, /y: ctx\.y \+ rowHeights\[0\]/);
  });

  it("uses the navy header, restrained zebra rows, and a gold cover accent", () => {
    assert.match(source, /color: rgb\(\.\.\.BRAND_COLOR\)/);
    assert.match(source, /color: rgb\(\.\.\.TABLE_ALT_BG\)/);
    assert.match(source, /height: 6, color: rgb\(\.\.\.ACCENT_COLOR\)/);
  });
});

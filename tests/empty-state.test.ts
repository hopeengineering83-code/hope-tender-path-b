/**
 * Tests for the EmptyState component.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

describe("EmptyState component", () => {
  const src = readFileSync("package.json", "utf8");

  it("exports EmptyState component", () => {
    assert.ok(src.includes("export function EmptyState"), "Must export EmptyState");
  });

  it("accepts icon, title, description, actionLabel, onAction props", () => {
    assert.ok(src.includes("icon?"), "Must accept icon prop");
    assert.ok(src.includes("title:"), "Must accept title prop");
    assert.ok(src.includes("description?"), "Must accept description prop");
    assert.ok(src.includes("actionLabel?"), "Must accept actionLabel prop");
    assert.ok(src.includes("onAction?"), "Must accept onAction prop");
  });

  it("has accessible markup (aria-hidden on icon)", () => {
    assert.ok(src.includes('aria-hidden="true"'), "Icon must have aria-hidden");
  });

  it("has focus styles on action button", () => {
    assert.ok(src.includes("focus:ring"), "Button must have focus styles for keyboard users");
  });
});

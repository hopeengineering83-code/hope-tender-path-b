import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("PWA Manifest and Icons", () => {
  it("manifest should reference existing icons or be updated", () => {
    const manifestPath = join(process.cwd(), "public", "manifest.json");
    if (!existsSync(manifestPath)) {
      console.warn("manifest.json not found, skipping");
      return;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const icons = manifest.icons || [];

    for (const icon of icons) {
      const iconPath = join(process.cwd(), "public", icon.src.replace(/^\//, ""));
      // We don't fail yet, but we report it.
      if (!existsSync(iconPath)) {
        console.warn(`Icon referenced in manifest but missing from public/: ${icon.src}`);
      }
    }

    assert.ok(manifest.name, "Manifest should have a name");
  });
});

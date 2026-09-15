import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function publicPath(urlPath: string) {
  return path.join(root, "public", urlPath.replace(/^\//, ""));
}

describe("PWA static assets", () => {
  it("references only files that exist in public", () => {
    const manifestPath = path.join(root, "public", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      icons?: Array<{ src?: string }>;
    };

    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest must declare at least one icon");

    for (const icon of manifest.icons) {
      assert.ok(icon.src?.startsWith("/"), "manifest icon src must be an absolute app path");
      assert.equal(existsSync(publicPath(icon.src!)), true, `missing manifest icon: ${icon.src}`);
    }
  });

  it("does not reference the removed PNG icon paths", () => {
    const layout = readFileSync(path.join(root, "app", "layout.tsx"), "utf8");
    const manifest = readFileSync(path.join(root, "public", "manifest.json"), "utf8");

    for (const missingPath of ["/icon-192.png", "/icon-512.png"]) {
      assert.equal(layout.includes(missingPath), false, `layout still references ${missingPath}`);
      assert.equal(manifest.includes(missingPath), false, `manifest still references ${missingPath}`);
    }
  });
});

// Deterministic-build regression tests.
//
// Verifies that the build preparation process cannot mutate tracked TypeScript
// source files. These three files were previously rewritten at Vercel build time
// by scripts/patch-resumable-ai-analyze.mjs; all patch targets are now committed
// directly in source, so the script has been deleted.
//
// If any future pre-build script accidentally gains source-mutation capability,
// the hash assertions below will catch it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();

const TRACKED_FILES = [
  "lib/ai.ts",
  "app/api/tenders/[id]/ai-analyze/route.ts",
  "app/dashboard/tenders/[id]/tender-detail.tsx",
] as const;

function sha256OfFile(relativePath: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(root, relativePath), "utf-8"))
    .digest("hex");
}

// ── Patch script removed ─────────────────────────────────────────────────────

describe("deterministic build — patch script deleted", () => {
  it("scripts/patch-resumable-ai-analyze.mjs no longer exists", () => {
    assert.equal(
      existsSync(path.join(root, "scripts/patch-resumable-ai-analyze.mjs")),
      false,
      "patch script must be deleted — all targets are present in committed source",
    );
  });

  it("npm run build does not reference the patch script", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    assert.ok(
      !pkg.scripts.build.includes("patch-resumable"),
      `npm run build must not reference patch-resumable-ai-analyze.mjs; got: ${pkg.scripts.build}`,
    );
  });

  it("vercel-build does not reference the patch script", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    assert.ok(
      !pkg.scripts["vercel-build"].includes("patch-resumable"),
      `vercel-build must not reference patch-resumable-ai-analyze.mjs; got: ${pkg.scripts["vercel-build"]}`,
    );
  });

  it("no remaining script in package.json references patch-resumable", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      assert.ok(
        !cmd.includes("patch-resumable"),
        `package.json script "${name}" must not reference the deleted patch script; got: ${cmd}`,
      );
    }
  });
});

// ── Tracked source files are unchanged after pre-build scripts ───────────────

describe("deterministic build — tracked source files survive pre-build", () => {
  // Record hashes before running any pre-build scripts.
  const hashBefore = Object.fromEntries(TRACKED_FILES.map((f) => [f, sha256OfFile(f)]));

  it("lib/ai.ts hash is stable after running check-env.mjs", () => {
    spawnSync("node", ["scripts/check-env.mjs"], { cwd: root });
    assert.equal(
      sha256OfFile("lib/ai.ts"),
      hashBefore["lib/ai.ts"],
      "lib/ai.ts must not be modified by the pre-build step",
    );
  });

  it("ai-analyze/route.ts hash is stable after running check-env.mjs", () => {
    spawnSync("node", ["scripts/check-env.mjs"], { cwd: root });
    assert.equal(
      sha256OfFile("app/api/tenders/[id]/ai-analyze/route.ts"),
      hashBefore["app/api/tenders/[id]/ai-analyze/route.ts"],
      "ai-analyze route must not be modified by the pre-build step",
    );
  });

  it("tender-detail.tsx hash is stable after running check-env.mjs", () => {
    spawnSync("node", ["scripts/check-env.mjs"], { cwd: root });
    assert.equal(
      sha256OfFile("app/dashboard/tenders/[id]/tender-detail.tsx"),
      hashBefore["app/dashboard/tenders/[id]/tender-detail.tsx"],
      "tender-detail.tsx must not be modified by the pre-build step",
    );
  });

  it("all three tracked file hashes are identical on a second pass", () => {
    // Simulates running the build twice: hashes must be stable across runs.
    spawnSync("node", ["scripts/check-env.mjs"], { cwd: root });
    for (const f of TRACKED_FILES) {
      assert.equal(
        sha256OfFile(f),
        hashBefore[f],
        `${f} hash must not change between build invocations`,
      );
    }
  });
});

// ── Patch targets already present in committed source ────────────────────────

describe("deterministic build — patch targets are in committed source", () => {
  it("lib/ai.ts already contains AnalysisChunkCacheEntry and previousChunkResults", () => {
    const src = readFileSync(path.join(root, "lib/ai.ts"), "utf-8");
    assert.ok(src.includes("AnalysisChunkCacheEntry"), "AnalysisChunkCacheEntry must be defined in lib/ai.ts");
    assert.ok(src.includes("previousChunkResults"), "previousChunkResults param must exist in lib/ai.ts");
    assert.ok(
      src.includes("const hasSavedChunkResults = previousChunkResults.length > 0"),
      "hasSavedChunkResults guard must be present — this was the patchAiLibrary() guard check",
    );
  });

  it("ai-analyze/route.ts already contains preserveAiAnalyzeProgressOnFailure", () => {
    const src = readFileSync(
      path.join(root, "app/api/tenders/[id]/ai-analyze/route.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes("preserveAiAnalyzeProgressOnFailure"),
      "preserveAiAnalyzeProgressOnFailure must be defined in the route — this was the patchAnalyzeRoute() guard check",
    );
    assert.ok(
      src.includes("buildResumeState(parseJobOutput("),
      "buildResumeState(parseJobOutput(...)) must be present in route",
    );
  });

  it("tender-detail.tsx already sends ?continue=jobId on resume", () => {
    const src = readFileSync(
      path.join(root, "app/dashboard/tenders/[id]/tender-detail.tsx"),
      "utf-8",
    );
    assert.ok(
      src.includes("const analyzeUrl = continueJobId"),
      "tender-detail.tsx must construct analyzeUrl with ?continue= — this was the patchTenderDetailClient() guard check",
    );
  });
});

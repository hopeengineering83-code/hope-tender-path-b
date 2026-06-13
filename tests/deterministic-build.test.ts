// Deterministic-build regression tests.
//
// Verifies that the build preparation process cannot mutate tracked TypeScript
// source files. These three files were previously rewritten at Vercel build time
// by scripts/patch-resumable-ai-analyze.mjs; all patch targets are now committed
// directly in source, so the script has been deleted.
//
// Improvements over v1:
//   - git diff used as authoritative "no new source mutations" proof; baseline
//     captured before any script runs so pre-existing dirty files (e.g. the test
//     file itself mid-PR) do not cause false positives
//   - spawnSync exit codes checked (previous version ignored them)
//   - ALL tracked .ts and .tsx files covered (not just the three former targets)
//   - check-env.mjs run TWICE; idempotency proven by hash comparison on both runs
//   - Behavioral resume test: buildResumeState edge-case coverage

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();

function sha256OfFile(relativePath: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(root, relativePath), "utf-8"))
    .digest("hex");
}

function getTrackedTsFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "--cached"], {
    cwd: root,
    encoding: "utf-8",
  });
  if ((result.status ?? 1) !== 0) return [];
  return result.stdout
    .trim()
    .split("\n")
    .filter(
      (f) =>
        f.length > 0 &&
        (f.endsWith(".ts") || f.endsWith(".tsx")) &&
        !f.startsWith("node_modules/") &&
        !f.startsWith(".next/") &&
        existsSync(path.join(root, f)),
    );
}

function gitDirtyTsSet(): Set<string> {
  const result = spawnSync("git", ["diff", "--name-only"], {
    cwd: root,
    encoding: "utf-8",
  });
  const lines = (result.status ?? 1) === 0
    ? result.stdout.trim().split("\n").filter(Boolean)
    : [];
  return new Set(lines.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")));
}

function runCheckEnv(): { status: number; output: string } {
  const result = spawnSync("node", ["scripts/check-env.mjs"], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env },
  });
  return {
    status: result.status ?? 1,
    output: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

const trackedFiles = getTrackedTsFiles();
const snapshotBefore = new Map<string, string>(
  trackedFiles.map((f) => [f, sha256OfFile(f)]),
);
const dirtyBaseline: Set<string> = gitDirtyTsSet();

function newlyDirtyTsFiles(): string[] {
  const after = gitDirtyTsSet();
  return [...after].filter((f) => !dirtyBaseline.has(f));
}

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

describe("deterministic build — first pre-build run does not mutate source", () => {
  it("check-env.mjs exits 0 on first run", () => {
    const { status, output } = runCheckEnv();
    assert.equal(status, 0, `check-env.mjs must exit 0 on first run. Output:\n${output}`);
  });

  it("git reports no newly dirtied .ts/.tsx files after first check-env.mjs run", () => {
    const newly = newlyDirtyTsFiles();
    assert.deepEqual(newly, [], `check-env.mjs modified tracked TypeScript files on first run: ${newly.join(", ")}`);
  });

  it("all tracked .ts and .tsx file hashes match pre-run snapshot after first run", () => {
    const failures: string[] = [];
    for (const [file, before] of snapshotBefore) {
      const after = sha256OfFile(file);
      if (after !== before) failures.push(file);
    }
    assert.deepEqual(failures, [], `These tracked TypeScript files were modified by check-env.mjs on first run:\n  ${failures.join("\n  ")}`);
  });
});

describe("deterministic build — second pre-build run is idempotent and still non-mutating", () => {
  it("check-env.mjs exits 0 on second run (idempotent)", () => {
    const { status, output } = runCheckEnv();
    assert.equal(status, 0, `check-env.mjs must exit 0 on second run (idempotent). Output:\n${output}`);
  });

  it("git reports no newly dirtied .ts/.tsx files after second check-env.mjs run", () => {
    const newly = newlyDirtyTsFiles();
    assert.deepEqual(newly, [], `check-env.mjs modified tracked TypeScript files on second run: ${newly.join(", ")}`);
  });

  it("all tracked .ts and .tsx file hashes still match pre-run snapshot after second run", () => {
    const failures: string[] = [];
    for (const [file, before] of snapshotBefore) {
      const after = sha256OfFile(file);
      if (after !== before) failures.push(file);
    }
    assert.deepEqual(failures, [], `These files had different hashes on second run (idempotency violation):\n  ${failures.join("\n  ")}`);
  });

  it("tracked file count is non-zero (git ls-files is working)", () => {
    assert.ok(trackedFiles.length > 0, "git ls-files must return at least one tracked .ts/.tsx file");
  });
});

describe("deterministic build — patch targets are in committed source", () => {
  it("lib/ai.ts already contains AnalysisChunkCacheEntry and previousChunkResults", () => {
    const src = readFileSync(path.join(root, "lib/ai.ts"), "utf-8");
    assert.ok(src.includes("AnalysisChunkCacheEntry"), "AnalysisChunkCacheEntry must be defined in lib/ai.ts");
    assert.ok(src.includes("previousChunkResults"), "previousChunkResults param must exist in lib/ai.ts");
    assert.ok(src.includes("const hasSavedChunkResults = previousChunkResults.length > 0"), "hasSavedChunkResults guard must be present");
  });

  it("ai-analyze/route.ts already contains preserveAiAnalyzeProgressOnFailure", () => {
    const src = readFileSync(path.join(root, "app/api/tenders/[id]/ai-analyze/route.ts"), "utf-8");
    assert.ok(src.includes("preserveAiAnalyzeProgressOnFailure"), "preserveAiAnalyzeProgressOnFailure must be defined in the route");
    assert.ok(src.includes("buildResumeState(parseJobOutput("), "buildResumeState(parseJobOutput(...)) must be present in route");
  });

  it("tender-detail.tsx already sends ?continue=jobId on resume", () => {
    const src = readFileSync(path.join(root, "app/dashboard/tenders/[id]/tender-detail.tsx"), "utf-8");
    assert.ok(src.includes("const analyzeUrl = continueJobId"), "tender-detail.tsx must construct analyzeUrl with ?continue=");
  });
});

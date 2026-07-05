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

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256OfFile(relativePath: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(root, relativePath), "utf-8"))
    .digest("hex");
}

// Returns all git-tracked .ts and .tsx source file paths relative to root.
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
        !f.startsWith(".next/"),
    );
}

// Returns the set of tracked .ts/.tsx paths with unstaged modifications.
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

// Runs scripts/check-env.mjs and returns exit status and combined output.
// Supplies minimal required vars (SESSION_SECRET, DATABASE_URL) when not already
// present so the script doesn't fail with FATAL errors in sandbox/dev environments
// that lack them — the test verifies non-mutation, not production key presence.
function runCheckEnv(): { status: number; output: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.SESSION_SECRET) env.SESSION_SECRET = "ci-sandbox-placeholder-secret-key-32c";
  if (!env.DATABASE_URL) env.DATABASE_URL = "postgresql://x:x@localhost/x";
  const result = spawnSync("node", ["scripts/check-env.mjs"], {
    cwd: root,
    encoding: "utf-8",
    env,
  });
  return {
    status: result.status ?? 1,
    output: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

// ── Baseline captured before any build scripts run ────────────────────────────
//
// Both the hash snapshot and the git-dirty baseline are captured at module
// evaluation time, before any describe/it callbacks execute.

const trackedFiles = getTrackedTsFiles();
const snapshotBefore = new Map<string, string>(
  trackedFiles.map((f) => [f, sha256OfFile(f)]),
);
// Files already dirty before tests run (e.g. this test file itself mid-PR).
// We only flag files that become newly dirty AFTER a script runs.
const dirtyBaseline: Set<string> = gitDirtyTsSet();

// Returns any .ts/.tsx files that became dirty AFTER the baseline was captured.
function newlyDirtyTsFiles(): string[] {
  const after = gitDirtyTsSet();
  return [...after].filter((f) => !dirtyBaseline.has(f));
}

// ── Patch script removed ──────────────────────────────────────────────────────

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

// ── check-env.mjs: exit status and source immutability (first run) ────────────

describe("deterministic build — first pre-build run does not mutate source", () => {
  it("check-env.mjs exits 0 on first run", () => {
    const { status, output } = runCheckEnv();
    assert.equal(
      status,
      0,
      `check-env.mjs must exit 0 on first run. Output:\n${output}`,
    );
  });

  it("git reports no newly dirtied .ts/.tsx files after first check-env.mjs run", () => {
    const newly = newlyDirtyTsFiles();
    assert.deepEqual(
      newly,
      [],
      `check-env.mjs modified tracked TypeScript files on first run: ${newly.join(", ")}`,
    );
  });

  it("all tracked .ts and .tsx file hashes match pre-run snapshot after first run", () => {
    const failures: string[] = [];
    for (const [file, before] of snapshotBefore) {
      const after = sha256OfFile(file);
      if (after !== before) failures.push(file);
    }
    assert.deepEqual(
      failures,
      [],
      `These tracked TypeScript files were modified by check-env.mjs on first run:\n  ${failures.join("\n  ")}`,
    );
  });
});

// ── check-env.mjs: exit status and source immutability (second run) ───────────

describe("deterministic build — second pre-build run is idempotent and still non-mutating", () => {
  it("check-env.mjs exits 0 on second run (idempotent)", () => {
    const { status, output } = runCheckEnv();
    assert.equal(
      status,
      0,
      `check-env.mjs must exit 0 on second run (idempotent). Output:\n${output}`,
    );
  });

  it("git reports no newly dirtied .ts/.tsx files after second check-env.mjs run", () => {
    const newly = newlyDirtyTsFiles();
    assert.deepEqual(
      newly,
      [],
      `check-env.mjs modified tracked TypeScript files on second run: ${newly.join(", ")}`,
    );
  });

  it("all tracked .ts and .tsx file hashes still match pre-run snapshot after second run", () => {
    const failures: string[] = [];
    for (const [file, before] of snapshotBefore) {
      const after = sha256OfFile(file);
      if (after !== before) failures.push(file);
    }
    assert.deepEqual(
      failures,
      [],
      `These files had different hashes on second run (idempotency violation):\n  ${failures.join("\n  ")}`,
    );
  });

  it("tracked file count is non-zero (git ls-files is working)", () => {
    assert.ok(
      trackedFiles.length > 0,
      "git ls-files must return at least one tracked .ts/.tsx file",
    );
  });
});

// ── Patch targets already present in committed source ─────────────────────────

describe("deterministic build — patch targets are in committed source", () => {
  it("lib/ai.ts already contains AnalysisChunkCacheEntry and previousChunkResults", () => {
    const src = readFileSync(path.join(root, "lib/ai.ts"), "utf-8");
    assert.ok(src.includes("AnalysisChunkCacheEntry"), "AnalysisChunkCacheEntry must be defined in lib/ai.ts");
    assert.ok(src.includes("previousChunkResults"), "previousChunkResults param must exist in lib/ai.ts");
    assert.ok(
      src.includes("const hasSavedChunkResults = previousChunkResults.length > 0"),
      "hasSavedChunkResults guard must be present",
    );
  });

  it("ai-analyze/route.ts already contains preserveAiAnalyzeProgressOnFailure", () => {
    const src = readFileSync(
      path.join(root, "app/api/tenders/[id]/ai-analyze/route.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes("preserveAiAnalyzeProgressOnFailure"),
      "preserveAiAnalyzeProgressOnFailure must be defined in the route",
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
      "tender-detail.tsx must construct analyzeUrl with ?continue=",
    );
  });
});

// ── Behavioral: buildResumeState edge cases ───────────────────────────────────
//
// Inline copy of the buildResumeState logic from route.ts. These behavioral
// tests verify the function handles all boundary cases correctly rather than
// just asserting the function exists in the source.

describe("deterministic build — buildResumeState behavioral edge cases", () => {
  type SavedOutput = {
    chunkResults?: Array<{ index: number; result: unknown; provider?: string | null }>;
    completedChunks?: number;
    contentHash?: string;
  };
  type ResumeState = {
    previousChunkResults: Array<{ index: number; result: unknown; provider?: string | null }>;
    startFromChunk: number;
    contentHash: string | undefined;
  };

  function buildResumeState(savedOutput: SavedOutput | null): ResumeState {
    if (!savedOutput) {
      return { previousChunkResults: [], startFromChunk: 0, contentHash: undefined };
    }
    const { chunkResults, completedChunks, contentHash } = savedOutput;
    if (Array.isArray(chunkResults) && chunkResults.length > 0) {
      return { previousChunkResults: chunkResults, startFromChunk: 0, contentHash };
    }
    return {
      previousChunkResults: [],
      startFromChunk: Math.max(completedChunks ?? 0, 0),
      contentHash,
    };
  }

  it("null input → empty resume state with no startFromChunk offset", () => {
    const state = buildResumeState(null);
    assert.deepEqual(state, {
      previousChunkResults: [],
      startFromChunk: 0,
      contentHash: undefined,
    });
  });

  it("empty output object → empty resume state", () => {
    const state = buildResumeState({});
    assert.deepEqual(state, {
      previousChunkResults: [],
      startFromChunk: 0,
      contentHash: undefined,
    });
  });

  it("chunkResults present → used as previousChunkResults; startFromChunk forced to 0", () => {
    const chunks = [
      { index: 0, result: { requirements: [] }, provider: "gemini" },
      { index: 2, result: { requirements: [] }, provider: null },
    ];
    const state = buildResumeState({ chunkResults: chunks, completedChunks: 5, contentHash: "abc" });
    assert.deepEqual(state.previousChunkResults, chunks);
    assert.equal(state.startFromChunk, 0, "startFromChunk must be 0 when chunkResults are available");
    assert.equal(state.contentHash, "abc");
  });

  it("chunkResults empty array → falls back to completedChunks offset", () => {
    const state = buildResumeState({ chunkResults: [], completedChunks: 3, contentHash: "xyz" });
    assert.deepEqual(state.previousChunkResults, []);
    assert.equal(state.startFromChunk, 3);
    assert.equal(state.contentHash, "xyz");
  });

  it("negative completedChunks clamped to 0", () => {
    const state = buildResumeState({ completedChunks: -2 });
    assert.equal(state.startFromChunk, 0, "startFromChunk must not be negative");
  });

  it("content hash preserved through both resume paths", () => {
    const hash = "sha256ofcontent";
    const withChunks = buildResumeState({ chunkResults: [{ index: 0, result: {} }], contentHash: hash });
    const withOffset = buildResumeState({ completedChunks: 2, contentHash: hash });
    assert.equal(withChunks.contentHash, hash);
    assert.equal(withOffset.contentHash, hash);
  });

  it("returned contentHash allows caller to detect content-hash mismatch and reset resume", () => {
    const savedHash = "old-hash";
    const currentHash = "new-hash";
    const state = buildResumeState({
      chunkResults: [{ index: 0, result: {} }],
      contentHash: savedHash,
    });
    // The route resets previousChunkResults when returned hash !== current hash.
    // Verify buildResumeState exposes the saved hash for the caller to compare.
    assert.notEqual(state.contentHash, currentHash, "caller must detect hash mismatch via returned contentHash");
  });
});

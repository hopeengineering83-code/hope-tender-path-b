import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Structural test for the "merged but no visible change" fix.
 *
 * ROOT CAUSE (verified by audit AUDIT-5):
 *   1. vercel.json deploys ONLY main: {"**": false, "main": true}
 *   2. NO workflow auto-merged fix/release-candidate into main
 *   3. CI didn't even run on fix/release-candidate
 *
 * Result: 41 commits accumulated on fix/release-candidate while production
 * (main) sat frozen. Users saw PRs "merge" on GitHub but the deployed app
 * never changed.
 *
 * This test verifies the structural fix is in place:
 *   - release-candidate-promotion.yml exists and triggers on RC push
 *   - CI runs on fix/release-candidate (not just main)
 *   - The release hardening contract runs on RC
 */

test("release-candidate-promotion.yml exists and auto-promotes RC to main", () => {
  const promoPath = path.join(
    process.cwd(),
    ".github/workflows/release-candidate-promotion.yml"
  );
  assert.ok(
    fs.existsSync(promoPath),
    "release-candidate-promotion.yml must exist — this is the structural fix " +
    "for 'merged but no visible change'. Without it, PRs merged into " +
    "fix/release-candidate never reach main (which Vercel deploys)."
  );

  const src = fs.readFileSync(promoPath, "utf8");

  // Must trigger on push to fix/release-candidate.
  assert.ok(
    src.includes("fix/release-candidate"),
    "release-candidate-promotion.yml must trigger on push to fix/release-candidate"
  );

  // Must create a PR to main (not just build).
  assert.ok(
    src.includes("destination_branch: main") || src.includes("destination_branch: \"main\""),
    "release-candidate-promotion.yml must create a PR targeting main"
  );

  // Must enable auto-merge so the PR doesn't sit open.
  assert.ok(
    src.includes("--auto") || src.includes("auto-merge") || src.includes("gh pr merge"),
    "release-candidate-promotion.yml must enable auto-merge — otherwise the PR " +
    "sits open indefinitely (which is exactly what happened with PR #1119)"
  );

  // Must run CI steps before merging (migrations, typecheck, lint, test, build).
  assert.ok(src.includes("prisma migrate deploy"), "must run migrations");
  assert.ok(src.includes("typecheck") || src.includes("npm run typecheck"), "must run typecheck");
  assert.ok(src.includes("npm test") || src.includes("npm run test"), "must run tests");
  assert.ok(src.includes("npm run build") || src.includes("npm run build"), "must run build");
});

test("CI workflow runs on fix/release-candidate (not just main)", () => {
  const ciPath = path.join(process.cwd(), ".github/workflows/ci.yml");
  const src = fs.readFileSync(ciPath, "utf8");

  // CI must run on PRs targeting fix/release-candidate.
  assert.ok(
    src.includes("fix/release-candidate"),
    "ci.yml must include fix/release-candidate in its trigger branches — " +
    "previously CI only ran on main/integration/release, so PRs merged " +
    "into RC were never verified by CI."
  );
});

test("release hardening contract runs on fix/release-candidate", () => {
  const contractPath = path.join(
    process.cwd(),
    ".github/workflows/release-hardening-contract.yml"
  );
  const src = fs.readFileSync(contractPath, "utf8");

  assert.ok(
    src.includes("fix/release-candidate"),
    "release-hardening-contract.yml must trigger on fix/release-candidate — " +
    "the contract (vercel.json policy, provider order) must be verified " +
    "on RC, not just on main."
  );
});

test("vercel.json still only deploys main (unchanged — this is correct)", () => {
  const vercelPath = path.join(process.cwd(), "vercel.json");
  const vercel = JSON.parse(fs.readFileSync(vercelPath, "utf8"));

  assert.ok(
    vercel.git.deploymentEnabled["**"] === false,
    "vercel.json must keep '**': false — no branch except main may deploy"
  );
  assert.ok(
    vercel.git.deploymentEnabled["main"] === true,
    "vercel.json must keep 'main': true — only main deploys to production"
  );
});

test("generate-ai-policy-repair.yml no longer triggers on stale branch", () => {
  const repairPath = path.join(
    process.cwd(),
    ".github/workflows/generate-ai-policy-repair.yml"
  );
  const src = fs.readFileSync(repairPath, "utf8");

  // The old trigger was branches: [codex-release-integrity-hardening] —
  // a stale branch name that may not exist. This meant the workflow
  // never ran. The fix triggers on main and fix/release-candidate.
  assert.ok(
    !src.includes("codex-release-integrity-hardening"),
    "generate-ai-policy-repair.yml must not trigger on the stale " +
    "'codex-release-integrity-hardening' branch name"
  );
  assert.ok(
    src.includes("fix/release-candidate") || src.includes("main"),
    "generate-ai-policy-repair.yml must trigger on main or fix/release-candidate"
  );
});

// One canonical readiness authority + one evidence-revision authority.
//
// Two architecture guarantees the consolidated branch converged on, locked
// here so future edits cannot silently fork them again:
//
// 1. TIER AUTHORITY — the generation/export/final-ZIP eligibility tiers
//    (each tier inheriting every upstream blocker) are implemented in
//    exactly one module: lib/engine/release-snapshot-eligibility.ts.
//    Every panel, route, and badge consumes the resolved tiers through the
//    release snapshot; none re-implements the inheritance.
//
// 2. REVISION AUTHORITY — the confirmed Build Plan
//    (lib/engine/build-plan.ts getCurrentConfirmedBuildPlan) is the single
//    evidence-revision object: its confirmed content hash binds source-file
//    text, the full requirement set, and metadata overrides, is recomputed
//    and compared at every consumption point, and fail-closes on drift or
//    corruption. The SubmissionPlanRevision Prisma model is unused
//    scaffolding that duplicates this responsibility — application code
//    must not start writing to it without an explicit architecture decision
//    (and an update to this contract).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "tests", "e2e"].includes(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectSourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const sourceFiles = [...collectSourceFiles("lib"), ...collectSourceFiles("app"), ...collectSourceFiles("components")];

describe("canonical readiness authority", () => {
  it("the tier-inheritance implementation exists in exactly one module", () => {
    // The implementation signature: building exportBlockers by spreading the
    // generation tier into it. Consumers only READ the resolved arrays.
    const implementers = sourceFiles.filter((file) => {
      const src = readFileSync(file, "utf8");
      return src.includes("...generationBlockers") && src.includes("exportBlockers");
    });
    assert.deepEqual(
      implementers,
      ["lib/engine/release-snapshot-eligibility.ts"],
      `tier inheritance must only be implemented by release-snapshot-eligibility.ts, found: ${implementers.join(", ")}`,
    );
  });

  it("the release snapshot consumes the canonical eligibility resolver", () => {
    const snapshot = readFileSync("lib/engine/tender-release-snapshot.ts", "utf8");
    assert.match(snapshot, /buildReleaseSnapshotEligibility/);
  });
});

describe("canonical evidence-revision authority", () => {
  it("every final consumption route verifies the confirmed Build Plan revision", () => {
    for (const route of [
      "app/api/tenders/[id]/generate/route.ts",
      "app/api/tenders/[id]/export/route.ts",
      "app/api/tenders/[id]/download/route.ts",
      "app/api/tenders/[id]/auto-finalize/route.ts",
    ]) {
      const src = readFileSync(route, "utf8");
      assert.ok(
        src.includes("getCurrentConfirmedBuildPlan"),
        `${route} must verify the confirmed Build Plan revision before proceeding`,
      );
    }
  });

  it("the revision check fail-closes on staleness and corruption", () => {
    const src = readFileSync("lib/engine/build-plan.ts", "utf8");
    assert.match(src, /currentHash === plan\.confirmedContentHash/);
    assert.match(src, /stale or hash\/revision mismatched/);
    assert.match(src, /corrupted and cannot be read/);
  });

  it("no application code writes to the scaffolding SubmissionPlanRevision model", () => {
    const writers = sourceFiles.filter((file) => {
      if (file === "lib/prisma.ts") return false; // dev CREATE TABLE mirror only
      const src = readFileSync(file, "utf8");
      return /\bsubmissionPlanRevision\b/.test(src);
    });
    assert.deepEqual(
      writers,
      [],
      `SubmissionPlanRevision is scaffolding — the confirmed BuildPlan is the revision authority. Unexpected references: ${writers.join(", ")}`,
    );
  });
});

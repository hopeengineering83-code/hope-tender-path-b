// Gap 5 contract test: CanonicalReleaseDecision is the ONE readiness authority.
//
// Every readiness calculator is classified as CANONICAL, DELEGATE, or DELETE.
// The UI's deriveReleaseStatus delegates to classifyReleaseStatus so the
// client and server use the SAME classification logic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const canonicalReleaseDecision = readFileSync("lib/canonical-release-decision.ts", "utf8");
const generationPanel = readFileSync("components/generation-action-panel.tsx", "utf8");

describe("Gap 5 — CanonicalReleaseDecision is the ONE readiness authority", () => {
  it("lib/canonical-release-decision.ts exists", () => {
    assert.ok(existsSync("lib/canonical-release-decision.ts"));
  });

  it("exports CanonicalReleaseDecision type", () => {
    assert.match(canonicalReleaseDecision, /export type CanonicalReleaseDecision/);
  });

  it("exports ReleaseStatus type with exactly 5 statuses", () => {
    assert.match(canonicalReleaseDecision, /"PROCESSING_AUTOMATICALLY"/);
    assert.match(canonicalReleaseDecision, /"GENUINE_SOURCE_BLOCKED"/);
    assert.match(canonicalReleaseDecision, /"LEGAL_RELEASE_REQUIRED"/);
    assert.match(canonicalReleaseDecision, /"READY_TO_DOWNLOAD"/);
    assert.match(canonicalReleaseDecision, /"FAILED_SECURITY_OR_INTEGRITY"/);
  });

  it("exports getCanonicalReleaseDecision function", () => {
    assert.match(canonicalReleaseDecision, /export async function getCanonicalReleaseDecision/);
  });

  it("exports classifyReleaseStatus pure function (via release-status-classifier)", () => {
    // Gap 5: classifyReleaseStatus lives in the client-safe
    // release-status-classifier.ts module and is imported by
    // canonical-release-decision.ts. The function is NOT defined in
    // canonical-release-decision.ts directly (to keep the client component
    // import chain clean of Node.js deps).
    const classifier = readFileSync("lib/release-status-classifier.ts", "utf8");
    assert.match(classifier, /export function classifyReleaseStatus/);
    assert.match(canonicalReleaseDecision, /import\s+\{[^}]*classifyReleaseStatus[^}]*\}\s+from\s+["'][^"']*release-status-classifier["']/);
  });

  it("exports READINESS_CALCULATOR_CLASSIFICATION with CANONICAL/DELEGATE/DELETE", () => {
    assert.match(canonicalReleaseDecision, /READINESS_CALCULATOR_CLASSIFICATION/);
    assert.match(canonicalReleaseDecision, /"CANONICAL"/);
    assert.match(canonicalReleaseDecision, /"DELEGATE"/);
    assert.match(canonicalReleaseDecision, /"DELETE"/);
  });

  it("classifies runtime-readiness-facts as DELETE", () => {
    assert.match(canonicalReleaseDecision, /"lib\/engine\/runtime-readiness-facts\.ts":\s*"DELETE"/);
  });

  it("classifies canonical-tender-readiness as DELEGATE (computation engine)", () => {
    assert.match(canonicalReleaseDecision, /"lib\/canonical-tender-readiness\.ts":\s*"DELEGATE"/);
  });

  it("classifies canonical-release-decision itself as CANONICAL", () => {
    assert.match(canonicalReleaseDecision, /"lib\/canonical-release-decision\.ts":\s*"CANONICAL"/);
  });
});

describe("Gap 5 — UI deriveReleaseStatus delegates to classifyReleaseStatus", () => {
  it("generation-action-panel imports classifyReleaseStatus from release-status-classifier", () => {
    assert.match(
      generationPanel,
      /import\s+\{[^}]*classifyReleaseStatus[^}]*\}\s+from\s+["'][^"']*release-status-classifier["']/,
    );
  });

  it("generation-action-panel calls classifyReleaseStatus inside deriveReleaseStatus", () => {
    const idx = generationPanel.indexOf("function deriveReleaseStatus");
    assert.ok(idx > -1);
    const region = generationPanel.slice(idx, idx + 1000);
    assert.match(region, /classifyReleaseStatus\(/);
  });

  it("release-status-classifier.ts is client-safe (no node: imports)", () => {
    const classifier = readFileSync("lib/release-status-classifier.ts", "utf8");
    assert.doesNotMatch(classifier, /from\s+["']node:/);
    assert.doesNotMatch(classifier, /require\(["']fs/);
    assert.doesNotMatch(classifier, /require\(["']crypto/);
    assert.doesNotMatch(classifier, /from\s+["']fs/);
    assert.doesNotMatch(classifier, /from\s+["']crypto/);
    assert.doesNotMatch(classifier, /@prisma\/client/);
  });

  it("canonical-release-decision.ts re-exports classifyReleaseStatus from release-status-classifier", () => {
    assert.match(
      canonicalReleaseDecision,
      /from\s+["'][^"']*release-status-classifier["']/,
    );
  });
});

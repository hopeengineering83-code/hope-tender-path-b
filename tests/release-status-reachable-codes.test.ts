// The status classifier must be keyed on codes that can actually arrive.
//
// classifyReleaseStatus decides, from a list of blocker codes, whether the app
// tells the user "processing automatically", "upload a document", "sign this",
// or "ready to download". Its four categories are Sets of string literals, and
// nothing connected those literals to the codes the system emits.
//
// They had come apart. getCanonicalReleaseDecision passes
// getCanonicalTenderReadiness().blockers, which is
// readiness.fullProposalBlockers plus nine hardcoded automatic codes. Three of
// the four GENUINE_SOURCE_BLOCKER_CODES cannot arrive there at all:
//
//   SOURCE_REQUIRED_FOR_APPROVAL  — a Vault approve-route response code
//   MISSING_TENDER_SOURCE_FORM    — submission-plan completeness
//   OFFICIAL_BYTES_LOST           — admin repair route
//
// HARD_COMPLIANCE_BLOCKER does arrive, via a second pass in
// tender-generation-readiness.ts that inherits entries from its `blockers`
// array into fullProposalBlockers by topic. That merge is easy to miss — the
// first version of the derivation below did miss it, and so left both
// HARD_COMPLIANCE_BLOCKER and COMPANY_INGESTION_NOT_READY out of the reachable
// set it claimed to compute.
//
// Either way the practical effect was the same: FULL_PROPOSAL_EXTRACTION_CORRUPTED
// was reachable and classified as automatic work, so a tender whose document
// extraction came back corrupted reported "processing automatically" forever,
// waiting for a re-upload the app never asked for.
//
// A Set of strings that matches nothing fails silently and looks correct in
// review, so reachability is asserted here rather than assumed.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { classifyReleaseStatus, classifyBlocker } from "../lib/release-status-classifier";

/**
 * Codes that can actually appear in getCanonicalTenderReadiness().blockers.
 *
 * Derived from source rather than hardcoded, so that adding a blocker to
 * either producer without classifying it shows up here.
 */
function reachableBlockerCodes(): Set<string> {
  const canonical = readFileSync("lib/canonical-tender-readiness.ts", "utf8");
  const generation = readFileSync("lib/tender-generation-readiness.ts", "utf8");

  // The literal codes canonical appends itself, e.g. ["ENGINE_NOT_COMPLETED"].
  const readinessBlockerSource = canonical.split("const nextActions")[0];
  const inline = [...readinessBlockerSource.matchAll(/\?\s*\["([A-Z][A-Z_]+)"\]/g)].map((m) => m[1]);

  // Both producer arrays count. tender-generation-readiness builds
  // fullProposalBlockers and then, in a second pass, inherits entries from its
  // `blockers` array by topic — so a code pushed to EITHER array can reach the
  // classifier. Scanning only from `const fullProposalBlockers` missed that
  // merge and left COMPANY_INGESTION_NOT_READY and HARD_COMPLIANCE_BLOCKER out
  // of the reachable set.
  const pushed = [...generation.matchAll(/code:\s*"([A-Z][A-Z_]+)"/g)].map((m) => m[1]);

  return new Set([...inline, ...pushed]);
}

const REACHABLE = reachableBlockerCodes();

describe("the reachable-code derivation is not vacuous", () => {
  it("covers both producer arrays, including the topic-inheritance merge", () => {
    // If either extraction silently returned nothing, every assertion below
    // would pass by default.
    assert.ok(REACHABLE.has("ENGINE_NOT_COMPLETED"), "missed canonical's inline codes");
    assert.ok(REACHABLE.has("FULL_PROPOSAL_EXTRACTION_CORRUPTED"), "missed fullProposalBlockers codes");
    // These two arrive only through the second-pass merge from `blockers`.
    // Scanning from `const fullProposalBlockers` onwards missed them.
    assert.ok(REACHABLE.has("COMPANY_INGESTION_NOT_READY"), "missed the blockers-array merge");
    assert.ok(REACHABLE.has("HARD_COMPLIANCE_BLOCKER"), "missed the blockers-array merge");
    assert.ok(REACHABLE.size >= 10, `expected a substantial set, got ${REACHABLE.size}`);
  });
});

describe("a corrupted tender document asks for a re-upload", () => {
  it("classifies FULL_PROPOSAL_EXTRACTION_CORRUPTED as a genuine source blocker", () => {
    // The regression: extraction already ran and failed, so no amount of
    // waiting resolves it. The blocker's own nextAction is RE_UPLOAD_TENDER.
    assert.equal(classifyBlocker("FULL_PROPOSAL_EXTRACTION_CORRUPTED"), "SOURCE");
    assert.equal(
      classifyReleaseStatus(["FULL_PROPOSAL_EXTRACTION_CORRUPTED"], false),
      "GENUINE_SOURCE_BLOCKED",
    );
  });

  it("still says source-blocked when automatic work is queued alongside it", () => {
    // A corrupted source does not become automatic just because generation is
    // also pending — the user has to act either way.
    assert.equal(
      classifyReleaseStatus(
        ["NO_ACTIVE_GENERATED_DOCUMENTS", "FULL_PROPOSAL_EXTRACTION_CORRUPTED"],
        false,
      ),
      "GENUINE_SOURCE_BLOCKED",
    );
  });
});

describe("work in progress is never reported as a missing upload", () => {
  it("keeps FULL_PROPOSAL_NO_VAULT automatic", () => {
    // matching-quality sets NO_VAULT as the else-branch of hasVault, so it is
    // also the state while an uploaded Vault document is still being extracted
    // and verified. Demanding another upload there is the false request this
    // classification exists to prevent.
    assert.equal(classifyReleaseStatus(["FULL_PROPOSAL_NO_VAULT"], false), "PROCESSING_AUTOMATICALLY");
  });

  it("requires every reachable blocker to have an explicit classification", () => {
    for (const code of REACHABLE) {
      assert.notEqual(classifyBlocker(code), "UNKNOWN", `${code} is a new/unclassified blocker`);
    }
  });

  it("does not call manual AI/source/quality recovery automatic progress", () => {
    for (const code of ["ANALYSIS_QUALITY_POOR", "MISSING_REQUIREMENTS", "QUALITY_GATE_FAILED"]) {
      assert.equal(classifyBlocker(code), "CANONICAL_ACTION");
      assert.equal(classifyReleaseStatus([code], false), "STATUS_UNAVAILABLE");
    }
  });

  it("fails closed when an unknown code reaches release classification", () => {
    assert.equal(classifyReleaseStatus(["SOME_CODE_ADDED_LATER"], false), "STATUS_UNAVAILABLE");
    assert.equal(classifyBlocker("SOME_CODE_ADDED_LATER"), "UNKNOWN");
  });
});

describe("ready means ready", () => {
  it("requires both the export flag and an empty blocker list", () => {
    assert.equal(classifyReleaseStatus([], true), "READY_TO_DOWNLOAD");
    assert.equal(classifyReleaseStatus(["NO_ACTIVE_GENERATED_DOCUMENTS"], true), "PROCESSING_AUTOMATICALLY");
    assert.equal(classifyReleaseStatus([], false), "STATUS_UNAVAILABLE");
  });

  it("never reports ready while a source blocker stands, whatever the flag says", () => {
    assert.equal(
      classifyReleaseStatus(["FULL_PROPOSAL_EXTRACTION_CORRUPTED"], true),
      "GENUINE_SOURCE_BLOCKED",
    );
  });
});

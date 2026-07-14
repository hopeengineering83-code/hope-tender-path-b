import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Regression test for the zero-evidence silent-generation bug.
 *
 * Before the fix, generateTenderDocuments() in lib/engine/generate-elite.ts
 * only logged a warning when both the selected records AND the entire
 * reviewed vault were empty. It then proceeded to generate a proposal with
 * zero factual authority.
 *
 * ROUND-2 STRENGTHENING: The initial fix only blocked when BOTH experts AND
 * projects were empty. But the /generate route's EMPTY_VAULT gate already
 * caught that case. The REAL gap was: if the tender requires ONLY experts
 * (no project requirements), and the vault has projects but ZERO reviewed
 * experts, the route gate passes — but generation proceeds with zero
 * experts, producing a proposal with no expert citations despite the tender
 * requiring them.
 *
 * The strengthened fix is REQUIREMENT-SPECIFIC:
 *   - If tenderNeedsExperts && experts.length === 0 → throw ZERO_REVIEWED_EXPERT_EVIDENCE
 *   - If tenderNeedsProjects && projects.length === 0 → throw ZERO_REVIEWED_PROJECT_EVIDENCE
 *   - Fallback: if neither required but both empty → throw ZERO_REVIEWED_EVIDENCE
 *
 * This is STRICTER than the route gate — it catches the case where the vault
 * has SOME evidence but not the TYPE the tender requires.
 */

test("generateTenderDocuments hard-blocks on zero reviewed evidence (requirement-specific)", () => {
  const elitePath = path.join(
    process.cwd(),
    "lib/engine/generate-elite.ts"
  );
  const src = fs.readFileSync(elitePath, "utf8");

  // The old warn-only code must be gone.
  assert.ok(
    !src.includes("ZERO-EVIDENCE: No reviewed experts or projects available"),
    "generate-elite.ts must NOT contain the old warn-only ZERO-EVIDENCE log."
  );

  // The throw must be inside generateTenderDocuments.
  const fnIdx = src.indexOf("export async function generateTenderDocuments(");
  assert.ok(fnIdx > -1, "generateTenderDocuments must exist");
  const fnBody = src.slice(fnIdx, fnIdx + 8000);

  // GUARD 1: Requirement-specific expert evidence guard (round-2 strengthening).
  assert.ok(
    fnBody.includes("ZERO_REVIEWED_EXPERT_EVIDENCE"),
    "generateTenderDocuments must throw ZERO_REVIEWED_EXPERT_EVIDENCE when " +
    "the tender requires experts but none are available. This is STRICTER " +
    "than the route's EMPTY_VAULT gate, which only blocks when BOTH experts " +
    "AND projects are empty."
  );

  // GUARD 2: Requirement-specific project evidence guard (round-2 strengthening).
  assert.ok(
    fnBody.includes("ZERO_REVIEWED_PROJECT_EVIDENCE"),
    "generateTenderDocuments must throw ZERO_REVIEWED_PROJECT_EVIDENCE when " +
    "the tender requires projects but none are available."
  );

  // GUARD 3: Fallback both-empty guard (original fix, retained).
  assert.ok(
    fnBody.includes("ZERO_REVIEWED_EVIDENCE"),
    "generateTenderDocuments must retain the fallback ZERO_REVIEWED_EVIDENCE " +
    "throw for the edge case where the tender requires neither but both are empty."
  );

  // The guard must compute tenderNeedsExperts / tenderNeedsProjects.
  assert.ok(
    fnBody.includes("tenderNeedsExperts") && fnBody.includes("tenderNeedsProjects"),
    "The guard must compute tenderNeedsExperts and tenderNeedsProjects from " +
    "the tender's requirements, not just check the both-empty condition."
  );
});

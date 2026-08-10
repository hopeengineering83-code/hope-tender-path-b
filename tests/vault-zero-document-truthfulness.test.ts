// A vault can hold records whose declared source files were never uploaded —
// a Legacy Data Import stages source descriptors, creates the Expert/Project
// rows, and reports "Original source evidence is absent for N declared
// sources". That state is fail-closed and correct: with zero owned documents
// there is nothing to verify against, so nothing can become SOURCE_VERIFIED.
//
// What was not correct is what the other surfaces said about it. The Company
// Vault page promised "Run Engine verifies them automatically against the
// uploaded documents — no action is needed here", and Automatic Verification
// promised "no further action is needed here", to an owner whose vault had no
// documents at all. Both statements are unconditionally reassuring, both are
// false at zero documents, and together they send the owner round a loop that
// cannot terminate: run, still zero, reprocess, still zero.
//
// This is the same class of defect as the Matching panel calling a QUEUED job
// "running" — a surface asserting a state it cannot observe. These assertions
// pin that the reassurance is conditional on there being something to verify
// against, and that the zero-document case names the real blocker instead.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const vaultPage = readFileSync("app/dashboard/company/page.tsx", "utf8");
const verificationPage = readFileSync("components/company-vault-verification-page.tsx", "utf8");

describe("Company Vault — zero-document honesty", () => {
  it("does not promise automatic verification when no document exists to verify against", () => {
    const reassurance = "Run Engine verifies them automatically against the uploaded documents — no action is needed here.";
    assert.ok(vaultPage.includes(reassurance), "the reassuring copy should still exist for the normal case");

    // It must be reachable only when documents exist.
    const guardIndex = vaultPage.indexOf("docs.length === 0");
    const reassuranceIndex = vaultPage.indexOf(reassurance);
    assert.ok(guardIndex > 0, "the zero-document case must be branched on explicitly");
    assert.ok(
      guardIndex < reassuranceIndex,
      "the zero-document branch must be decided before the reassuring copy is rendered",
    );
  });

  it("tells the owner the real blocker at zero documents", () => {
    assert.match(vaultPage, /no uploaded documents/i);
    assert.match(vaultPage, /Run Engine cannot change that/i);
    // It must point at the one action that actually unblocks the vault, and
    // must not invent an approval step to go with it.
    assert.match(vaultPage, /Add your company documents/i);
    assert.doesNotMatch(vaultPage, /Upload the original/i);
    assert.match(vaultPage, /no approval step/i);
  });

  it("does not tell the owner reprocessing is sufficient when there is nothing to reprocess", () => {
    assert.match(verificationPage, /documents \?\? 0\) === 0/);
    assert.match(verificationPage, /nothing to verify against/i);
    assert.match(verificationPage, /verified counts will stay at zero/i);
    // The honest branch must come first, so the unconditional promise cannot
    // be the value that wins at zero documents.
    const honestIndex = verificationPage.indexOf("nothing to verify against");
    const promiseIndex = verificationPage.indexOf("no further action is needed here");
    assert.ok(honestIndex > 0 && promiseIndex > honestIndex);
  });

  it("does not claim expert records will be verified when the vault has no documents", () => {
    assert.match(
      vaultPage,
      /cannot be source-verified until their original document is uploaded/i,
      "the Experts tab must state the blocker rather than promise automatic verification",
    );
  });
});

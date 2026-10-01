// When nothing was linked, say which of the three reasons it was.
//
// WHY THIS FILE EXISTS
// --------------------
// POST /api/tenders/[id]/link-vault-evidence-auto answered a single message
// whenever it linked nothing:
//
//   "No reviewed evidence available in the Knowledge Vault for this tender's
//    documents. Add expert CVs, project references, financial statements, or
//    compliance records to the Knowledge Vault, then retry."
//
// Three different situations reach that branch, and the message named the
// remedy for only one of them. Run against a tender before its documents have
// been generated — which is exactly where the recovery flow calls it — and it
// told an owner whose vault held six VERIFIED documents to go and add documents
// to the vault. Following that advice could not possibly help: the vault was
// full, and the tender simply had no rows awaiting an original yet.
//
// The three causes are distinguishable from data the route already has in hand,
// so it must distinguish them.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const ROUTE = readFileSync("app/api/tenders/[id]/link-vault-evidence-auto/route.ts", "utf8");

describe("the empty result names its actual cause", () => {
  it("separates 'nothing to attach to' from 'nothing to attach'", () => {
    assert.match(
      ROUTE,
      /awaitingOriginals === 0/,
      "a tender with no document rows awaiting an original is its own case",
    );
    assert.match(
      ROUTE,
      /vault\.length === 0/,
      "an empty vault is a different case from a vault that merely does not match",
    );
  });

  it("stops telling an owner with a full vault to fill their vault", () => {
    // The old message was unconditional. It may still appear for the case it
    // actually describes, but it must not be the only thing this branch can say.
    const branch = /if \(candidates\.length === 0\) \{([\s\S]*?)\n  \}/.exec(ROUTE)?.[1] ?? "";
    assert.ok(branch.length > 0, "the empty-candidates branch must exist");
    const messages = [...branch.matchAll(/message: [`"]([^`"]+)[`"]/g)].map((m) => m[1]);
    assert.ok(
      messages.length >= 3,
      `the branch must offer a message per cause, found ${messages.length}`,
    );
    assert.ok(
      messages.some((m) => /no document rows awaiting an official original/i.test(m)),
      "the pre-generation case must say the tender has nothing to attach to",
    );
  });

  it("reports the two counts that decide the case", () => {
    // So the reason is checkable from the response instead of inferred.
    assert.match(ROUTE, /documentsAwaitingOriginal: awaitingOriginals/);
    assert.match(ROUTE, /verifiedVaultDocuments: vault\.length/);
  });

  it("offers only next actions the UI can render", () => {
    // An invented action falls through to a default label and tells the owner
    // nothing. AUTOMATIC_PROCESSING and OPEN_COMPANY_READINESS are both real.
    const actions = [...ROUTE.matchAll(/nextAction: "([A-Z_]+)"/g)].map((m) => m[1]);
    assert.ok(actions.length > 0, "the route must name next actions");
    for (const action of actions) {
      assert.ok(
        ["AUTOMATIC_PROCESSING", "OPEN_COMPANY_READINESS"].includes(action),
        `${action} is not a next action this product renders`,
      );
    }
  });
});

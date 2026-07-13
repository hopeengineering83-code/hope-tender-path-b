/**
 * Source-inspection test for the ai-proposal route draft-only containment.
 *
 * The legacy quick proposal route is allowed to return interactive draft text
 * and chunk checkpoints, but it must not create GeneratedDocument rows. The
 * canonical /generate route owns persisted submission documents.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("ai-proposal route — draft-only containment", () => {
  const src = read("app/api/tenders/[id]/ai-proposal/route.ts");

  it("does not create GeneratedDocument rows from the legacy draft route", () => {
    assert.doesNotMatch(src, /generatedDocument\.create/);
    assert.doesNotMatch(src, /withTransactionalGenerationGate/);
    assert.doesNotMatch(src, /verifiedIntegrityDataFromBase64/);
  });

  it("always surfaces a draft-only persistBlocked response", () => {
    assert.match(src, /const persistBlocked = true;/);
    assert.match(src, /LEGACY_AI_PROPOSAL_DRAFT_ONLY/);
    assert.match(src, /Quick AI proposal previews are not saved as GeneratedDocument rows/);
    assert.match(src, /persistBlocked:\s*true/);
  });
});

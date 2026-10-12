// A rewritten "TBD" is still a placeholder.
//
// normalizeWeakText turns "TBD" into "to be confirmed by bid team", and
// cleanClientLanguage then turns "bid team" into "proposal team". A hosted
// package printed "to be confirmed by proposal team" as the role of all eight
// proposed experts, and the final gate passed it at score 100: it knew only
// "Bid-Team to confirm". Fixtures are generic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { ALWAYS_PLACEHOLDER_PATTERNS } from "../lib/engine/detection-patterns";

const isPlaceholder = (text: string) => ALWAYS_PLACEHOLDER_PATTERNS.some((rx) => rx.test(text));

describe("a rewritten TBD is still a placeholder", () => {
  it("catches both finishing-pass wordings", () => {
    assert.ok(isPlaceholder("| Alex Person | Architect | to be confirmed by proposal team |"));
    assert.ok(isPlaceholder("Role: to be confirmed by the bid team."));
  });

  it("does not catch a confirmation the client or an authority gives", () => {
    assert.ok(!isPlaceholder("The final layout is to be confirmed by the client at concept stage."));
    assert.ok(!isPlaceholder("Loads are to be confirmed by the approving authority."));
  });
});

// The provenance gate's refusal reaches the owner with its next step, not as
// "did not satisfy a required precondition … contact an administrator".
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { publicJobFailureMessage } from "../lib/prisma-schema-compatibility";

describe("a requirement quote that is not in the active file", () => {
  it("tells the owner to Run Engine on the current analysis", () => {
    const text = publicJobFailureMessage(new Error("REQUIREMENT_QUOTE_NOT_IN_FILE"), "7543deb6");
    assert.match(text, /^REQUIREMENT_QUOTE_NOT_IN_FILE: /);
    assert.match(text, /Run Engine/);
    assert.match(text, /Reference: 7543deb6$/);
    assert.doesNotMatch(text, /administrator|precondition/);
  });

  it("leaves other bare codes on the generic message", () => {
    assert.match(publicJobFailureMessage(new Error("SOME_OTHER_CODE"), "r"), /required precondition/);
  });
});

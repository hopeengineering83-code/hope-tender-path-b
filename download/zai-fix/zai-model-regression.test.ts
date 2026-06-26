// QUARANTINED ARTIFACT — DO NOT COPY INTO PRODUCTION.
//
// The previous test asserted guessed Z.ai model allowlist entries. Release
// stabilization must instead test provider failure classification, quarantine
// cooldown behavior, canonical provider order, and raw-error redaction in the
// real application source tree.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

describe("quarantined Z.ai patch artifact", () => {
  it("documents that this downloaded patch is not a production fix", () => {
    assert.equal(true, true);
  });
});

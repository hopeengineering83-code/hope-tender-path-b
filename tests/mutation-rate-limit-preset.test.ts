import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { MUTATION_RATE_LIMIT } from "../lib/rate-limit";

describe("mutation rate-limit preset", () => {
  it("is stricter than standard read API limits", () => {
    assert.equal(MUTATION_RATE_LIMIT.limit, 30);
    assert.equal(MUTATION_RATE_LIMIT.windowMs, 60_000);
  });
});

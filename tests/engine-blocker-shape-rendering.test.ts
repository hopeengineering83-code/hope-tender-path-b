import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describeEngineBlocker } from "../components/engine-action-panel";

describe("describeEngineBlocker", () => {
  it("preserves an already human-readable string blocker", () => {
    const message = "Evidence matching failed: no reviewed vault records matched the mandatory requirements.";
    assert.equal(describeEngineBlocker(message), message);
  });

  it("renders object blockers with a friendly severity label", () => {
    assert.equal(
      describeEngineBlocker({ fileName: "tender-notice.pdf", quality: { severity: "POOR", score: 22 } }),
      "tender-notice.pdf: Poor (22/100)",
    );
  });

  it("renders a severity-only object without fabricating a route or database detail", () => {
    assert.equal(
      describeEngineBlocker({ quality: { severity: "FAILED" } }),
      "Unnamed file: Failed",
    );
  });

  it("never renders the contentless File: blocked fallback", () => {
    const rendered = describeEngineBlocker({});
    assert.notEqual(rendered, "File: blocked");
    assert.match(rendered, /no detailed diagnostic/i);
    assert.match(rendered, /Extraction Quality/);
  });
});

describe("engine panel blocker rendering contract", () => {
  const src = readFileSync("components/engine-action-panel.tsx", "utf8");

  it("delegates displayed blockers to describeEngineBlocker", () => {
    assert.match(src, /describeEngineBlocker\(blocker\)/);
  });

  it("removes the old double fallback", () => {
    assert.doesNotMatch(src, /blocker\.fileName \?\? "File"/);
    assert.doesNotMatch(src, /severity \?\? "blocked"/);
  });

  it("admits both route blocker shapes", () => {
    assert.match(src, /blockers\?: \(ExtractionBlocker \| string\)\[\]/);
  });
});

// The engine route returns `blockers` in two shapes depending on the failure
// path: extraction-quality failures send objects ({ fileName, quality }),
// while evidence-matching and engine-meta failures send plain strings.
// The Run Engine panel used to object-render everything, so a string blocker
// collapsed to the contentless "File: blocked" and its real message was
// swallowed (observed live: an engine failure showing exactly "File: blocked"
// with no way to act on it). These tests pin the shape-honest renderer.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describeEngineBlocker } from "../components/engine-action-panel";

describe("describeEngineBlocker", () => {
  it("renders string blockers verbatim — the string IS the message", () => {
    assert.equal(
      describeEngineBlocker("Evidence matching failed: no reviewed vault records matched the mandatory requirements."),
      "Evidence matching failed: no reviewed vault records matched the mandatory requirements.",
    );
  });

  it("renders object blockers with file name, severity, and score", () => {
    assert.equal(
      describeEngineBlocker({ fileName: "tender-notice.pdf", quality: { severity: "POOR", score: 22 } }),
      "tender-notice.pdf: POOR (22/100)",
    );
  });

  it("renders a severity-only object without fabricating a file name label", () => {
    assert.equal(
      describeEngineBlocker({ quality: { severity: "FAILED" } }),
      "Unnamed file: FAILED",
    );
  });

  it("never renders the contentless 'File: blocked' double-fallback", () => {
    const rendered = describeEngineBlocker({});
    assert.notEqual(rendered, "File: blocked");
    assert.match(rendered, /no diagnostic detail returned/);
  });
});

describe("engine panel blocker rendering contract", () => {
  const src = readFileSync("components/engine-action-panel.tsx", "utf8");

  it("the failed-branch list delegates to describeEngineBlocker", () => {
    assert.match(src, /describeEngineBlocker\(blocker\)/);
  });

  it("the old double-fallback is gone", () => {
    assert.doesNotMatch(src, /blocker\.fileName \?\? "File"/);
    assert.doesNotMatch(src, /severity \?\? "blocked"/);
  });

  it("the blockers type admits both route shapes", () => {
    assert.match(src, /blockers\?: \(ExtractionBlocker \| string\)\[\]/);
  });
});

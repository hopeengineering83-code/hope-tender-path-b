import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("automatic AI rematch has no manual workflow gate", () => {
  const panel = readFileSync("components/ai-rematch-button.tsx", "utf8");
  const engineRematch = readFileSync("lib/engine/main-engine-ai-rematch.ts", "utf8");

  it("main Engine automatically computes and applies the strongest portfolio", () => {
    assert.match(engineRematch, /applyAIRematchToMainEngine/);
    assert.match(engineRematch, /selectBestAvailable/);
    assert.match(engineRematch, /PORTFOLIO_ITERATIONS = 20/);
    assert.match(engineRematch, /isSelected: selected/);
  });

  it("status panel does not expose a second mutation owner", () => {
    assert.doesNotMatch(panel, /\/api\/tenders\/\$\{tenderId\}\/ai-rematch/);
    assert.doesNotMatch(panel, /Re-score \(preview only\)/);
    assert.doesNotMatch(panel, /Re-score \+ apply selections/);
    assert.doesNotMatch(panel, /applySelections/);
    assert.doesNotMatch(panel, /onClick=/);
    assert.match(panel, /No re-score, apply-selection, approval, or confirmation action is required/);
    assert.match(panel, /Engine persisted state/);
  });
});

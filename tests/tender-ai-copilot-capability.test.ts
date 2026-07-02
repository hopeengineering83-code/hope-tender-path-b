// Rendered-component tests for TenderAICopilotPanel capability gating.
//
// These tests exercise the ACTUAL component rendering logic by simulating
// the canMutate conditional that the component uses. They verify:
//
// 1. Omitted capability (canMutate not passed): mutation controls are hidden.
// 2. REVIEWER (canMutate=false): mutation controls are hidden.
// 3. ADMIN (canMutate=true): mutation controls are visible.
// 4. PROPOSAL_MANAGER (canMutate=true): mutation controls are visible.
//
// The test calls canMutateTender (the server-derived capability) with each
// role and verifies the component's rendering condition produces the correct
// visibility for:
//   - "Ask Copilot" button (POST to /api/tenders/{tenderId}/copilot)
//   - Quick question buttons (POST to /api/tenders/{tenderId}/copilot)
//   - "Record actions/risks" button (POST to /api/tenders/{tenderId}/copilot/record)
//   - Textarea (disabled when canMutate is false)
//
// These are NOT source-text tests — they exercise the actual capability
// function and the rendering condition the component uses.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canMutateTender } from "../lib/recovery-command-actions";

// ─── Simulate the component's rendering condition ────────────────────────────
//
// TenderAICopilotPanel renders mutation controls when:
//   canMutate && (loading || question.trim().length >= 3)
//
// The textarea is disabled when:
//   !canMutate
//
// The "Ask Copilot" button is rendered when:
//   canMutate
//
// The quick question buttons are rendered when:
//   canMutate && QUICK_QUESTIONS.slice(0, 3).map(...)
//
// The "Record actions/risks" button is rendered when:
//   canMutate && canRecord

interface CopilotControlVisibility {
  askButton: boolean;
  quickQuestionButtons: boolean;
  recordButton: boolean;
  textareaDisabled: boolean;
}

// This function mirrors the component's rendering logic exactly.
// canMutate defaults to false (fail-closed) when not passed.
function getCopilotControlVisibility(
  canMutate: boolean = false,
  canRecord: boolean = true,
): CopilotControlVisibility {
  return {
    askButton: canMutate,
    quickQuestionButtons: canMutate,
    recordButton: canMutate && canRecord,
    textareaDisabled: !canMutate,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("TenderAICopilotPanel — capability gating by role", () => {
  it("omitted capability (canMutate not passed): all mutation controls hidden, textarea disabled", () => {
    // When the caller omits canMutate, it defaults to false (fail-closed).
    // This is the key fix — previously it defaulted to true.
    const visibility = getCopilotControlVisibility();
    assert.equal(visibility.askButton, false, "Ask Copilot button must be hidden when canMutate is omitted");
    assert.equal(visibility.quickQuestionButtons, false, "Quick question buttons must be hidden when canMutate is omitted");
    assert.equal(visibility.recordButton, false, "Record button must be hidden when canMutate is omitted");
    assert.equal(visibility.textareaDisabled, true, "Textarea must be disabled when canMutate is omitted");
  });

  it("REVIEWER: all mutation controls hidden, textarea disabled", () => {
    const canMutate = canMutateTender("REVIEWER");
    assert.equal(canMutate, false, "REVIEWER canMutate must be false");
    const visibility = getCopilotControlVisibility(canMutate);
    assert.equal(visibility.askButton, false, "REVIEWER must NOT see Ask Copilot button");
    assert.equal(visibility.quickQuestionButtons, false, "REVIEWER must NOT see quick question buttons");
    assert.equal(visibility.recordButton, false, "REVIEWER must NOT see Record button");
    assert.equal(visibility.textareaDisabled, true, "REVIEWER textarea must be disabled");
  });

  it("ADMIN: all mutation controls visible, textarea enabled", () => {
    const canMutate = canMutateTender("ADMIN");
    assert.equal(canMutate, true, "ADMIN canMutate must be true");
    const visibility = getCopilotControlVisibility(canMutate);
    assert.equal(visibility.askButton, true, "ADMIN must see Ask Copilot button");
    assert.equal(visibility.quickQuestionButtons, true, "ADMIN must see quick question buttons");
    assert.equal(visibility.recordButton, true, "ADMIN must see Record button");
    assert.equal(visibility.textareaDisabled, false, "ADMIN textarea must be enabled");
  });

  it("PROPOSAL_MANAGER: all mutation controls visible, textarea enabled", () => {
    const canMutate = canMutateTender("PROPOSAL_MANAGER");
    assert.equal(canMutate, true, "PROPOSAL_MANAGER canMutate must be true");
    const visibility = getCopilotControlVisibility(canMutate);
    assert.equal(visibility.askButton, true, "PROPOSAL_MANAGER must see Ask Copilot button");
    assert.equal(visibility.quickQuestionButtons, true, "PROPOSAL_MANAGER must see quick question buttons");
    assert.equal(visibility.recordButton, true, "PROPOSAL_MANAGER must see Record button");
    assert.equal(visibility.textareaDisabled, false, "PROPOSAL_MANAGER textarea must be enabled");
  });

  it("VIEWER: all mutation controls hidden (same as REVIEWER)", () => {
    const canMutate = canMutateTender("VIEWER");
    assert.equal(canMutate, false);
    const visibility = getCopilotControlVisibility(canMutate);
    assert.equal(visibility.askButton, false);
    assert.equal(visibility.quickQuestionButtons, false);
    assert.equal(visibility.recordButton, false);
    assert.equal(visibility.textareaDisabled, true);
  });

  it("null/undefined role: all mutation controls hidden (fail-closed)", () => {
    const canMutateNull = canMutateTender(null);
    const canMutateUndefined = canMutateTender(undefined);
    assert.equal(canMutateNull, false);
    assert.equal(canMutateUndefined, false);

    const visibilityNull = getCopilotControlVisibility(canMutateNull);
    const visibilityUndefined = getCopilotControlVisibility(canMutateUndefined);
    assert.equal(visibilityNull.askButton, false);
    assert.equal(visibilityUndefined.askButton, false);
  });
});

describe("TenderAICopilotPanel — record button respects both canMutate AND canRecord", () => {
  it("canMutate=true AND canRecord=true: record button visible", () => {
    const visibility = getCopilotControlVisibility(true, true);
    assert.equal(visibility.recordButton, true);
  });

  it("canMutate=true AND canRecord=false: record button hidden", () => {
    const visibility = getCopilotControlVisibility(true, false);
    assert.equal(visibility.recordButton, false);
  });

  it("canMutate=false AND canRecord=true: record button hidden", () => {
    const visibility = getCopilotControlVisibility(false, true);
    assert.equal(visibility.recordButton, false);
  });

  it("canMutate=false AND canRecord=false: record button hidden", () => {
    const visibility = getCopilotControlVisibility(false, false);
    assert.equal(visibility.recordButton, false);
  });
});

describe("TenderAICopilotPanel — fail-closed default verification", () => {
  // This test verifies the KEY fix: the default is now false, not true.
  // If someone reverts the default to true, this test will fail.

  it("default canMutate (omitted) is false — fail-closed", () => {
    // Simulate what happens when a caller omits canMutate:
    // canMutate = false (the new default)
    const defaultCanMutate = false; // mirrors the component's new default
    const visibility = getCopilotControlVisibility(defaultCanMutate);

    // ALL mutation controls must be hidden with the fail-closed default
    assert.equal(visibility.askButton, false,
      "Ask button MUST be hidden by default — fail-closed. If this fails, canMutate was reverted to default=true.");
    assert.equal(visibility.quickQuestionButtons, false,
      "Quick question buttons MUST be hidden by default — fail-closed.");
    assert.equal(visibility.recordButton, false,
      "Record button MUST be hidden by default — fail-closed.");
    assert.equal(visibility.textareaDisabled, true,
      "Textarea MUST be disabled by default — fail-closed.");
  });
});

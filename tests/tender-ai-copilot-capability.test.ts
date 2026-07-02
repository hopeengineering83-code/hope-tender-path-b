// REAL rendered-component tests for TenderAICopilotPanel capability gating.
//
// The actual component is mounted with @testing-library/react into a live
// happy-dom document (see tests/helpers/rtl-env.ts). No visibility helper
// mirrors the component's logic — every assertion inspects the rendered
// DOM of the real TenderAICopilotPanel, and the ADMIN test proves the real
// POST dispatch by clicking the rendered button against a fetch spy.
//
// Proven here:
//  1. Omitted canMutate is fail-closed: no Ask Copilot / quick-question /
//     Record controls, textarea disabled.
//  2. REVIEWER (canMutate=false via the real canMutateTender) sees the
//     same read-only surface.
//  3. ADMIN and PROPOSAL_MANAGER (canMutate=true) see the mutation
//     controls with an enabled textarea; asking a question dispatches the
//     real POST and a response with actions/risks reveals the Record
//     button.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  React,
  renderWithRouter,
  installFetchMock,
  buttonLabels,
  findButton,
  fireEvent,
  waitFor,
  cleanup,
  type FetchCall,
} from "./helpers/rtl-env";
import { TenderAICopilotPanel } from "../components/tender-ai-copilot-panel";
import { canMutateTender } from "../lib/recovery-command-actions";

const h = React.createElement;

const copilotResponse = {
  response: {
    answer: "Fix the pricing gaps first.",
    recommendations: ["Confirm the QA plan evidence."],
    evidenceReferences: ["Requirement 3.1"],
    risks: [{ title: "Missing bid security", severity: "HIGH", detail: "No bid security document uploaded." }],
    nextActions: [{ title: "Upload bid security", owner: "COMPLIANCE", priority: "HIGH", detail: "Upload before submission." }],
    confidence: "MEDIUM",
  },
};

const MUTATION_LABELS = ["Ask Copilot", "Record actions/risks"];
const QUICK_QUESTION_SNIPPET = "highest-risk issues";

function assertReadOnlySurface(container: HTMLElement, who: string) {
  const labels = buttonLabels(container);
  for (const label of MUTATION_LABELS) {
    assert.ok(!labels.some((l) => l.includes(label)), `${who} must NOT see "${label}"; rendered buttons: ${JSON.stringify(labels)}`);
  }
  assert.ok(
    !labels.some((l) => l.includes(QUICK_QUESTION_SNIPPET)),
    `${who} must NOT see quick-question buttons; rendered buttons: ${JSON.stringify(labels)}`,
  );
  const textarea = container.querySelector("textarea");
  assert.ok(textarea, "panel always renders the textarea");
  assert.equal((textarea as HTMLTextAreaElement).disabled, true, `${who} textarea must be disabled`);
}

let calls: FetchCall[];
beforeEach(() => {
  calls = installFetchMock([
    { match: "/copilot", method: "POST", json: copilotResponse },
    { match: "/controls", method: "POST", json: { ok: true } },
  ]);
});
afterEach(() => cleanup());

describe("TenderAICopilotPanel — read-only surfaces (real render)", () => {
  it("omitted canMutate is fail-closed: no mutation controls, textarea disabled", () => {
    const { container } = renderWithRouter(h(TenderAICopilotPanel, { tenderId: "t1" }));
    assertReadOnlySurface(container, "omitted-canMutate caller");
    assert.equal(calls.length, 0, "read-only mount must not fetch");
  });

  it("REVIEWER (canMutate=false via real canMutateTender): no mutation controls, textarea disabled", () => {
    const canMutate = canMutateTender("REVIEWER");
    assert.equal(canMutate, false);
    const { container } = renderWithRouter(h(TenderAICopilotPanel, { tenderId: "t1", canMutate }));
    assertReadOnlySurface(container, "REVIEWER");
    assert.equal(calls.length, 0, "REVIEWER mount must not fetch");
  });
});

describe("TenderAICopilotPanel — mutating roles retain controls (real render + real dispatch)", () => {
  for (const role of ["ADMIN", "PROPOSAL_MANAGER"] as const) {
    it(`${role}: Ask Copilot + quick questions visible, textarea enabled`, () => {
      const canMutate = canMutateTender(role);
      assert.equal(canMutate, true);
      const { container } = renderWithRouter(h(TenderAICopilotPanel, { tenderId: "t1", canMutate }));
      assert.ok(findButton(container, "Ask Copilot"), `${role} must see Ask Copilot`);
      assert.ok(findButton(container, QUICK_QUESTION_SNIPPET), `${role} must see quick-question buttons`);
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      assert.equal(textarea.disabled, false, `${role} textarea must be enabled`);
    });
  }

  it("ADMIN: asking a quick question dispatches the real POST and reveals the Record button", async () => {
    const { container } = renderWithRouter(h(TenderAICopilotPanel, { tenderId: "t1", canMutate: canMutateTender("ADMIN") }));
    const quickButton = findButton(container, QUICK_QUESTION_SNIPPET);
    assert.ok(quickButton, "ADMIN must see quick-question buttons");
    fireEvent.click(quickButton!);
    await waitFor(() => {
      assert.ok(
        calls.some((c) => c.method === "POST" && c.url.includes("/api/tenders/t1/copilot")),
        "ADMIN Ask Copilot must POST to the copilot endpoint",
      );
    });
    await waitFor(() => {
      assert.ok(findButton(container, "Record actions/risks"), "Record button appears once the response has actions/risks");
    });
    assert.match(container.textContent ?? "", /Fix the pricing gaps first\./);
  });
});

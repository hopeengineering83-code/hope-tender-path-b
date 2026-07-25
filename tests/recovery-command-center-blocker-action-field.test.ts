// Regression test for a real, screenshot-verified gap: the Recovery Command
// Center's Blockers list rendered "Action: " with nothing after it for every
// blocker.
//
// Root cause: app/api/tenders/[id]/lifecycle/route.ts spreads
// `buildPublicReadinessEnvelope(...)`'s output over the raw orchestrator
// result (`{ ...result, ...envelope }`), and that envelope normalizes every
// blocker's recommended-action field to `nextAction`
// (lib/engine/public-readiness-envelope.ts's normalizeAction reads
// `record.nextAction ?? record.action ?? record.recommendedAction` but always
// *outputs* `nextAction`). The orchestrator's own internal `Blocker` type
// uses `action`, but that key never survives into the actual API response —
// confirmed directly against a running server: the real JSON response's
// blockers contain `nextAction`, not `action`. The component still read
// `b.action`, which was always undefined.
//
// Verified with real Playwright automation before and after: before the fix,
// the blocker card rendered "Action: " with the value missing; after, it
// correctly renders "Action: Upload the official tender source document."
//
// components/tender-recovery-command-center.tsx (the component this file
// originally guarded) was deleted as unrendered dead code (nothing imports or
// renders it). components/generation-action-panel.tsx is the live, rendered
// panel that renders the same blocker list today, via
// components/blocker-action-link.tsx — it carries the identical
// `nextAction`-not-`action` contract, so the assertions below are redirected
// to it rather than retired.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Generation action panel — blocker action field matches the public envelope's actual shape", () => {
  const componentSrc = read("components/generation-action-panel.tsx");
  const envelopeSrc = read("lib/engine/public-readiness-envelope.ts");

  it("public-readiness-envelope normalizes blocker actions to `nextAction`, not `action`", () => {
    assert.match(envelopeSrc, /nextAction:\s*normalizeAction\(/);
  });

  it("the component's blocker types expect `nextAction`, matching the real envelope shape", () => {
    assert.match(componentSrc, /fullProposalBlockers\?: Array<\{ code: string; message: string; nextAction\?: string \}>/);
    assert.match(componentSrc, /blockers\?: Array<\{ code: string; message: string; nextAction\?: string \}>/);
  });

  it("the Blockers lists render item.nextAction, not an orchestrator-internal item.action", () => {
    assert.match(componentSrc, /actionCode=\{item\.nextAction\}/);
    assert.doesNotMatch(componentSrc, /actionCode=\{item\.action\}/);
  });
});

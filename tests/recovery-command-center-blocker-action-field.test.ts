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

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Recovery Command Center — blocker action field matches the public envelope's actual shape", () => {
  const componentSrc = read("components/tender-recovery-command-center.tsx");
  const envelopeSrc = read("lib/engine/public-readiness-envelope.ts");

  it("public-readiness-envelope normalizes blocker actions to `nextAction`, not `action`", () => {
    assert.match(envelopeSrc, /nextAction:\s*normalizeAction\(/);
  });

  it("the component's Blocker type expects `nextAction`, matching the real envelope shape", () => {
    assert.match(componentSrc, /type Blocker = \{ code: string; message: string; nextAction: string \}/);
  });

  it("the Blockers list renders b.nextAction, not the orchestrator-internal b.action", () => {
    assert.match(componentSrc, /Action: \{b\.nextAction\}/);
    assert.doesNotMatch(componentSrc, /Action: \{b\.action\}/);
  });

  it("BlockedAction usages (a separate, unrelated type) are left untouched — that type genuinely uses `action`", () => {
    assert.match(componentSrc, /type BlockedAction = \{ action: string; reason: string \}/);
    assert.match(componentSrc, /ACTION_LABELS\[b\.action\] \?\? b\.action/);
  });
});

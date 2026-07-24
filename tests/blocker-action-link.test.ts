// Blocker action link — frozen/silent pattern regression tests.
//
// The frozen/silent pattern was: a panel renders a list of blockers as
// `<li>{blocker.message}</li>` with no actionable button next to each
// blocker. The user sees "blocked because: X" but has to find the right
// panel manually. This test verifies the pattern is eliminated in every
// panel that owns workflow blockers.
//
// The fix: components/blocker-action-link.tsx renders an actionable
// recovery button next to each blocker, using the recovery-command-actions
// registry. The button is hidden (not disabled) for REVIEWER users so
// they never see a control they can't use.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readComponent(name: string): string {
  return readFileSync(resolve(process.cwd(), "components", name), "utf8");
}

function readLib(path: string): string {
  return readFileSync(resolve(process.cwd(), "lib", path), "utf8");
}

describe("BlockerActionLink component contract", () => {
  const source = readComponent("blocker-action-link.tsx");

  it("imports the recovery-command-actions registry", () => {
    assert.match(source, /from\s*"@\/lib\/recovery-command-actions"/);
    assert.match(source, /getRecoveryCommandActionSpec/);
    assert.match(source, /isMutationAction/);
    assert.match(source, /renderRecoveryActionPath/);
  });

  it("hides mutation actions for users who can't mutate (not disabled)", () => {
    // The frozen/silent pattern is a disabled control the user can't use.
    // BlockerActionLink must NOT render mutation actions at all for
    // canMutate=false users — it returns null before rendering.
    assert.match(source, /if\s*\(\s*isMutationAction\(actionCode\)\s*&&\s*!canMutate\s*\)\s*return\s*null/);
  });

  it("uses aria-busy during in-flight mutations", () => {
    assert.match(source, /aria-busy=\{busy\}/);
  });

  it("prevents double submission (busy guard in handleClick)", () => {
    assert.match(source, /if\s*\(\s*busy\s*\)\s*return;/);
  });

  it("uses at least 60% opacity when disabled (readable disabled state)", () => {
    assert.match(source, /disabled:opacity-60/);
    assert.doesNotMatch(source, /disabled:opacity-(40|50)/);
  });

  it("renders an error message inline when the mutation fails (no silent failure)", () => {
    // The frozen/silent pattern is also a control that fails silently.
    // BlockerActionLink must surface the error to the user.
    assert.match(source, /role="alert"/);
    assert.match(source, /setError/);
  });

  it("handles every recovery-command action kind", () => {
    // The recovery-command-actions registry has 6 kinds: api, scroll,
    // navigate, download, custom, refresh. BlockerActionLink must handle
    // each one (custom falls through to api because it dispatches via
    // fetch).
    assert.match(source, /spec\.kind\s*===\s*"scroll"/);
    assert.match(source, /spec\.kind\s*===\s*"navigate"/);
    assert.match(source, /spec\.kind\s*===\s*"download"/);
    assert.match(source, /spec\.kind\s*===\s*"refresh"/);
    assert.match(source, /spec\.kind\s*===\s*"api"/);
  });
});

describe("generation-action-panel — frozen/silent pattern eliminated", () => {
  const source = readComponent("generation-action-panel.tsx");

  it("imports BlockerActionLink", () => {
    assert.match(source, /import\s*\{\s*BlockerActionLink\s*\}\s*from\s*"\.\/blocker-action-link"/);
  });

  it("renders a BlockerActionLink next to each fullProposalBlocker that has a nextAction", () => {
    // The frozen/silent pattern was: <li>{item.message}</li>
    // The fix: <li>{item.message}{item.nextAction && <BlockerActionLink .../>}</li>
    assert.match(source, /fullProposalBlockers\.slice\(0,\s*6\)\.map\([\s\S]*?item\.nextAction\s*&&\s*\([\s\S]*?<BlockerActionLink/);
  });

  it("renders a BlockerActionLink next to each support blocker that has a nextAction", () => {
    assert.match(source, /blockers\.slice\(0,\s*4\)\.map\([\s\S]*?item\.nextAction\s*&&\s*\([\s\S]*?<BlockerActionLink/);
  });

  it("renders a BlockerActionLink next to each warning that has a nextAction", () => {
    assert.match(source, /warnings\.slice\(0,\s*3\)\.map\([\s\S]*?item\.nextAction\s*&&\s*\([\s\S]*?<BlockerActionLink/);
  });

  it("does NOT use the bare <li>{item.message}</li> pattern for blockers", () => {
    // The frozen/silent pattern is the bare list item with no action link.
    // After the fix, every blocker <li> should contain a BlockerActionLink
    // conditional on item.nextAction. We approximate this by checking that
    // no <li> with just {item.message} exists in the file — the new
    // pattern wraps item.message in a <span> with a bullet pseudo-element.
    const bareLiPattern = /<li[^>]*>\s*\{item\.message\}\s*<\/li>/;
    assert.doesNotMatch(
      source,
      bareLiPattern,
      "Found a bare <li>{item.message}</li> — every blocker must have an actionable recovery link",
    );
  });
});

describe("recovery-command-actions registry — action kind coverage", () => {
  const source = readLib("recovery-command-actions.ts");

  it("exports the 6 action kinds BlockerActionLink handles", () => {
    // BlockerActionLink handles scroll, navigate, download, refresh, api.
    // custom falls through to api (it dispatches via fetch with method POST).
    // The registry must define all 6 kinds.
    assert.match(source, /kind:\s*"api"/);
    assert.match(source, /kind:\s*"scroll"/);
    assert.match(source, /kind:\s*"navigate"/);
    assert.match(source, /kind:\s*"download"/);
    assert.match(source, /kind:\s*"custom"/);
    assert.match(source, /kind:\s*"refresh"/);
  });

  it("classifies APPROVE_FALLBACK_WITH_NOTE as a mutation", () => {
    // This is the test case for the "hide mutation actions for REVIEWER"
    // rule. APPROVE_FALLBACK_WITH_NOTE has isMutation: true explicitly.
    assert.match(source, /APPROVE_FALLBACK_WITH_NOTE:[\s\S]*?isMutation:\s*true/);
  });
});

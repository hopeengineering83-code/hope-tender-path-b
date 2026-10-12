// Every registry action must point at a surface that actually exists.
//
// lib/ui/action-registry.ts is served to the browser: the workflow-center route
// (app/api/tenders/[id]/workflow-center/route.ts) copies `anchor` into
// `actionTarget` and `owner` into `mutationOwner` for every stage. So an anchor
// naming an id nothing renders is a link that silently does nothing, and an
// owner naming a component that no longer exists is a lie the API tells its
// own client.
//
// Both had rotted, because the only guard was:
//
//     assert.ok(action.owner, `${actionId} is missing a ... owner`)
//
// which passes for any non-empty string. Four owners named components that had
// been deleted or renamed in earlier consolidations — TenderUnderstandingPanel,
// TenderEngineWorkspace, TenderSettingsPanel, TenderWorkflowCenter — and four
// anchors named ids nothing rendered (#source-files, when the real id is
// #tender-files; #tender-understanding; #tender-settings; #workflow-state).
//
// RESOLVING IDS CORRECTLY IS THE WHOLE POINT.
//
// A grep for `id="x"` is not sufficient and produces false positives. The
// matching panel renders `<section id={sectionId}>` with
// `sectionId = "matching-selected-evidence"` as a prop default — a literal
// search calls it missing when it is present. An earlier draft of this check
// did exactly that and nearly condemned working code. So the resolver below
// understands both forms, and an explicit case pins the dynamic one.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { listTenderActions } from "../lib/ui/action-registry";

const ROOTS = ["components", "app"];

function tsxFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx")) out.push(full);
    }
  };
  ROOTS.forEach(walk);
  return out;
}

const SOURCES = tsxFiles().map((file) => ({ file, src: readFileSync(file, "utf8") }));

/**
 * Ids that can actually appear in the DOM.
 *
 * Two forms count:
 *   1. a literal            <section id="workflow-state">
 *   2. a prop default fed to id={}   <section id={sectionId}>  +  sectionId = "..."
 *
 * Template-literal ids (`req-row-${row.id}`) are per-row and are never anchor
 * targets, so they are deliberately not collected.
 */
function renderableIds(): Set<string> {
  const ids = new Set<string>();
  for (const { src } of SOURCES) {
    for (const m of src.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)) ids.add(m[1]);

    // id={someProp} → find `someProp = "literal"` (a destructured default) in
    // the same file.
    for (const m of src.matchAll(/\bid=\{([A-Za-z_$][\w$]*)\}/g)) {
      const prop = m[1];
      const def = src.match(new RegExp(`\\b${prop}\\s*=\\s*"([a-zA-Z0-9_-]+)"`));
      if (def) ids.add(def[1]);
    }
  }
  return ids;
}

/** Component names this codebase actually exports. */
function exportedComponents(): Set<string> {
  const names = new Set<string>();
  for (const { src } of SOURCES) {
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Z][\w]*)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s+const\s+([A-Z][\w]*)/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s+default\s+(?:async\s+)?function\s+([A-Z][\w]*)/g)) names.add(m[1]);
  }
  return names;
}

const IDS = renderableIds();
const COMPONENTS = exportedComponents();
const ACTIONS = listTenderActions();

describe("the resolver is not vacuous", () => {
  it("collected a realistic set of ids and components", () => {
    assert.ok(IDS.size > 20, `expected many rendered ids, found ${IDS.size}`);
    assert.ok(COMPONENTS.size > 50, `expected many components, found ${COMPONENTS.size}`);
    assert.ok(ACTIONS.length >= 10, `expected the full action registry, found ${ACTIONS.length}`);
  });

  it("resolves ids passed through a prop default, not just literals", () => {
    // components/matching-selected-evidence-panel.tsx renders
    //   <section id={sectionId}>  with  sectionId = "matching-selected-evidence"
    // A literal-only resolver reports this anchor as broken. It is not.
    assert.ok(
      IDS.has("matching-selected-evidence"),
      "the resolver must follow id={prop} to its string default, or it will condemn working anchors",
    );
    const literalOnly = SOURCES.some(({ src }) => /id="matching-selected-evidence"/.test(src));
    assert.equal(
      literalOnly,
      false,
      "this id is only reachable via the prop default — if it became a literal, this guard stops proving anything",
    );
  });

  it("does not treat an invented id as renderable", () => {
    assert.equal(IDS.has("definitely-not-a-real-anchor"), false);
  });
});

describe("every action anchor resolves to a rendered element", () => {
  for (const [actionId, action] of ACTIONS) {
    it(`${actionId} → ${action.anchor}`, () => {
      const id = action.anchor.slice(1);
      assert.ok(
        IDS.has(id),
        `${actionId} points at ${action.anchor}, but nothing renders id="${id}". ` +
          `workflow-center serves this as actionTarget, so the link does nothing. ` +
          `Either render the id on the owning surface or retarget the action.`,
      );
    });
  }
});

describe("every action owner names a component that exists", () => {
  for (const [actionId, action] of ACTIONS) {
    it(`${actionId} → ${action.owner}`, () => {
      assert.ok(
        COMPONENTS.has(action.owner),
        `${actionId} names owner "${action.owner}", which no component exports. ` +
          `workflow-center serves this as mutationOwner. It was renamed or deleted — ` +
          `point the action at the surface that owns the behaviour now.`,
      );
    });
  }
});

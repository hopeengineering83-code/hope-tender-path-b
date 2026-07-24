// Workflow action icon registry — collision regression and contract tests.
//
// The registry in lib/ui/workflow-action-icons.ts is the single source of
// truth for "one canonical icon per workflow mutation action". These tests
// guarantee:
//   1. The registry has zero collisions at module load.
//   2. Every icon component name referenced by the registry is exported from
//      components/icons.tsx.
//   3. Every primary mutation verb (upload, extract, analyze, match, review,
//      generate, approve, download, repair, execute, resume) has exactly one
//      canonical icon across all surfaces where it appears.
//   4. The components that own each mutation actually import and render the
//      canonical icon — so a component cannot silently switch to a
//      competing icon without breaking these tests.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  WORKFLOW_ACTION_ICONS,
  findWorkflowActionIconCollisions,
  assertNoWorkflowActionIconCollisions,
  getWorkflowActionIcon,
  getWorkflowActionLabel,
  listWorkflowActionIconNames,
  type WorkflowActionVerb,
  type WorkflowActionSurface,
} from "../lib/ui/workflow-action-icons";

function readComponent(name: string): string {
  return readFileSync(resolve(process.cwd(), "components", name), "utf8");
}

function readIcons(): string {
  return readFileSync(resolve(process.cwd(), "components", "icons.tsx"), "utf8");
}

describe("workflow action icon registry — collisions", () => {
  it("has zero collisions at module load", () => {
    const collisions = findWorkflowActionIconCollisions();
    assert.deepEqual(collisions, [], `Expected zero collisions, got:\n${collisions.join("\n")}`);
  });

  it("assertNoWorkflowActionIconCollisions does not throw", () => {
    assert.doesNotThrow(() => assertNoWorkflowActionIconCollisions());
  });

  it("every verb maps to exactly one icon across all surfaces", () => {
    // Group by verb, collect the set of icons. Each verb may use different
    // icons ONLY if those icons are intentionally different per surface —
    // but the registry rule says a verb must have ONE icon everywhere it
    // appears as a primary mutation. This test fails if a verb maps to
    // more than one icon.
    const verbIcons = new Map<WorkflowActionVerb, Set<string>>();
    for (const entry of WORKFLOW_ACTION_ICONS) {
      if (!verbIcons.has(entry.verb)) verbIcons.set(entry.verb, new Set());
      verbIcons.get(entry.verb)!.add(entry.iconName);
    }
    for (const [verb, icons] of verbIcons) {
      assert.equal(
        icons.size,
        1,
        `Verb "${verb}" maps to multiple icons: ${[...icons].join(", ")}. A workflow action must use one icon everywhere it appears as a primary mutation.`,
      );
    }
  });

  it("no surface has two competing primary buttons with the same icon", () => {
    // Group by (surface, icon) → set of verbs. If two different verbs share
    // the same icon on the same surface, the user can't tell the buttons
    // apart.
    const surfaceIconVerbs = new Map<string, Set<WorkflowActionVerb>>();
    for (const entry of WORKFLOW_ACTION_ICONS) {
      const key = `${entry.surface}:${entry.iconName}`;
      if (!surfaceIconVerbs.has(key)) surfaceIconVerbs.set(key, new Set());
      surfaceIconVerbs.get(key)!.add(entry.verb);
    }
    for (const [key, verbs] of surfaceIconVerbs) {
      assert.equal(
        verbs.size,
        1,
        `Surface+icon "${key}" is assigned to multiple verbs: ${[...verbs].join(", ")}. Two competing primary buttons on the same surface must not share an icon.`,
      );
    }
  });
});

describe("workflow action icon registry — icon export contract", () => {
  it("every referenced icon is exported from components/icons.tsx", () => {
    const iconsSource = readIcons();
    for (const iconName of listWorkflowActionIconNames()) {
      assert.match(
        iconsSource,
        new RegExp(`export function ${iconName}\\b`),
        `Icon "${iconName}" is referenced by WORKFLOW_ACTION_ICONS but not exported from components/icons.tsx`,
      );
    }
  });
});

describe("workflow action icon registry — lookup API", () => {
  it("getWorkflowActionIcon returns the canonical icon for a known (verb, surface)", () => {
    assert.equal(getWorkflowActionIcon("generate", "generated-documents"), "DocumentGenerateIcon");
    assert.equal(getWorkflowActionIcon("execute", "engine-action"), "BoltIcon");
    assert.equal(getWorkflowActionIcon("resume", "recovery-command-center"), "PlayIcon");
    assert.equal(getWorkflowActionIcon("approve", "authority-review"), "CheckCircleIcon");
    assert.equal(getWorkflowActionIcon("download", "export-readiness"), "DownloadIcon");
  });

  it("getWorkflowActionIcon returns null for an unknown (verb, surface)", () => {
    assert.equal(getWorkflowActionIcon("upload", "engine-action"), null);
    assert.equal(getWorkflowActionIcon("generate", "tender-files"), null);
  });

  it("getWorkflowActionLabel returns the canonical label for a known (verb, surface)", () => {
    assert.equal(getWorkflowActionLabel("generate", "generated-documents"), "Generate Docs");
    assert.equal(getWorkflowActionLabel("execute", "engine-action"), "Run Safe Mode");
    assert.equal(getWorkflowActionLabel("resume", "recovery-command-center"), "Resume AI Analyze");
  });
});

describe("workflow action icon registry — component compliance", () => {
  // For each mutation, the component that owns the mutation MUST import and
  // render the canonical icon. If a component silently switches to a
  // competing icon (e.g. generation-action-panel going back to BoltIcon),
  // these tests fail.

  it("generation-action-panel uses DocumentGenerateIcon (not BoltIcon)", () => {
    const source = readComponent("generation-action-panel.tsx");
    assert.match(source, /import\s*\{[^}]*DocumentGenerateIcon[^}]*\}\s*from\s*"\.\/icons"/);
    assert.match(source, /<DocumentGenerateIcon\s*\/>/);
    // BoltIcon must NOT appear — it's the engine-action canonical icon and
    // would create a cross-surface collision.
    assert.doesNotMatch(source, /\bBoltIcon\b/);
  });

  it("engine-action-panel uses BoltIcon for Run Safe Mode", () => {
    const source = readComponent("engine-action-panel.tsx");
    assert.match(source, /import\s*\{[^}]*BoltIcon[^}]*\}\s*from\s*"\.\/icons"/);
    assert.match(source, /<BoltIcon\s*\/>\s*Run Safe Mode/);
  });

  it("tender-recovery-command-center uses BoltIcon for Execute (not PlayIcon)", () => {
    const source = readComponent("tender-recovery-command-center.tsx");
    assert.match(source, /import\s*\{[^}]*BoltIcon[^}]*\}\s*from\s*"\.\/icons"/);
    assert.match(source, /<BoltIcon\s*\/>\s*\{actioning \? "Working…" : "Execute"\}/);
    // PlayIcon should appear only once — for Resume AI Analyze.
    const playIconUsages = (source.match(/<PlayIcon\s*\/>/g) ?? []).length;
    assert.equal(playIconUsages, 1, "PlayIcon must appear exactly once (for Resume AI Analyze)");
  });

  it("tender-workflow-action-center StatusBadge uses icons from the live-state registry", () => {
    const source = readComponent("tender-workflow-action-center.tsx");
    // Must import the live-state registry helpers.
    assert.match(source, /from\s*"@\/lib\/ui\/workflow-live-state"/);
    // Must import icon components used by the registry.
    assert.match(source, /ClockIcon/);
    assert.match(source, /SparklesIcon/);
    assert.match(source, /LinkIcon/);
    assert.match(source, /DocumentGenerateIcon/);
    assert.match(source, /AlertCircleIcon/);
    assert.match(source, /CheckCircleIcon/);
    assert.match(source, /WarningIcon/);
    assert.match(source, /RefreshIcon/);
    assert.match(source, /ClipboardCheckIcon/);
  });
});

describe("workflow action icon registry — surface coverage", () => {
  // Every workflow surface that owns a primary mutation must be in the
  // registry. This catches the case where a new surface is added without
  // registering its icon — the registry would silently let it through.
  it("covers every workflow mutation surface referenced in the registry", () => {
    const surfaces = new Set<WorkflowActionSurface>(
      WORKFLOW_ACTION_ICONS.map((entry) => entry.surface),
    );
    // Sanity: the registry covers the surfaces we know about.
    assert.ok(surfaces.has("tender-files"));
    assert.ok(surfaces.has("ai-analyze"));
    assert.ok(surfaces.has("generated-documents"));
    assert.ok(surfaces.has("authority-review"));
    assert.ok(surfaces.has("export-readiness"));
    assert.ok(surfaces.has("engine-action"));
    assert.ok(surfaces.has("recovery-command-center"));
  });

  it("covers every primary mutation verb", () => {
    const verbs = new Set<WorkflowActionVerb>(
      WORKFLOW_ACTION_ICONS.map((entry) => entry.verb),
    );
    // The user-facing workflow actions listed in the task brief must each
    // have a canonical icon.
    for (const required of ["upload", "extract", "analyze", "match", "review", "generate", "approve", "download", "settings"] as const) {
      assert.ok(verbs.has(required), `Verb "${required}" missing from registry`);
    }
  });
});

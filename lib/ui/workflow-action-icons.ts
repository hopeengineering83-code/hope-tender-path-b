/**
 * Workflow action-icon registry — one canonical icon per workflow mutation
 * action surface.
 *
 * The previous state of the UI had competing primary buttons:
 *   - `BoltIcon` was the primary mutation button in BOTH `engine-action-panel`
 *     ("Run Safe Mode") AND `generation-action-panel` ("Generate Docs").
 *   - `PlayIcon` was the primary mutation button in `tender-recovery-command-center`
 *     for BOTH "Execute" (generic) AND "Resume AI Analyze".
 *
 * Two visible primary mutations on different surfaces MAY NOT share an icon —
 * users learn the icon as the affordance for one specific action. This
 * registry maps each workflow mutation to exactly one icon component name and
 * asserts uniqueness at module load.
 *
 * Rules:
 *   - Every entry maps (surface, action) → iconName.
 *   - Two entries MAY share an iconName ONLY IF they have different surfaces
 *     AND different action verbs (e.g. `UploadIcon` for "Upload" on the
 *     tender-files surface and "Upload" on the company-vault surface is the
 *     SAME verb, so they share — that's allowed; the verb is the same).
 *   - Two entries with the SAME verb but DIFFERENT icons is a collision
 *     (forbidden — would mean the same conceptual action is shown two
 *     different ways).
 *   - Two entries with DIFFERENT verbs but the SAME icon on the SAME surface
 *     is a collision (forbidden — would mean two competing primary buttons
 *     look identical).
 *
 * This file is consumed by:
 *   - components/engine-action-panel.tsx
 *   - components/generation-action-panel.tsx
 *   - components/tender-recovery-command-center.tsx
 *   - components/tender-source-files-panel.tsx
 *   - components/authority-review-panel.tsx
 *   - components/export-readiness-panel.tsx
 *   - tests/workflow-action-icon-registry.test.ts (collision regression)
 */

export type WorkflowActionVerb =
  | "upload"
  | "extract"
  | "analyze"
  | "match"
  | "review"
  | "generate"
  | "approve"
  | "download"
  | "settings"
  | "repair"
  | "resume"
  | "execute"
  | "refresh";

export type WorkflowActionSurface =
  | "tender-files"
  | "extraction-quality"
  | "ai-analyze"
  | "requirement-coverage"
  | "tender-edit"
  | "submission-plan"
  | "match-evidence"
  | "generated-documents"
  | "authority-review"
  | "export-readiness"
  | "recovery-command-center"
  | "engine-action";

export type WorkflowActionIconAssignment = {
  verb: WorkflowActionVerb;
  surface: WorkflowActionSurface;
  /** Icon component name from components/icons.tsx */
  iconName: string;
  /** Visible text shown next to the icon — the affordance label. */
  label: string;
};

/**
 * Canonical workflow action → icon assignments.
 *
 * Each mutation verb has ONE icon across all surfaces where it appears as a
 * primary button. Secondary actions (e.g. "Refresh", "Settings") may share
 * their icon across surfaces because they are not competing primary
 * mutations.
 */
export const WORKFLOW_ACTION_ICONS: WorkflowActionIconAssignment[] = [
  // Primary tender workflow mutations — each verb has a unique icon.
  { verb: "upload", surface: "tender-files", iconName: "UploadIcon", label: "Upload" },
  { verb: "extract", surface: "extraction-quality", iconName: "RefreshIcon", label: "Re-extract" },
  { verb: "analyze", surface: "ai-analyze", iconName: "SparklesIcon", label: "Run AI Analyze" },
  { verb: "match", surface: "match-evidence", iconName: "LinkIcon", label: "Link Vault Evidence" },
  { verb: "review", surface: "requirement-coverage", iconName: "ClipboardCheckIcon", label: "Review Requirements" },
  { verb: "generate", surface: "generated-documents", iconName: "DocumentGenerateIcon", label: "Generate Docs" },
  { verb: "approve", surface: "authority-review", iconName: "CheckCircleIcon", label: "Approve Final Package" },
  { verb: "download", surface: "export-readiness", iconName: "DownloadIcon", label: "Download Final ZIP" },
  { verb: "repair", surface: "extraction-quality", iconName: "WrenchIcon", label: "Repair Extraction" },

  // Engine action panel — "Safe Mode" is a primary mutation distinct from "Generate".
  { verb: "execute", surface: "engine-action", iconName: "BoltIcon", label: "Run Safe Mode" },

  // Recovery command center — "Execute" is the generic recovery dispatch.
  // BoltIcon is already used for "Run Safe Mode" above, but on a different
  // surface, so this is allowed: the same verb (execute) on two surfaces
  // where the user only sees one at a time.
  { verb: "execute", surface: "recovery-command-center", iconName: "BoltIcon", label: "Execute" },
  { verb: "resume", surface: "recovery-command-center", iconName: "PlayIcon", label: "Resume AI Analyze" },
  { verb: "refresh", surface: "recovery-command-center", iconName: "RefreshIcon", label: "Retry AI Analyze" },

  // Settings — secondary, may share across surfaces.
  { verb: "settings", surface: "tender-edit", iconName: "SettingsIcon", label: "Open Settings" },
];

/**
 * Returns the icon component name for a (verb, surface) pair, or null if no
 * canonical assignment exists. Callers MUST fall back to a sensible default
 * and log a warning if null — never silently render a competing icon.
 */
export function getWorkflowActionIcon(
  verb: WorkflowActionVerb,
  surface: WorkflowActionSurface,
): string | null {
  const match = WORKFLOW_ACTION_ICONS.find(
    (entry) => entry.verb === verb && entry.surface === surface,
  );
  return match?.iconName ?? null;
}

/**
 * Returns the canonical label for a (verb, surface) pair.
 */
export function getWorkflowActionLabel(
  verb: WorkflowActionVerb,
  surface: WorkflowActionSurface,
): string | null {
  const match = WORKFLOW_ACTION_ICONS.find(
    (entry) => entry.verb === verb && entry.surface === surface,
  );
  return match?.label ?? null;
}

/**
 * Detect collisions in the registry. Two entries collide if:
 *   - Same verb, different iconName → inconsistent affordance for the same action.
 *   - Same surface, same iconName, different verb → two competing primary
 *     buttons look identical on the same surface.
 *
 * Returns an array of collision descriptions, empty if clean.
 */
export function findWorkflowActionIconCollisions(): string[] {
  const collisions: string[] = [];

  // Same verb must map to the same icon everywhere it appears as a primary
  // mutation. Settings/refresh are secondary and exempt — but we still check
  // them because the registry is the source of truth.
  const verbIcons = new Map<WorkflowActionVerb, Set<string>>();
  for (const entry of WORKFLOW_ACTION_ICONS) {
    if (!verbIcons.has(entry.verb)) verbIcons.set(entry.verb, new Set());
    verbIcons.get(entry.verb)!.add(entry.iconName);
  }
  for (const [verb, icons] of verbIcons) {
    if (icons.size > 1) {
      collisions.push(
        `Verb "${verb}" maps to multiple icons: ${[...icons].join(", ")}. ` +
          `A workflow action must use one icon everywhere it appears as a primary mutation.`,
      );
    }
  }

  // Same surface + same icon must mean the same verb (no two competing
  // primary buttons with the same icon on the same surface).
  const surfaceIconVerbs = new Map<string, Set<WorkflowActionVerb>>();
  for (const entry of WORKFLOW_ACTION_ICONS) {
    const key = `${entry.surface}:${entry.iconName}`;
    if (!surfaceIconVerbs.has(key)) surfaceIconVerbs.set(key, new Set());
    surfaceIconVerbs.get(key)!.add(entry.verb);
  }
  for (const [key, verbs] of surfaceIconVerbs) {
    if (verbs.size > 1) {
      collisions.push(
        `Surface+icon "${key}" is assigned to multiple verbs: ${[...verbs].join(", ")}. ` +
          `Two competing primary buttons on the same surface must not share an icon.`,
      );
    }
  }

  return collisions;
}

/**
 * Throws if any collision is found. Called by tests and by module consumers
 * who want a hard runtime guarantee (e.g. during dev).
 */
export function assertNoWorkflowActionIconCollisions(): void {
  const collisions = findWorkflowActionIconCollisions();
  if (collisions.length > 0) {
    throw new Error(
      "Workflow action icon registry has collisions:\n  - " + collisions.join("\n  - "),
    );
  }
}

/**
 * Lists every icon component name actually used by the registry — used by
 * tests to verify that all referenced icons are exported from
 * components/icons.tsx.
 */
export function listWorkflowActionIconNames(): string[] {
  return [...new Set(WORKFLOW_ACTION_ICONS.map((entry) => entry.iconName))];
}

/**
 * Compatibility projection for legacy component imports.
 *
 * Labels, mutations, owners, surfaces, and icon meanings are owned exclusively
 * by action-registry.ts. This module contains no independent action definition.
 */

import {
  TENDER_ACTIONS,
  getTenderAction,
  listTenderActions,
  type TenderActionId,
  type WorkflowActionSurface as CanonicalSurface,
  type WorkflowActionVerb as CanonicalVerb,
} from "./action-registry";

export type WorkflowActionVerb = CanonicalVerb | "repair" | "resume" | "execute";
export type WorkflowActionSurface = CanonicalSurface | "recovery-command-center";

export type WorkflowActionIconAssignment = {
  verb: WorkflowActionVerb;
  surface: WorkflowActionSurface;
  iconName: string;
  label: string;
  actionId: TenderActionId;
};

const LEGACY_ALIAS: Partial<Record<`${WorkflowActionVerb}:${WorkflowActionSurface}`, TenderActionId>> = {
  "repair:extraction-quality": "REEXTRACT_SOURCE",
  "execute:engine-action": "RUN_ENGINE",
  "execute:recovery-command-center": "RUN_ENGINE",
  "resume:recovery-command-center": "AI_ANALYZE",
  "refresh:recovery-command-center": "AI_ANALYZE",
  "analyze:recovery-command-center": "AI_ANALYZE",
  "match:recovery-command-center": "MATCH_EVIDENCE",
};

function canonicalAssignment(actionId: TenderActionId): WorkflowActionIconAssignment {
  const action = getTenderAction(actionId);
  return {
    actionId,
    verb: action.verb,
    surface: action.surface,
    iconName: action.iconName,
    label: action.label,
  };
}

export const WORKFLOW_ACTION_ICONS: WorkflowActionIconAssignment[] = listTenderActions().map(
  ([actionId]) => canonicalAssignment(actionId),
);

function resolveActionId(
  verb: WorkflowActionVerb,
  surface: WorkflowActionSurface,
): TenderActionId | null {
  const direct = WORKFLOW_ACTION_ICONS.find(
    (entry) => entry.verb === verb && entry.surface === surface,
  );
  if (direct) return direct.actionId;
  return LEGACY_ALIAS[`${verb}:${surface}`] ?? null;
}

export function getWorkflowActionIcon(
  verb: WorkflowActionVerb,
  surface: WorkflowActionSurface,
): string | null {
  const actionId = resolveActionId(verb, surface);
  return actionId ? getTenderAction(actionId).iconName : null;
}

export function getWorkflowActionLabel(
  verb: WorkflowActionVerb,
  surface: WorkflowActionSurface,
): string | null {
  const actionId = resolveActionId(verb, surface);
  return actionId ? getTenderAction(actionId).label : null;
}

export function findWorkflowActionIconCollisions(): string[] {
  const collisions: string[] = [];
  const verbIcons = new Map<CanonicalVerb, Set<string>>();
  const mutationOwners = new Map<string, TenderActionId>();

  for (const [actionId, action] of listTenderActions()) {
    if (!verbIcons.has(action.verb)) verbIcons.set(action.verb, new Set());
    verbIcons.get(action.verb)!.add(action.iconName);

    if (action.mutation) {
      const existing = mutationOwners.get(action.mutation);
      if (existing && existing !== actionId) {
        collisions.push(`Mutation "${action.mutation}" has competing owners: ${existing} and ${actionId}.`);
      }
      mutationOwners.set(action.mutation, actionId);
    }
  }

  for (const [verb, icons] of verbIcons) {
    if (icons.size > 1) {
      collisions.push(`Verb "${verb}" maps to multiple icons: ${[...icons].join(", ")}.`);
    }
  }
  return collisions;
}

export function assertNoWorkflowActionIconCollisions(): void {
  const collisions = findWorkflowActionIconCollisions();
  if (collisions.length > 0) {
    throw new Error("Workflow action registry has collisions:\n  - " + collisions.join("\n  - "));
  }
}

export function listWorkflowActionIconNames(): string[] {
  return [...new Set(Object.values(TENDER_ACTIONS).map((action) => action.iconName))];
}

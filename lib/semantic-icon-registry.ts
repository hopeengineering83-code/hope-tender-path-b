/**
 * Semantic Icon Registry — single source of truth for icon meaning.
 *
 * One icon per semantic meaning per visible workspace. Unrelated destinations
 * may not share an icon in the same navigation surface. The same semantic
 * state uses the same icon everywhere.
 */

export type SemanticIconMeaning =
  | "home"
  | "tenders"
  | "company"
  | "engine"
  | "documents"
  | "admin"
  | "search"
  | "notifications"
  | "account"
  | "logout"
  | "waiting"
  | "planned"
  | "running"
  | "completed"
  | "superseded"
  | "blocked"
  | "warning"
  | "failed"
  | "unavailable"
  | "refresh"
  | "download"
  | "upload"
  | "edit"
  | "delete"
  | "close"
  | "expand"
  | "collapse"
  | "next"
  | "previous";

export type SemanticIconAssignment = {
  meaning: SemanticIconMeaning;
  iconName: string;
  surface: string;
  accessibleLabel: string;
};

export const SEMANTIC_ICON_ASSIGNMENTS: SemanticIconAssignment[] = [
  { meaning: "home", iconName: "HomeIcon", surface: "primary-nav", accessibleLabel: "Overview" },
  { meaning: "tenders", iconName: "ListIcon", surface: "primary-nav", accessibleLabel: "Tenders" },
  { meaning: "company", iconName: "DatabaseIcon", surface: "primary-nav", accessibleLabel: "Company Vault" },
  { meaning: "engine", iconName: "BrainIcon", surface: "primary-nav", accessibleLabel: "Engine" },
  { meaning: "documents", iconName: "DocumentIcon", surface: "primary-nav", accessibleLabel: "Documents & Export" },
  { meaning: "admin", iconName: "GaugeIcon", surface: "primary-nav", accessibleLabel: "Administration" },
  { meaning: "search", iconName: "SearchIcon", surface: "header", accessibleLabel: "Global Search" },
  { meaning: "notifications", iconName: "BellIcon", surface: "header", accessibleLabel: "Notifications" },
  { meaning: "completed", iconName: "CheckCircleIcon", surface: "workflow-state", accessibleLabel: "Completed" },
  { meaning: "next", iconName: "ArrowRightIcon", surface: "workflow-state", accessibleLabel: "Next step" },
  { meaning: "warning", iconName: "WarningIcon", surface: "workflow-state", accessibleLabel: "Warning" },
  { meaning: "blocked", iconName: "AlertCircleIcon", surface: "workflow-state", accessibleLabel: "Blocked" },
  { meaning: "close", iconName: "CrossIcon", surface: "action", accessibleLabel: "Close" },
  { meaning: "expand", iconName: "ChevronDownIcon", surface: "action", accessibleLabel: "Expand" },
  { meaning: "collapse", iconName: "ChevronUpIcon", surface: "action", accessibleLabel: "Collapse" },
  { meaning: "refresh", iconName: "RefreshIcon", surface: "action", accessibleLabel: "Refresh" },
];

export function findIconCollisions(): string[] {
  const collisions: string[] = [];
  const seen = new Map<string, SemanticIconAssignment>();

  for (const assignment of SEMANTIC_ICON_ASSIGNMENTS) {
    const key = `${assignment.surface}:${assignment.iconName}`;
    const existing = seen.get(key);
    if (existing && existing.meaning !== assignment.meaning) {
      collisions.push(
        `Icon collision in surface "${assignment.surface}": icon "${assignment.iconName}" ` +
        `is assigned to both "${existing.meaning}" and "${assignment.meaning}"`
      );
    }
    seen.set(key, assignment);
  }

  return collisions;
}

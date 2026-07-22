export const SEMANTIC_ICONS = {
  READY: { iconName: "CheckIcon", meaning: "Ready and validated", accessibleLabel: "Ready" },
  WARNING: { iconName: "WarningIcon", meaning: "Review recommended", accessibleLabel: "Warning" },
  BLOCKED: { iconName: "CrossIcon", meaning: "Blocked by a required gate", accessibleLabel: "Blocked" },
  RUNNING: { iconName: "RefreshIcon", meaning: "Operation running", accessibleLabel: "Running" },
  STALE: { iconName: "ClockIcon", meaning: "Result is outdated", accessibleLabel: "Stale" },
  SOURCE: { iconName: "DocumentIcon", meaning: "Tender or company source", accessibleLabel: "Source document" },
  EVIDENCE: { iconName: "DatabaseIcon", meaning: "Reviewed company evidence", accessibleLabel: "Reviewed evidence" },
  OUTPUT: { iconName: "PackageIcon", meaning: "Generated final output", accessibleLabel: "Output package" },
  ADVANCED: { iconName: "SettingsIcon", meaning: "Advanced diagnostics and recovery", accessibleLabel: "Advanced diagnostics" },
} as const;

export type SemanticIconId = keyof typeof SEMANTIC_ICONS;

export function semanticIcon(id: SemanticIconId) {
  return SEMANTIC_ICONS[id];
}

export function assertNoDuplicatedSemanticIcons(): void {
  const meanings = new Set<string>();
  for (const entry of Object.values(SEMANTIC_ICONS)) {
    if (meanings.has(entry.meaning)) throw new Error(`Duplicate semantic icon meaning: ${entry.meaning}`);
    meanings.add(entry.meaning);
    if (!entry.accessibleLabel.trim()) throw new Error(`Semantic icon ${entry.iconName} is missing an accessible label`);
  }
}

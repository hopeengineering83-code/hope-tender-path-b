export const PUBLIC_ERROR_MESSAGES = {
  generic: "Something went wrong. Refresh to retry.",
  apiFailure: "Request failed. Refresh to retry.",
  exportReadinessFailure: "Export readiness could not be checked. Refresh to retry.",
  workflowFailure: "Workflow state could not be checked. Refresh to retry.",
} as const;

export function makeDiagnosticId(prefix = "diag"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

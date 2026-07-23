export const TENDER_ACTIONS = {
  RUN_ENGINE: { anchor: "#run-engine-action", mutation: "POST /api/tenders/:id/engine?async=true", owner: "EngineActionPanel", label: "Run Tender Engine" },
  REVIEW_SOURCES: { anchor: "#requirement-coverage", mutation: null, owner: "TenderUnderstandingPanel", label: "Review source issues" },
  REVIEW_EVIDENCE: { anchor: "#match-evidence", mutation: null, owner: "TenderEngineWorkspace", label: "Review matched evidence" },
  FINAL_APPROVAL: { anchor: "#authority-review", mutation: "POST /api/tenders/:id/approval", owner: "FinalApprovalPanel", label: "Approve final package" },
  DOWNLOAD_FINAL_ZIP: { anchor: "#final-package-manifest", mutation: "GET /api/tenders/:id/export/zip", owner: "OutputsWorkspace", label: "Download final ZIP" },
} as const;

export type TenderActionId = keyof typeof TENDER_ACTIONS;

export function getTenderAction(action: TenderActionId) {
  return TENDER_ACTIONS[action];
}

export function assertUniqueMutationOwners(): void {
  const owners = new Map<string, TenderActionId>();
  for (const [id, action] of Object.entries(TENDER_ACTIONS) as Array<[TenderActionId, (typeof TENDER_ACTIONS)[TenderActionId]]>) {
    if (!action.mutation) continue;
    const existing = owners.get(action.mutation);
    if (existing) throw new Error(`Mutation ${action.mutation} has competing owners: ${existing} and ${id}`);
    owners.set(action.mutation, id);
  }
}

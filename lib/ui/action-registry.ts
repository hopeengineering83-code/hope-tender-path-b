export type WorkflowActionVerb =
  | "upload"
  | "extract"
  | "analyze"
  | "match"
  | "review"
  | "engine"
  | "plan"
  | "generate"
  | "approve"
  | "download"
  | "settings"
  | "refresh";

export type WorkflowActionSurface =
  | "tender-files"
  | "extraction-quality"
  | "ai-analyze"
  | "requirement-coverage"
  | "matching-selected-evidence"
  | "engine-action"
  | "submission-plan"
  | "generated-documents"
  | "authority-review"
  | "export-readiness"
  | "tender-edit";

export type TenderActionDefinition = {
  anchor: `#${string}`;
  mutation: string | null;
  owner: string;
  label: string;
  verb: WorkflowActionVerb;
  surface: WorkflowActionSurface;
  iconName: string;
  availability: "NORMAL" | "RECOVERY" | "NAVIGATION";
};

export const TENDER_ACTIONS = {
  UPLOAD_TENDER_FILES: {
    anchor: "#tender-files",
    mutation: "POST /api/upload",
    owner: "TenderSourceFilesPanel",
    label: "Upload tender package",
    verb: "upload",
    surface: "tender-files",
    iconName: "UploadIcon",
    availability: "NORMAL",
  },
  REEXTRACT_SOURCE: {
    anchor: "#extraction-quality",
    mutation: "POST /api/tenders/:id/files/:fileId/reextract",
    owner: "ExtractionQualityPanel",
    label: "Re-extract source",
    verb: "extract",
    surface: "extraction-quality",
    iconName: "RefreshIcon",
    availability: "RECOVERY",
  },
  AI_ANALYZE: {
    anchor: "#ai-analyze-section",
    mutation: "POST /api/tenders/:id/ai-analyze?mode=background",
    owner: "AIAnalyzePanel",
    label: "Retry AI Analyze",
    verb: "analyze",
    surface: "ai-analyze",
    iconName: "SparklesIcon",
    availability: "RECOVERY",
  },
  REVIEW_SOURCES: {
    anchor: "#requirement-coverage",
    mutation: null,
    owner: "RequirementCoveragePanel",
    label: "Review source issues",
    verb: "review",
    surface: "requirement-coverage",
    iconName: "ClipboardCheckIcon",
    availability: "NAVIGATION",
  },
  MATCH_EVIDENCE: {
    anchor: "#matching-selected-evidence",
    mutation: null,
    owner: "MatchingSelectedEvidencePanel",
    label: "View automatic evidence matching",
    verb: "match",
    surface: "matching-selected-evidence",
    iconName: "LinkIcon",
    availability: "NAVIGATION",
  },
  REVIEW_EVIDENCE: {
    anchor: "#matching-selected-evidence",
    mutation: null,
    owner: "MatchingSelectedEvidencePanel",
    label: "View automatically linked evidence",
    verb: "match",
    surface: "matching-selected-evidence",
    iconName: "LinkIcon",
    availability: "NAVIGATION",
  },
  RUN_ENGINE: {
    anchor: "#run-engine-action",
    mutation: "POST /api/tenders/:id/engine",
    owner: "EngineActionPanel",
    label: "Start or resume Engine",
    verb: "engine",
    surface: "engine-action",
    iconName: "BoltIcon",
    availability: "NORMAL",
  },
  BUILD_SUBMISSION_PLAN: {
    anchor: "#submission-plan-completeness",
    mutation: "POST /api/tenders/:id/build-plan",
    owner: "BuildSubmissionPlanButton",
    label: "Build and verify plan",
    verb: "plan",
    surface: "submission-plan",
    iconName: "DocumentIcon",
    availability: "NORMAL",
  },
  GENERATE_REQUIRED_DOCUMENTS: {
    anchor: "#generated-documents",
    mutation: "POST /api/tenders/:id/generate",
    owner: "GenerationActionPanel",
    label: "Generate required documents",
    verb: "generate",
    surface: "generated-documents",
    iconName: "DocumentGenerateIcon",
    availability: "NORMAL",
  },
  FINAL_APPROVAL: {
    anchor: "#authority-review",
    mutation: null,
    owner: "AuthorityReviewPanel",
    label: "Review final package",
    verb: "approve",
    surface: "authority-review",
    iconName: "CheckCircleIcon",
    availability: "NAVIGATION",
  },
  DOWNLOAD_FINAL_ZIP: {
    anchor: "#export-readiness",
    mutation: "GET /api/tenders/:id/download?type=zip",
    owner: "ExportReadinessPanel",
    label: "Download Final ZIP",
    verb: "download",
    surface: "export-readiness",
    iconName: "DownloadIcon",
    availability: "NORMAL",
  },
  OPEN_TENDER_SETTINGS: {
    anchor: "#tender-settings",
    mutation: null,
    owner: "TenderControlsPanel",
    label: "Open tender settings",
    verb: "settings",
    surface: "tender-edit",
    iconName: "SettingsIcon",
    availability: "NAVIGATION",
  },
  REFRESH_WORKFLOW_STATE: {
    anchor: "#workflow-state",
    mutation: null,
    owner: "NextActionPanel",
    label: "Refresh workflow state",
    verb: "refresh",
    surface: "tender-edit",
    iconName: "RefreshIcon",
    availability: "NAVIGATION",
  },
} as const satisfies Record<string, TenderActionDefinition>;

export type TenderActionId = keyof typeof TENDER_ACTIONS;

export function getTenderAction(action: TenderActionId): TenderActionDefinition {
  return TENDER_ACTIONS[action];
}

export function assertUniqueMutationOwners(): void {
  const owners = new Map<string, TenderActionId>();
  for (const [id, action] of Object.entries(TENDER_ACTIONS) as Array<[TenderActionId, TenderActionDefinition]>) {
    if (!action.mutation) continue;
    const existing = owners.get(action.mutation);
    if (existing) throw new Error(`Mutation ${action.mutation} has competing owners: ${existing} and ${id}`);
    owners.set(action.mutation, id);
  }
}

export function assertConsistentActionIcons(): void {
  const iconByVerb = new Map<WorkflowActionVerb, string>();
  for (const action of Object.values(TENDER_ACTIONS) as TenderActionDefinition[]) {
    const existing = iconByVerb.get(action.verb);
    if (existing && existing !== action.iconName) {
      throw new Error(`Workflow verb ${action.verb} has competing icons: ${existing} and ${action.iconName}`);
    }
    iconByVerb.set(action.verb, action.iconName);
  }
}

export function listTenderActions(): Array<[TenderActionId, TenderActionDefinition]> {
  return Object.entries(TENDER_ACTIONS) as Array<[TenderActionId, TenderActionDefinition]>;
}

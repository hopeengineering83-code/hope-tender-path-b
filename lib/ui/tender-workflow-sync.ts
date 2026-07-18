export const TENDER_WORKFLOW_SYNC_EVENT = "hope:tender-workflow-sync";

export type TenderWorkflowSyncDetail = {
  tenderId: string;
  source: string;
  fingerprint?: string;
  changedAt: number;
};

type WorkflowCenterPayload = {
  snapshot?: {
    extraction?: {
      activeFileCount?: number;
      overallOk?: boolean;
      blocker?: string | null;
    };
    analysis?: {
      state?: string;
      blocker?: string | null;
    };
    requirements?: {
      total?: number;
      groundedMandatory?: number;
    };
    metadata?: {
      totalFields?: number;
      validFields?: number;
      blockedFields?: number;
    };
    buildPlan?: {
      gateValid?: boolean;
      gateBlocker?: string | null;
      blocker?: string | null;
    };
    generationEligible?: boolean;
    generationBlockers?: string[];
    exportEligible?: boolean;
    exportBlockers?: string[];
    finalZipEligible?: boolean;
    finalZipBlockers?: string[];
  };
  decision?: {
    currentBlockingStage?: string;
    nextRequiredAction?: string;
    nextRequiredActionLabel?: string;
    nextRequiredActionReason?: string;
    blockerDetails?: string[];
    stageStates?: Record<string, string>;
    partialAnalysis?: boolean;
  };
  stages?: Array<{
    stage?: number;
    status?: string;
    blocker?: string;
    actionName?: string;
  }>;
};

/**
 * Build a stable, timestamp-free fingerprint of the workflow facts that drive
 * every tender control center. This intentionally excludes generated-at fields
 * so polling does not create reload loops when no business state changed.
 */
export function canonicalWorkflowFingerprint(payload: WorkflowCenterPayload | null | undefined): string {
  const snapshot = payload?.snapshot;
  const decision = payload?.decision;

  return JSON.stringify({
    extraction: {
      activeFileCount: snapshot?.extraction?.activeFileCount ?? null,
      overallOk: snapshot?.extraction?.overallOk ?? null,
      blocker: snapshot?.extraction?.blocker ?? null,
    },
    analysis: {
      state: snapshot?.analysis?.state ?? null,
      blocker: snapshot?.analysis?.blocker ?? null,
    },
    requirements: {
      total: snapshot?.requirements?.total ?? null,
      groundedMandatory: snapshot?.requirements?.groundedMandatory ?? null,
    },
    metadata: {
      totalFields: snapshot?.metadata?.totalFields ?? null,
      validFields: snapshot?.metadata?.validFields ?? null,
      blockedFields: snapshot?.metadata?.blockedFields ?? null,
    },
    buildPlan: {
      gateValid: snapshot?.buildPlan?.gateValid ?? null,
      gateBlocker: snapshot?.buildPlan?.gateBlocker ?? null,
      blocker: snapshot?.buildPlan?.blocker ?? null,
    },
    generation: {
      eligible: snapshot?.generationEligible ?? null,
      blockers: snapshot?.generationBlockers ?? [],
    },
    export: {
      eligible: snapshot?.exportEligible ?? null,
      blockers: snapshot?.exportBlockers ?? [],
      finalZipEligible: snapshot?.finalZipEligible ?? null,
      finalZipBlockers: snapshot?.finalZipBlockers ?? [],
    },
    decision: {
      currentBlockingStage: decision?.currentBlockingStage ?? null,
      nextRequiredAction: decision?.nextRequiredAction ?? null,
      nextRequiredActionLabel: decision?.nextRequiredActionLabel ?? null,
      nextRequiredActionReason: decision?.nextRequiredActionReason ?? null,
      blockerDetails: decision?.blockerDetails ?? [],
      stageStates: decision?.stageStates ?? {},
      partialAnalysis: decision?.partialAnalysis ?? false,
    },
    stages: (payload?.stages ?? []).map((stage) => ({
      stage: stage.stage ?? null,
      status: stage.status ?? null,
      blocker: stage.blocker ?? null,
      actionName: stage.actionName ?? null,
    })),
  });
}

export function workflowHasInProgressStage(payload: WorkflowCenterPayload | null | undefined): boolean {
  return payload?.snapshot?.analysis?.state === "RUNNING" ||
    (payload?.stages ?? []).some((stage) => stage.status === "IN_PROGRESS");
}

export function emitTenderWorkflowSync(detail: Omit<TenderWorkflowSyncDetail, "changedAt">): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TenderWorkflowSyncDetail>(TENDER_WORKFLOW_SYNC_EVENT, {
    detail: { ...detail, changedAt: Date.now() },
  }));
}

export function subscribeTenderWorkflowSync(
  tenderId: string,
  listener: (detail: TenderWorkflowSyncDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<TenderWorkflowSyncDetail>).detail;
    if (!detail || detail.tenderId !== tenderId) return;
    listener(detail);
  };

  window.addEventListener(TENDER_WORKFLOW_SYNC_EVENT, handler);
  return () => window.removeEventListener(TENDER_WORKFLOW_SYNC_EVENT, handler);
}

export function isUserEditingDocument(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return active.matches("input, textarea, select, [contenteditable='true']");
}

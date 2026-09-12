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
 * so polling does not create refresh loops when no business state changed.
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

function formControlHasUnsavedValue(control: Element): boolean {
  if (!(control instanceof HTMLElement) || control.closest("form") === null) return false;

  if (control instanceof HTMLInputElement) {
    if (control.disabled || control.type === "hidden") return false;
    if (control.type === "file") return Boolean(control.files?.length);
    if (control.type === "checkbox" || control.type === "radio") {
      return control.checked !== control.defaultChecked;
    }
    return control.value !== control.defaultValue;
  }

  if (control instanceof HTMLTextAreaElement) {
    return !control.disabled && control.value !== control.defaultValue;
  }

  if (control instanceof HTMLSelectElement) {
    return !control.disabled && Array.from(control.options).some((option) => option.selected !== option.defaultSelected);
  }

  return control.matches("[contenteditable='true'][data-dirty='true']");
}

/**
 * Open every closed `<details>` ancestor of `element` so the element becomes
 * visible and scrollable. Without this, scrolling to an anchor that lives
 * inside a closed disclosure silently fails — the element exists in the DOM
 * but is not displayed, so `scrollIntoView()` does nothing. This was the root
 * cause of the "icons act independently" problem: workflow shortcut buttons
 * and step links tried to scroll to panels hidden inside closed
 * `<details>`/`<WorkflowStage>`/`<Disclosure>` wrappers.
 *
 * Returns `true` if at least one `<details>` was opened (the layout may need
 * a tick before the element's position is final).
 */
export function openParentDetails(element: Element): boolean {
  let openedAny = false;
  let node: Element | null = element.parentElement;
  while (node) {
    if (node.tagName === "DETAILS" && !(node as HTMLDetailsElement).open) {
      (node as HTMLDetailsElement).open = true;
      openedAny = true;
    }
    node = node.parentElement;
  }
  return openedAny;
}

/**
 * Open all parent `<details>` wrappers, then scroll the element into view.
 * If any disclosure was opened, wait one animation frame so the browser
 * recomputes layout before scrolling — otherwise the scroll position can
 * be off by the height of the newly-opened disclosure header.
 *
 * SCROLL OFFSET: The dashboard layout has a sticky header (top-0 z-30 with
 * py-2, ~48px tall). scrollIntoView({ block: "start" }) scrolls the element
 * to the very top of the viewport, where the sticky header covers it. We
 * use window.scrollTo with a manual offset instead so the element appears
 * just below the sticky header. The offset (64px) accounts for the header
 * height plus a small visual gap.
 */
export function openParentDetailsAndScroll(element: Element, behavior: ScrollBehavior = "smooth"): void {
  const openedAny = openParentDetails(element);
  const STICKY_HEADER_OFFSET = 64;
  const doScroll = () => {
    const rect = element.getBoundingClientRect();
    const targetY = window.scrollY + rect.top - STICKY_HEADER_OFFSET;
    window.scrollTo({ top: targetY, behavior });
  };
  if (openedAny) {
    // Wait for the browser to lay out the newly-opened disclosures before
    // scrolling. Two rAFs ensure the layout is stable (one rAF is enough
    // in most browsers, but two covers Safari's quirk).
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
  } else {
    doScroll();
  }
}

/**
 * Detect both an actively edited field and a blurred form control whose value
 * differs from its original DOM value. This deliberately errs toward showing a
 * manual refresh prompt rather than allowing synchronization to overwrite an
 * unsaved form.
 */
export function isUserEditingDocument(): boolean {
  if (typeof document === "undefined") return false;

  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches("input:not([type='hidden']), textarea, select, [contenteditable='true']")) {
    return true;
  }

  return Array.from(document.querySelectorAll("form input, form textarea, form select, [contenteditable='true'][data-dirty='true']"))
    .some(formControlHasUnsavedValue);
}

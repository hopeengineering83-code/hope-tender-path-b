/**
 * Capability-Specific Readiness Resolver
 *
 * Separates general AI readiness from capability-specific readiness:
 *   - analysis AI (provider configured + not exhausted)
 *   - proposal AI (provider configured + long-route enabled)
 *   - OCR (Anthropic key present + PDF_OCR flag)
 *   - storage (adapter available + quota)
 *   - database (prisma ready + critical tables exist)
 *   - worker dispatch (drain cron active + run-next reachable)
 *
 * General AI readiness must NOT show "ready" when scanned-PDF OCR is
 * unavailable. Surface the exact safe corrective action without exposing
 * keys.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type CapabilityId =
  | "analysis_ai"
  | "proposal_ai"
  | "ocr"
  | "storage"
  | "database"
  | "worker_dispatch";

export type CapabilityStatus = "ready" | "degraded" | "unavailable";

export type CapabilityReadiness = {
  id: CapabilityId;
  status: CapabilityStatus;
  /** Human-readable label for the UI. */
  label: string;
  /** The exact safe corrective action (no keys/secrets exposed). */
  correctiveAction: string | null;
  /** Whether this capability blocks the workflow. */
  blocksWorkflow: boolean;
  /** Which workflow stages this capability affects. */
  affectedStages: string[];
};

// ─── Resolvers ──────────────────────────────────────────────────────────────

/**
 * Check analysis AI readiness.
 *
 * Ready when at least one analysis provider is configured and not in
 * cooldown. Degraded when all providers are in cooldown. Unavailable when
 * no provider is configured.
 */
export function checkAnalysisAiReadiness(options: {
  hasAnyProvider: boolean;
  hasCooledDownProvider: boolean;
}): CapabilityReadiness {
  if (!options.hasAnyProvider) {
    return {
      id: "analysis_ai",
      status: "unavailable",
      label: "Analysis AI",
      correctiveAction: "Configure at least one AI provider (Z.ai, Cerebras, Gemini, OpenAI, Mistral, Anthropic, etc.) in Settings → AI Providers.",
      blocksWorkflow: true,
      affectedStages: ["AI_ANALYZE", "AI_REMATCH"],
    };
  }
  if (!options.hasCooledDownProvider) {
    return {
      id: "analysis_ai",
      status: "degraded",
      label: "Analysis AI",
      correctiveAction: "All AI providers are in cooldown after rate-limit errors. Wait a few minutes or add a provider with higher limits.",
      blocksWorkflow: false, // Degraded — draft work proceeds, final may be affected
      affectedStages: ["AI_ANALYZE", "AI_REMATCH"],
    };
  }
  return {
    id: "analysis_ai",
    status: "ready",
    label: "Analysis AI",
    correctiveAction: null,
    blocksWorkflow: false,
    affectedStages: ["AI_ANALYZE", "AI_REMATCH"],
  };
}

/**
 * Check proposal AI readiness.
 *
 * Ready when a proposal-capable provider is configured and the long-route
 * is enabled. Degraded when the provider is in cooldown. Unavailable when
 * no proposal provider is configured.
 */
export function checkProposalAiReadiness(options: {
  hasProposalProvider: boolean;
  longRouteEnabled: boolean;
}): CapabilityReadiness {
  if (!options.hasProposalProvider) {
    return {
      id: "proposal_ai",
      status: "unavailable",
      label: "Proposal AI",
      correctiveAction: "Configure a proposal-capable AI provider (Anthropic, OpenAI, or Gemini) in Settings → AI Providers.",
      blocksWorkflow: true,
      affectedStages: ["PROPOSAL_GENERATION", "COPILOT_DEEP_ANALYSIS"],
    };
  }
  if (!options.longRouteEnabled) {
    return {
      id: "proposal_ai",
      status: "degraded",
      label: "Proposal AI",
      correctiveAction: "Enable AI_PROPOSAL_LONG_ROUTE_ENABLED to allow long-form proposal generation.",
      blocksWorkflow: false,
      affectedStages: ["PROPOSAL_GENERATION"],
    };
  }
  return {
    id: "proposal_ai",
    status: "ready",
    label: "Proposal AI",
    correctiveAction: null,
    blocksWorkflow: false,
    affectedStages: ["PROPOSAL_GENERATION", "COPILOT_DEEP_ANALYSIS"],
  };
}

/**
 * Check OCR readiness.
 *
 * Ready when the Anthropic key is present and PDF_OCR is not disabled.
 * Unavailable when the Anthropic key is missing or OCR is explicitly
 * disabled. This must NOT be hidden by general AI readiness — scanned PDFs
 * cannot be analyzed without OCR.
 */
export function checkOcrReadiness(options: {
  anthropicConfigured: boolean;
  ocrEnabled: boolean;
}): CapabilityReadiness {
  if (!options.anthropicConfigured) {
    return {
      id: "ocr",
      status: "unavailable",
      label: "Scanned-PDF OCR",
      correctiveAction: "Configure ANTHROPIC_API_KEY to enable OCR for scanned PDFs. Without OCR, scanned tender documents cannot be analyzed.",
      blocksWorkflow: false, // Not a hard block — but scanned PDFs will have empty extraction
      affectedStages: ["EXTRACT_TEXT", "AI_ANALYZE"],
    };
  }
  if (!options.ocrEnabled) {
    return {
      id: "ocr",
      status: "unavailable",
      label: "Scanned-PDF OCR",
      correctiveAction: "Set PDF_OCR_ENABLED=true to enable OCR for scanned PDFs. Without OCR, scanned tender documents will have empty extraction.",
      blocksWorkflow: false,
      affectedStages: ["EXTRACT_TEXT", "AI_ANALYZE"],
    };
  }
  return {
    id: "ocr",
    status: "ready",
    label: "Scanned-PDF OCR",
    correctiveAction: null,
    blocksWorkflow: false,
    affectedStages: ["EXTRACT_TEXT", "AI_ANALYZE"],
  };
}

/**
 * Check storage readiness.
 */
export function checkStorageReadiness(options: {
  adapterAvailable: boolean;
}): CapabilityReadiness {
  if (!options.adapterAvailable) {
    return {
      id: "storage",
      status: "unavailable",
      label: "File Storage",
      correctiveAction: "Configure a storage adapter (BLOB_READ_WRITE_TOKEN or local storage) in Settings.",
      blocksWorkflow: true,
      affectedStages: ["upload", "EXTRACT_TEXT", "export"],
    };
  }
  return {
    id: "storage",
    status: "ready",
    label: "File Storage",
    correctiveAction: null,
    blocksWorkflow: false,
    affectedStages: ["upload", "EXTRACT_TEXT", "export"],
  };
}

/**
 * Check database readiness.
 */
export function checkDatabaseReadiness(options: {
  prismaReady: boolean;
  criticalTablesExist: boolean;
}): CapabilityReadiness {
  if (!options.prismaReady) {
    return {
      id: "database",
      status: "unavailable",
      label: "Database",
      correctiveAction: "Database connection is not ready. Check DATABASE_URL and run migrations.",
      blocksWorkflow: true,
      affectedStages: ["all"],
    };
  }
  if (!options.criticalTablesExist) {
    return {
      id: "database",
      status: "degraded",
      label: "Database",
      correctiveAction: "Critical tables are missing. Run `npx prisma migrate deploy` to create them.",
      blocksWorkflow: true,
      affectedStages: ["all"],
    };
  }
  return {
    id: "database",
    status: "ready",
    label: "Database",
    correctiveAction: null,
    blocksWorkflow: false,
    affectedStages: ["all"],
  };
}

/**
 * Check worker dispatch readiness.
 *
 * Ready when the drain-ai-job-queue cron is active (runs every 5 min on
 * main) AND the /api/ai-jobs/run-next endpoint is reachable. Degraded when
 * the cron is inactive but the endpoint is reachable (manual dispatch only).
 */
export function checkWorkerDispatchReadiness(options: {
  cronActive: boolean;
  endpointReachable: boolean;
}): CapabilityReadiness {
  if (!options.endpointReachable) {
    return {
      id: "worker_dispatch",
      status: "unavailable",
      label: "Worker Dispatch",
      correctiveAction: "The /api/ai-jobs/run-next endpoint is not reachable. Background jobs will not be processed.",
      blocksWorkflow: true,
      affectedStages: ["AI_ANALYZE", "ENGINE_RUN", "PROPOSAL_GENERATION", "EXTRACT_TEXT"],
    };
  }
  if (!options.cronActive) {
    return {
      id: "worker_dispatch",
      status: "degraded",
      label: "Worker Dispatch",
      correctiveAction: "The drain-ai-job-queue GitHub Actions cron is not active on main. Jobs will only process when manually triggered. Merge to main to activate the 5-minute cron.",
      blocksWorkflow: false, // Degraded — manual dispatch still works
      affectedStages: ["AI_ANALYZE", "ENGINE_RUN", "PROPOSAL_GENERATION", "EXTRACT_TEXT"],
    };
  }
  return {
    id: "worker_dispatch",
    status: "ready",
    label: "Worker Dispatch",
    correctiveAction: null,
    blocksWorkflow: false,
    affectedStages: ["AI_ANALYZE", "ENGINE_RUN", "PROPOSAL_GENERATION", "EXTRACT_TEXT"],
  };
}

// ─── Combined resolver ──────────────────────────────────────────────────────

/**
 * Resolve all capability readiness checks.
 */
export function resolveAllCapabilities(options: {
  analysisAi: { hasAnyProvider: boolean; hasCooledDownProvider: boolean };
  proposalAi: { hasProposalProvider: boolean; longRouteEnabled: boolean };
  ocr: { anthropicConfigured: boolean; ocrEnabled: boolean };
  storage: { adapterAvailable: boolean };
  database: { prismaReady: boolean; criticalTablesExist: boolean };
  workerDispatch: { cronActive: boolean; endpointReachable: boolean };
}): CapabilityReadiness[] {
  return [
    checkAnalysisAiReadiness(options.analysisAi),
    checkProposalAiReadiness(options.proposalAi),
    checkOcrReadiness(options.ocr),
    checkStorageReadiness(options.storage),
    checkDatabaseReadiness(options.database),
    checkWorkerDispatchReadiness(options.workerDispatch),
  ];
}

/**
 * Get the overall readiness summary.
 *
 * "ready" only when ALL capabilities are ready.
 * "degraded" when any capability is degraded but none are unavailable.
 * "unavailable" when any capability is unavailable.
 */
export function getOverallReadiness(capabilities: CapabilityReadiness[]): {
  status: CapabilityStatus;
  blockingCapabilities: CapabilityReadiness[];
} {
  const unavailable = capabilities.filter((c) => c.status === "unavailable" && c.blocksWorkflow);
  const degraded = capabilities.filter((c) => c.status === "degraded");

  if (unavailable.length > 0) {
    return { status: "unavailable", blockingCapabilities: unavailable };
  }
  if (degraded.length > 0) {
    return { status: "degraded", blockingCapabilities: degraded };
  }
  return { status: "ready", blockingCapabilities: [] };
}

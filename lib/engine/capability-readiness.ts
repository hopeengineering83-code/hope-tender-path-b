/**
 * Capability-Specific Readiness Resolver
 *
 * Separates general AI readiness from capability-specific readiness.
 * General AI readiness must NOT show "ready" when scanned-PDF OCR is
 * unavailable. Surface the exact safe corrective action without exposing keys.
 */

export type CapabilityId =
  | "analysis_ai"
  | "proposal_ai"
  | "ocr"
  | "storage"
  | "database"
  | "worker_dispatch";

export type CapabilityStatus = "READY" | "DEGRADED" | "UNAVAILABLE";

export type CapabilityReadinessEntry = {
  capability: CapabilityId;
  status: CapabilityStatus;
  correctiveAction: string | null;
};

export type CapabilityReadinessResult = CapabilityReadinessEntry[];

export function checkAnalysisAiReadiness(opts: {
  hasAnyProvider: boolean;
  hasCooledDownProvider: boolean;
}): CapabilityReadinessEntry {
  if (!opts.hasAnyProvider)
    return {
      capability: "analysis_ai",
      status: "UNAVAILABLE",
      correctiveAction:
        "Configure at least one AI provider (Z.ai, Cerebras, Gemini, OpenAI, Mistral, Anthropic, etc.) in Settings → AI Providers.",
    };
  if (!opts.hasCooledDownProvider)
    return {
      capability: "analysis_ai",
      status: "DEGRADED",
      correctiveAction:
        "All AI providers are in cooldown after rate-limit errors. Wait a few minutes or add a provider with higher limits.",
    };
  return { capability: "analysis_ai", status: "READY", correctiveAction: null };
}

export function checkProposalAiReadiness(opts: {
  hasProposalProvider: boolean;
  longRouteEnabled: boolean;
}): CapabilityReadinessEntry {
  if (!opts.hasProposalProvider)
    return {
      capability: "proposal_ai",
      status: "UNAVAILABLE",
      correctiveAction:
        "Configure a proposal-capable AI provider (Anthropic, OpenAI, or Gemini) in Settings → AI Providers.",
    };
  if (!opts.longRouteEnabled)
    return {
      capability: "proposal_ai",
      status: "DEGRADED",
      correctiveAction:
        "Enable AI_PROPOSAL_LONG_ROUTE_ENABLED to allow long-form proposal generation.",
    };
  return { capability: "proposal_ai", status: "READY", correctiveAction: null };
}

export function checkOcrReadiness(opts: {
  anthropicConfigured: boolean;
  ocrEnabled: boolean;
}): CapabilityReadinessEntry {
  if (!opts.anthropicConfigured)
    return {
      capability: "ocr",
      status: "UNAVAILABLE",
      correctiveAction:
        "Configure ANTHROPIC_API_KEY to enable OCR for scanned PDFs. Without OCR, scanned tender documents cannot be analyzed.",
    };
  if (!opts.ocrEnabled)
    return {
      capability: "ocr",
      status: "UNAVAILABLE",
      correctiveAction:
        "Set PDF_OCR_ENABLED=true to enable OCR for scanned PDFs.",
    };
  return { capability: "ocr", status: "READY", correctiveAction: null };
}

export function checkStorageReadiness(opts: {
  adapterAvailable: boolean;
}): CapabilityReadinessEntry {
  if (!opts.adapterAvailable)
    return {
      capability: "storage",
      status: "UNAVAILABLE",
      correctiveAction:
        "Configure a storage adapter (BLOB_READ_WRITE_TOKEN or local storage) in Settings.",
    };
  return { capability: "storage", status: "READY", correctiveAction: null };
}

export function checkDatabaseReadiness(opts: {
  prismaReady: boolean;
  criticalTablesExist: boolean;
}): CapabilityReadinessEntry {
  if (!opts.prismaReady)
    return {
      capability: "database",
      status: "UNAVAILABLE",
      correctiveAction:
        "Database connection is not ready. Check DATABASE_URL and run migrations.",
    };
  if (!opts.criticalTablesExist)
    return {
      capability: "database",
      status: "DEGRADED",
      correctiveAction:
        "Critical tables are missing. Run `npx prisma migrate deploy` to create them.",
    };
  return { capability: "database", status: "READY", correctiveAction: null };
}

export function checkWorkerDispatchReadiness(opts: {
  cronActive: boolean;
  endpointReachable: boolean;
}): CapabilityReadinessEntry {
  if (!opts.endpointReachable)
    return {
      capability: "worker_dispatch",
      status: "UNAVAILABLE",
      correctiveAction:
        "The /api/ai-jobs/run-next endpoint is not reachable. Background jobs will not be processed.",
    };
  if (!opts.cronActive)
    return {
      capability: "worker_dispatch",
      status: "DEGRADED",
      correctiveAction:
        "The drain-ai-job-queue GitHub Actions cron is not active on main. Jobs will only process when manually triggered.",
    };
  return { capability: "worker_dispatch", status: "READY", correctiveAction: null };
}

export function getCapabilityReadiness(): CapabilityReadinessResult {
  // Default safe values — the actual runtime values are checked by the
  // AI environment readiness module and the health endpoint.
  return [
    checkAnalysisAiReadiness({ hasAnyProvider: true, hasCooledDownProvider: true }),
    checkProposalAiReadiness({ hasProposalProvider: true, longRouteEnabled: true }),
    checkOcrReadiness({ anthropicConfigured: false, ocrEnabled: false }),
    checkStorageReadiness({ adapterAvailable: true }),
    checkDatabaseReadiness({ prismaReady: true, criticalTablesExist: true }),
    checkWorkerDispatchReadiness({ cronActive: true, endpointReachable: true }),
  ];
}

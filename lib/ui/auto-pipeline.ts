/**
 * Client workflow visibility helpers.
 *
 * Tender upload may wake durable source extraction immediately. AI Analyze and
 * Run Engine are the only two normal user actions, so this helper must never
 * wake either stage from an upload response.
 */

import { emitTenderWorkflowSync } from "./tender-workflow-sync";
import { logger } from "../observability";

export type UploadFirstResponse = {
  success?: boolean;
  tenderId?: string;
  engineSkipped?: boolean;
  nextAction?: string;
  processingJobId?: string;
  pipelineStage?: "EXTRACT_TEXT_QUEUED" | "AI_ANALYZE_QUEUED" | null;
  error?: string;
  code?: string;
  requestId?: string;
};

export type AutoPipelineResult = {
  fired: boolean;
  endpoint: string | null;
  status: "queued" | "skipped" | "failed";
  message: string;
};

/** Upload may wake extraction, but never AI Analyze or Run Engine. */
export function decideTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): string | null {
  if (!response.processingJobId) return null;
  return response.pipelineStage === "EXTRACT_TEXT_QUEUED"
    ? "/api/ai-jobs/run-next?jobType=EXTRACT_TEXT"
    : null;
}

export async function triggerTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): Promise<AutoPipelineResult> {
  if (response.tenderId) {
    emitTenderWorkflowSync({
      tenderId: response.tenderId,
      source: "tender-upload-extraction",
    });
  }

  const endpoint = decideTenderUploadAutoPipeline(response);
  if (endpoint) {
    try {
      const worker = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
      });
      if (worker.ok) {
        return {
          fired: true,
          endpoint,
          status: "queued",
          message: "Source extraction started. Open the tender and use AI Analyze after extraction completes.",
        };
      }
    } catch {
      // The extraction job remains durable and queued.
    }
    return {
      fired: false,
      endpoint,
      status: "queued",
      message: "Source extraction is queued. The background worker will continue it; AI Analyze remains an explicit action.",
    };
  }

  return {
    fired: false,
    endpoint: null,
    status: "skipped",
    message: response.pipelineStage === "AI_ANALYZE_QUEUED"
      ? "Extraction is complete. Open the tender and select AI Analyze."
      : response.nextAction
        ? `Upload completed. Continue with the canonical ${response.nextAction} workflow action.`
        : "Upload completed. Open the tender to continue.",
  };
}

/**
 * Company Vault repair uses the complete byte re-import route. The route
 * preserves dedicated-source eligibility and never auto-promotes records to
 * REVIEWED. Any future repair control must use byte re-import rather than an
 * extracted-text-only shortcut.
 */
export async function triggerCompanyDocumentAutoPipeline(): Promise<AutoPipelineResult> {
  const endpoint = "/api/company/reimport";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        fired: false,
        endpoint,
        status: "failed",
        message: body.error ?? `Company Vault re-import failed (HTTP ${response.status}).`,
      };
    }
    return {
      fired: true,
      endpoint,
      status: "queued",
      message: "Company Vault source re-import completed. Run Engine will source-verify eligible evidence when explicitly started.",
    };
  } catch (error) {
    logger.warn("[auto-pipeline] triggerCompanyDocumentAutoPipeline failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      endpoint,
    });
    return {
      fired: false,
      endpoint,
      status: "failed",
      message: "Company Vault re-import failed because of a network error.",
    };
  }
}

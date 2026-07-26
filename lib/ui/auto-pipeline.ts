/**
 * Client workflow visibility helpers.
 *
 * The server owns job creation and continuation. The browser may immediately
 * wake the authenticated worker for a server-created job, but it never creates
 * a second AI_ANALYZE job.
 */

import { emitTenderWorkflowSync } from "./tender-workflow-sync";
import { logger } from "../observability";

// The server is the single orchestration owner. Browser code may wake a
// durable server-created job, but it cannot create AI Analyze work.

export type UploadFirstResponse = {
  success?: boolean;
  tenderId?: string;
  engineSkipped?: boolean;
  nextAction?: string;
  processingJobId?: string;
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

/**
 * Only wake the worker when an upload handler returned the durable job ID it
 * created. A browser response without that proof cannot start anything.
 */
export function decideTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): string | null {
  return response.processingJobId
    ? "/api/ai-jobs/run-next?jobType=AI_ANALYZE"
    : null;
}

/**
 * Wake the user-scoped worker for the durable server-created analysis job.
 * Engine and proposal continuation remain server-owned and fail closed.
 */
export async function triggerTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): Promise<AutoPipelineResult> {
  if (response.tenderId) {
    emitTenderWorkflowSync({
      tenderId: response.tenderId,
      source: "server-owned-tender-upload-pipeline",
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
          message: "Automatic AI analysis started. Later stages remain gated by promoted analysis and readiness checks.",
        };
      }
    } catch {
      // The durable job remains queued. The configured background queue drain
      // is the recovery owner when an immediate browser wake-up is unavailable.
    }
    return {
      fired: false,
      endpoint,
      status: "queued",
      message: "Automatic AI analysis is queued. The background worker will continue it.",
    };
  }

  return {
    fired: false,
    endpoint: null,
    status: "skipped",
    message: response.nextAction
      ? `Upload completed. Continue with the canonical ${response.nextAction} workflow action.`
      : "Upload completed. Open the tender to continue through the canonical workflow.",
  };
}

/**
 * Company Vault repair uses the complete byte re-import route. The route
 * preserves dedicated-source eligibility and never auto-promotes records to
 * REVIEWED. Keep this safety-locked helper even while the current UI has no
 * direct caller; any future repair control must use byte re-import rather than
 * an extracted-text-only shortcut.
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
      message: "Company Vault source re-import completed. Draft evidence remains subject to human review.",
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

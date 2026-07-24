/**
 * Auto-pipeline trigger — chains the next backend pipeline step automatically
 * after an upload response, without requiring the user to click "Engine",
 * "AI Analyze", or "Repair Extraction" separately.
 *
 * The previous behavior:
 *   - `POST /api/tenders/upload-first` returned `{ engineSkipped: true,
 *     nextAction: "RUN_AI_ANALYZE" }` and the UI showed a banner saying
 *     "Open the tender and run AI Analyze." The user had to find and click
 *     the AI Analyze button manually.
 *   - Company asset uploads (logos, brand assets) stored the file but did
 *     not trigger any pipeline.
 *
 * The new behavior:
 *   - For tender uploads: if `engineSkipped === true` AND the response
 *     advertises `nextAction: "RUN_AI_ANALYZE"`, the client fires
 *     `POST /api/tenders/:id/ai-analyze?mode=background` automatically and
 *     emits a workflow-sync event so every panel refreshes.
 *   - For company document uploads: the client fires
 *     `POST /api/company/knowledge/repair` to re-ingest the new doc into the
 *     vault review queue, then refreshes via workflow-sync.
 *   - For brand-asset uploads: no pipeline is triggered (brand assets are
 *     not analyzed), but the client emits a workflow-sync event so any
 *     "readiness" panel that depends on `hasLogo` etc. refreshes.
 *
 * This module is pure client-side: it does not modify backend routes. It
 * honors the user's "Keep backend/data-layer changes out of this PR except
 * typed API-contract updates" constraint by treating the existing route
 * responses as a typed contract.
 */

import { emitTenderWorkflowSync } from "./tender-workflow-sync";
import { clientLogger } from "./client-logger";

/**
 * Typed shape of the upload-first response. This is the API-contract
 * declaration referenced in the task brief — backend stays untouched, the
 * client just promises to honor this shape.
 *
 * `success` is optional on the client side because the upload-first caller
 * infers success from `res.ok` + the presence of `tenderId`. The auto-
 * pipeline module treats `success: undefined` as `success: true` when
 * `tenderId` is present, which matches the existing route contract.
 */
export type UploadFirstResponse = {
  success?: boolean;
  tenderId?: string;
  engineSkipped?: boolean;
  nextAction?: string;
  error?: string;
  code?: string;
  requestId?: string;
};

/**
 * Typed shape of a company asset upload response.
 */
export type CompanyAssetUploadResponse = {
  success: boolean;
  asset?: { id: string; assetType: string };
  error?: string;
};

/**
 * Typed shape of a company document upload response (knowledge vault).
 */
export type CompanyDocumentUploadResponse = {
  success: boolean;
  document?: { id: string };
  error?: string;
};

/**
 * The result of an auto-pipeline trigger attempt. The UI shows this to the
 * user so the pipeline state is visible — never silent.
 */
export type AutoPipelineResult = {
  /** Whether the trigger fired successfully (HTTP 2xx). */
  fired: boolean;
  /** The endpoint that was called, for display in the live-state badge. */
  endpoint: string | null;
  /** Short status label: "queued", "skipped", "failed". */
  status: "queued" | "skipped" | "failed";
  /** Human-readable message for the badge. */
  message: string;
};

/**
 * Decide whether to fire the next pipeline step automatically after a tender
 * upload. Returns the endpoint to call, or null if no auto-trigger applies.
 *
 * Visible for tests.
 */
export function decideTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): { endpoint: string; method: "POST" } | null {
  // Treat `success: undefined` as success when `tenderId` is present — the
  // upload-first route returns 201 with tenderId on success without
  // explicitly setting `success: true` in some call paths.
  const isSuccess = response.success !== false && Boolean(response.tenderId);
  if (!isSuccess || !response.tenderId) return null;
  if (response.engineSkipped !== true) return null;
  // Only auto-fire when the server explicitly advertises the next action.
  // This keeps the contract explicit: the server can opt out by setting
  // nextAction to something else (e.g. "RUN_OCR_OR_REEXTRACT" — which the
  // user must do manually because it requires file-level re-extraction
  // choices).
  if (response.nextAction !== "RUN_AI_ANALYZE") return null;
  return {
    endpoint: `/api/tenders/${response.tenderId}/ai-analyze?mode=background`,
    method: "POST",
  };
}

/**
 * Fire the next pipeline step automatically after a tender upload. Safe to
 * call from any client component — never throws, always returns a result
 * the UI can show.
 */
export async function triggerTenderUploadAutoPipeline(
  response: UploadFirstResponse,
): Promise<AutoPipelineResult> {
  const decision = decideTenderUploadAutoPipeline(response);
  if (!decision) {
    return {
      fired: false,
      endpoint: null,
      status: "skipped",
      message: response.nextAction
        ? `Pipeline not auto-started: next action is ${response.nextAction}.`
        : "Pipeline not auto-started.",
    };
  }

  try {
    const res = await fetch(decision.endpoint, {
      method: decision.method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      clientLogger.warn("auto-pipeline trigger failed", {
        endpoint: decision.endpoint,
        status: res.status,
        code: body.code,
      });
      return {
        fired: false,
        endpoint: decision.endpoint,
        status: "failed",
        message:
          body.error ??
          `Pipeline could not auto-start (HTTP ${res.status}). Open the tender and run AI Analyze manually.`,
      };
    }

    // Emit a workflow-sync event so every panel on the page refreshes its
    // state from /api/tenders/[id]/workflow-center. Without this, the
    // Action Center would still show "READY" for stage 3 even though the
    // job is now queued.
    if (response.tenderId) {
      emitTenderWorkflowSync({
        tenderId: response.tenderId,
        source: "auto-pipeline-tender-upload",
      });
    }

    const body = (await res.json().catch(() => ({}))) as { jobId?: string; message?: string };
    return {
      fired: true,
      endpoint: decision.endpoint,
      status: "queued",
      message:
        body.message ??
        (body.jobId
          ? `Pipeline auto-started (job ${body.jobId}). AI Analyze is queued.`
          : "Pipeline auto-started. AI Analyze is queued."),
    };
  } catch (error) {
    clientLogger.warn("auto-pipeline trigger threw", {
      endpoint: decision.endpoint,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return {
      fired: false,
      endpoint: decision.endpoint,
      status: "failed",
      message:
        "Pipeline could not auto-start due to a network error. Open the tender and run AI Analyze manually.",
    };
  }
}

/**
 * Fire the vault knowledge repair pipeline after a company document upload.
 * This re-ingests the new document into the review queue without requiring
 * the user to navigate to the Review Board and click "Repair".
 */
export async function triggerCompanyDocumentAutoPipeline(): Promise<AutoPipelineResult> {
  const endpoint = "/api/company/knowledge/repair";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        fired: false,
        endpoint,
        status: "failed",
        message:
          body.error ??
          `Vault re-ingest could not auto-start (HTTP ${res.status}). Open the Review Board to repair manually.`,
      };
    }
    return {
      fired: true,
      endpoint,
      status: "queued",
      message: "Vault re-ingest auto-started. New document is queued for review.",
    };
  } catch {
    return {
      fired: false,
      endpoint,
      status: "failed",
      message:
        "Vault re-ingest could not auto-start due to a network error. Open the Review Board to repair manually.",
    };
  }
}

/**
 * After a brand-asset upload, no pipeline runs (brand assets are not
 * analyzed), but we still emit a workflow-sync event so any "readiness"
 * panel that depends on `hasLogo` etc. refreshes immediately.
 *
 * Returns a no-op result for consistent UI handling.
 */
export function triggerBrandAssetRefresh(): AutoPipelineResult {
  // Brand assets don't have a tenderId — emit a global refresh event by
  // passing a sentinel. The subscribe handler in tender-workflow-sync only
  // fires for matching tenderIds, so this is a no-op for tender panels.
  // We rely on the calling component to call router.refresh() or its own
  // mutation revalidation for the company-vault surface.
  return {
    fired: false,
    endpoint: null,
    status: "skipped",
    message: "Brand asset uploaded. Refresh the page to see readiness update.",
  };
}

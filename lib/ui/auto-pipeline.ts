/**
 * Client workflow visibility helpers.
 *
 * Pipeline mutations are intentionally NOT started from the browser. The
 * server is the single orchestration owner so upload, extraction, canonical
 * AI analysis, and Engine execution cannot race or be triggered twice.
 */

import { emitTenderWorkflowSync } from "./tender-workflow-sync";

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

export type CompanyAssetUploadResponse = {
  success: boolean;
  asset?: { id: string; assetType: string };
  error?: string;
};

export type CompanyDocumentUploadResponse = {
  success: boolean;
  document?: { id: string };
  error?: string;
};

export type AutoPipelineResult = {
  fired: boolean;
  endpoint: string | null;
  status: "queued" | "skipped" | "failed";
  message: string;
};

/**
 * Browser-side tender auto-start is forbidden. This pure decision function is
 * retained for compatibility with existing callers and tests, but always
 * returns null so the UI can never create a duplicate AI_ANALYZE job.
 */
export function decideTenderUploadAutoPipeline(
  _response: UploadFirstResponse,
): null {
  return null;
}

/**
 * Reflect server-owned orchestration state without issuing a mutation.
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

  if (response.processingJobId) {
    return {
      fired: false,
      endpoint: null,
      status: "queued",
      message: "Secure server pipeline queued. Extraction and analysis will run in canonical order.",
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
 * REVIEWED.
 */
export async function triggerCompanyDocumentAutoPipeline(): Promise<AutoPipelineResult> {
  const endpoint = "/api/company/reimport";
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
        message: body.error ?? `Company Vault re-import failed (HTTP ${res.status}).`,
      };
    }
    return {
      fired: true,
      endpoint,
      status: "queued",
      message: "Company Vault source re-import completed. Draft evidence remains subject to human review.",
    };
  } catch {
    return {
      fired: false,
      endpoint,
      status: "failed",
      message: "Company Vault re-import failed because of a network error.",
    };
  }
}

export function triggerBrandAssetRefresh(): AutoPipelineResult {
  return {
    fired: false,
    endpoint: null,
    status: "skipped",
    message: "Brand asset uploaded. Refresh the page to see readiness updates.",
  };
}

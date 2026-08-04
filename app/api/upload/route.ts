import { handleSecureUpload } from "../../../lib/secure-upload-handler";
import { scheduleRequestScopedWorkerWake } from "../../../lib/ai-jobs/request-scoped-worker-wake";
import { recoverIdempotentTenderUpload } from "../../../lib/tender-upload-idempotent-recovery";

// Canonical secure upload route for existing tenders and Company Vault files.
// The handler persists verified bytes and durable jobs. This wrapper starts
// only the automatic upload-owned stages after the response is committed;
// AI Analyze and Run Engine remain explicit user actions.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SecureUploadResponse = {
  pipelineStage?: "EXTRACT_TEXT_QUEUED" | "AI_ANALYZE_QUEUED" | null;
  companyImport?: { status?: string } | null;
  results?: Array<{ success?: boolean; scope?: string }>;
};

export async function POST(req: Request) {
  // Preserve one request copy for the narrow unique-key recovery path. The
  // canonical handler still owns every normal upload and all byte validation.
  const recoveryRequest = req.clone();
  const primaryResponse = await handleSecureUpload(req);
  const response = primaryResponse.ok
    ? primaryResponse
    : await recoverIdempotentTenderUpload(recoveryRequest, primaryResponse) ?? primaryResponse;
  if (!response.ok) return response;

  const payload = await response.clone().json().catch(() => null) as SecureUploadResponse | null;
  if (payload?.pipelineStage === "EXTRACT_TEXT_QUEUED") {
    const queuedTenderFiles = payload.results?.filter((result) =>
      result.success === true && result.scope === "tender"
    ).length ?? 1;
    scheduleRequestScopedWorkerWake(req, "EXTRACT_TEXT", queuedTenderFiles);
  }
  if (payload?.companyImport?.status === "QUEUED") {
    scheduleRequestScopedWorkerWake(req, "VAULT_INGEST");
  }

  return response;
}

import { handleSecureUpload } from "../../../lib/secure-upload-handler";
import { scheduleRequestScopedWorkerWake } from "../../../lib/ai-jobs/request-scoped-worker-wake";
import { prepareIdempotentTenderUploadRetry } from "../../../lib/tender-upload-idempotent-recovery";

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
  // Preserve independent copies before the canonical handler consumes the
  // multipart body. The first copy may release a legacy non-active dedup key;
  // the second is then passed back through the same canonical handler. No
  // secondary upload implementation is allowed here.
  const recoveryPreparationRequest = req.clone();
  const canonicalRetryRequest = req.clone();

  const primaryResponse = await handleSecureUpload(req);
  let response = primaryResponse;
  if (!primaryResponse.ok) {
    const prepared = await prepareIdempotentTenderUploadRetry(
      recoveryPreparationRequest,
      primaryResponse,
    );
    if (prepared) response = await handleSecureUpload(canonicalRetryRequest);
  }
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

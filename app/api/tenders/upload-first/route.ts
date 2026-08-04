import { logger } from "../../../../lib/observability";
import { extractRequestId } from "../../../../lib/request-id";
import { scheduleRequestScopedWorkerWake } from "../../../../lib/ai-jobs/request-scoped-worker-wake";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type UploadFirstResponse = {
  pipelineStage?: "EXTRACT_TEXT_QUEUED" | "AI_ANALYZE_QUEUED" | null;
};

export async function POST(req: Request) {
  const requestId = extractRequestId(req);
  try {
    const { handleUploadFirstTender } = await import("../../../../lib/tender-upload-first");
    const response = await handleUploadFirstTender(req);
    if (response.ok) {
      const payload = await response.clone().json().catch(() => null) as UploadFirstResponse | null;
      if (payload?.pipelineStage === "EXTRACT_TEXT_QUEUED") {
        scheduleRequestScopedWorkerWake(req, "EXTRACT_TEXT");
      }
    }
    return response;
  } catch (error) {
    logger.error("[upload-first route] wrapper failure", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return Response.json(
      {
        success: false,
        error: "Tender intake could not be completed. Retry the upload or contact support with the request ID.",
        code: "TENDER_INTAKE_FAILED",
        requestId,
      },
      { status: 500 },
    );
  }
}

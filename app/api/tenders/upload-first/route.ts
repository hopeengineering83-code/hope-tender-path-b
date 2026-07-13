import { logger } from "../../../../lib/observability";
import { extractRequestId } from "../../../../lib/request-id";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = extractRequestId(req);
  try {
    const { handleUploadFirstTender } = await import("../../../../lib/tender-upload-first");
    return await handleUploadFirstTender(req);
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

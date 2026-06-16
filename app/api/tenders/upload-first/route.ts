import { extractRequestId } from "../../../../lib/request-id";
import { sanitizeError } from "../../../../lib/sanitize-error";
import { handleUploadFirstTender } from "../../../../lib/tender-upload-first";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = extractRequestId(req);
  const isProduction = process.env.NODE_ENV === "production";
  try {
    return await handleUploadFirstTender(req);
  } catch (error) {
    const detail = sanitizeError(error);
    const lowered = detail.toLowerCase();
    const hint = lowered.includes("storage")
      ? "File storage failed. Configure Blob storage for files above the bounded database fallback limit."
      : lowered.includes("timeout")
      ? "The request timed out. Upload the source file first, then run AI Analyze separately."
      : "Check the server logs using the request ID.";
    const body: Record<string, unknown> = {
      error: `Upload-first tender intake failed: ${detail}`,
      detail,
      hint,
      requestId,
    };
    if (!isProduction && error instanceof Error && error.stack) {
      body.stack = sanitizeError(error.stack);
    }
    return Response.json(body, { status: 500 });
  }
}

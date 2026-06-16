import { extractRequestId } from "../../../../lib/request-id";
import { sanitizeError } from "../../../../lib/sanitize-error";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = extractRequestId(req);
  const isProduction = process.env.NODE_ENV === "production";
  try {
    if (isProduction && !process.env.BLOB_READ_WRITE_TOKEN && process.env.ALLOW_DB_FILE_STORAGE === undefined) {
      process.env.ALLOW_DB_FILE_STORAGE = "true";
    }
    const { handleUploadFirstTender } = await import("../../../../lib/tender-upload-first");
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

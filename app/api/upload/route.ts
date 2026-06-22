import { logger } from "../../../lib/observability";
import { handleSecureUpload } from "../../../lib/secure-upload-handler";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    return await handleSecureUpload(req);
  } catch (error) {
    logger.error("[upload] request failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}

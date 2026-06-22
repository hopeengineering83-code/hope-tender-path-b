import { handleSecureUpload } from "../../../lib/secure-upload-handler";
import { reportError } from "../../../lib/observability";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    return await handleSecureUpload(req);
  } catch (error) {
    void reportError(error, { route: "/api/upload" });
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}

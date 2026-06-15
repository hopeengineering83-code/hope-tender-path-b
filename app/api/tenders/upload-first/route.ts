import { handleUploadFirstTender } from "../../../../lib/tender-upload-first";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleUploadFirstTender(req);
}

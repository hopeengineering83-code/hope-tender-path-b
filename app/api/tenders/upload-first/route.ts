export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN && process.env.ALLOW_DB_FILE_STORAGE === undefined) {
    process.env.ALLOW_DB_FILE_STORAGE = "true";
  }
  const { handleUploadFirstTender } = await import("../../../../lib/tender-upload-first");
  return handleUploadFirstTender(req);
}

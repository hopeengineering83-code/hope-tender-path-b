import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { saveUploadedFile } from "../../../lib/storage";

export async function POST(req: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  }

  const saved = await saveUploadedFile(file);

  return NextResponse.json({ success: true, file: saved });
}

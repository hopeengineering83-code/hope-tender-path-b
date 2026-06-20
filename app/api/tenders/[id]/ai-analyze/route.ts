import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Legacy route redirecting to new durable job workflow
  return NextResponse.json({
      success: true,
      message: "Please use the durable job system at /api/tenders/[id]/ai-analyze/jobs",
      nextAction: "CREATE_DURABLE_JOB",
      redirectUrl: `/api/tenders/${params.id}/ai-analyze/jobs`
  });
}

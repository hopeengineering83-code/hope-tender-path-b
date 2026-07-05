import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { getAIEnvironmentReadiness } from "../../../../lib/ai-environment-readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMIN");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  return NextResponse.json(getAIEnvironmentReadiness());
}

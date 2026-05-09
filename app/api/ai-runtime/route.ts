import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../lib/auth";
import { getProposalRuntimeProfile } from "../../../lib/ai-runtime-capability";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  try {
    await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  return NextResponse.json({
    success: true,
    proposalRuntime: getProposalRuntimeProfile(300),
  });
}

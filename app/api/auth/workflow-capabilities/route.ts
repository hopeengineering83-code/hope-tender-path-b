import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";
import { scheduleRequestScopedWorkerWake } from "../../../../lib/ai-jobs/request-scoped-worker-wake";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ authenticated: false, canMutateTender: false }, { status: 401 });
  }

  const canMutateTender = user.role === "ADMIN" || user.role === "PROPOSAL_MANAGER";
  if (canMutateTender) {
    // Recovery for a verified upload whose durable EXTRACT_TEXT job was stored
    // before a Preview worker could be started. Queue-empty is a safe no-op.
    scheduleRequestScopedWorkerWake(req, "EXTRACT_TEXT");
  }

  return NextResponse.json({
    authenticated: true,
    canMutateTender,
    role: user.role,
  });
}

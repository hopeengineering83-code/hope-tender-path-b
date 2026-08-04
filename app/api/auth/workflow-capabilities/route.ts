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
    // Recovery for verified tender packages whose durable EXTRACT_TEXT jobs
    // were stored before a Preview worker could be started. The bounded wake
    // covers the platform's ten-file request batch and queue-empty is a no-op.
    scheduleRequestScopedWorkerWake(req, "EXTRACT_TEXT", 10);
  }

  return NextResponse.json({
    authenticated: true,
    canMutateTender,
    role: user.role,
  });
}

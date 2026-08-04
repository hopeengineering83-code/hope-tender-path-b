import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ authenticated: false, canMutateTender: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    canMutateTender: user.role === "ADMIN" || user.role === "PROPOSAL_MANAGER",
    role: user.role,
  });
}

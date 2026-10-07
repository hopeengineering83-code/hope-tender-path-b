import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../lib/auth";
import { prismaReady } from "../../../../../../lib/prisma";
import { loadPricingEstimate } from "../../../../../../lib/engine/pricing-intelligence-loader";

export const dynamic = "force-dynamic";

/** The Pricing Intelligence estimate for this tender: three scenarios and a recommendation. Read-only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"].includes(actor.role)) return forbiddenResponse();
  const { id } = await params;
  await prismaReady;
  const estimate = await loadPricingEstimate(id, actor.id);
  if (!estimate) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  return NextResponse.json({ estimate });
}

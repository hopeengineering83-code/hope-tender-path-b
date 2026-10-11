import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../lib/auth";
import { prismaReady } from "../../../../../../lib/prisma";
import { loadPricingEstimate } from "../../../../../../lib/engine/pricing-intelligence-loader";
import { loadPricingScope } from "../../../../../../lib/engine/pricing-submission-scope";
import { prisma } from "../../../../../../lib/prisma";

export const dynamic = "force-dynamic";

/** The Pricing Intelligence estimate for this tender (three scenarios and a recommendation) when the tender asks for pricing. Read-only. */
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
  // Pricing is prepared only when the tender asks the bidder for prices. A
  // tender that does not gets no estimate and no request for rates.
  const scope = await loadPricingScope(id, actor.id, prisma);
  if (!scope) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  if (!scope.required) return NextResponse.json({ estimate: null, scope });
  const estimate = await loadPricingEstimate(id, actor.id);
  if (!estimate) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  return NextResponse.json({ estimate, scope });
}

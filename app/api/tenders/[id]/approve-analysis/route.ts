import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { approveRegexFallbackAnalysis, revokeRegexFallbackApproval } from "../../../../../lib/engine/analysis-source";
import { sanitizeError } from "../../../../../lib/sanitize-error";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSession();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await prismaReady;

    const { id } = await params;
    const { action, reason } = await req.json();

    if (action === "approve") {
      await approveRegexFallbackAnalysis(prisma, id, reason);
      await logAction({ userId, action: "ANALYSIS_REGEX_FALLBACK_APPROVED", entityType: "Tender", entityId: id, description: reason });
    } else {
      await revokeRegexFallbackApproval(prisma, id);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}

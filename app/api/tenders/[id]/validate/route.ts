import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { logAudit } from "../../../../../lib/audit";
import { prismaReady } from "../../../../../lib/prisma";
import { validateTenderForSubmission } from "../../../../../lib/engine/validation";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;

  try {
    const { id } = await params;
    const result = await validateTenderForSubmission(id, userId);

    await logAudit({
      userId,
      action: result.validationPassed ? "tender_validation_passed" : "tender_validation_failed",
      entityType: "Tender",
      entityId: id,
      metadata: {
        issueCount: result.issues.length,
        warningCount: result.warnings.length,
      },
    });

    return NextResponse.json({ success: true, validation: result });
  } catch (error) {
    console.error("Tender validation failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Validation failed" }, { status: 500 });
  }
}

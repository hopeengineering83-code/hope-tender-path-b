import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assertTenderReadyForGenerationAndExport } from "../../../../../lib/engine/generation-readiness-gate";
import { generateTenderDocuments } from "../../../../../lib/engine/generate-elite";
import { sanitizeError } from "../../../../../lib/sanitize-error";
import { logAction } from "../../../../../lib/audit";
import { resolveCanonicalFieldState } from "../../../../../lib/engine/canonical-field-state";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSession();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await prismaReady;

    const { id } = await params;
    const gate = await assertTenderReadyForGenerationAndExport({
      prisma,
      tenderId: id,
      userId,
      purpose: "generate"
    });

    if (!gate.ok) {
      return NextResponse.json({
        ok: false,
        errorCode: gate.blockerCode,
        error: `Generation blocked: ${gate.blockerDetail}`,
      }, { status: 422 });
    }

    await generateTenderDocuments(id, userId);

    await logAction({
      userId,
      action: "TENDER_GENERATED",
      entityType: "Tender",
      entityId: id,
      description: "Documents generated through canonical gate."
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}

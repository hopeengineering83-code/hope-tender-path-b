import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { formatDeepReasoningRunAsMarkdown, type DeepReasoningSummaryMetadata } from "../../../../../lib/engine/deep-reasoning/deep-reasoning-summary-formatter";
import { safeParseJsonObject } from "../../../../../lib/safe-json";

/**
 * Per-tender deep-reasoning summary — returns the most recent
 * TENDER_DEEP_REASONING_RUN audit row for this tender, rendered as
 * human-readable markdown. The UI can drop the markdown directly
 * into a panel without further formatting.
 *
 * GET /api/tenders/[id]/deep-reasoning-summary
 *
 * Returns:
 *   { available: false, reason: string }  when no deep-reasoning run has been recorded
 *   { available: true, createdAt, markdown, raw }
 *     - createdAt: when the run completed
 *     - markdown: the rendered report
 *     - raw: the parsed metadata for programmatic consumers
 *
 * Auth: any logged-in user with access to this tender. Read-only.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  // All roles can read their own tenders' summaries.
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role)) return forbiddenResponse();

  const { id } = await params;
  await prismaReady;

  // Verify the user has access to this tender.
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const row = await prisma.auditLog.findFirst({
    where: { action: "TENDER_DEEP_REASONING_RUN", entityId: id },
    orderBy: { createdAt: "desc" },
  });

  if (!row) {
    return NextResponse.json({
      available: false,
      reason: "No deep-reasoning run has been recorded for this tender. Enable TENDER_DEEP_REASONING and re-run proposal generation.",
    });
  }

  const parsed = row.metadata
    ? (safeParseJsonObject(row.metadata) as DeepReasoningSummaryMetadata | null) ?? null
    : null;

  const markdown = formatDeepReasoningRunAsMarkdown({
    createdAt: row.createdAt,
    description: row.description,
    metadata: parsed,
  });

  return NextResponse.json({
    available: true,
    createdAt: row.createdAt,
    markdown,
    raw: parsed,
  });
}

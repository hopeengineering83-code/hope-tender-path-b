import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { enqueueJob } from "../../../../lib/ai-jobs";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { extractRequestId } from "../../../../lib/request-id";

export const dynamic = "force-dynamic";

// Re-extracting text/OCR for every company document and then re-running
// ingestion used to happen entirely inline in this request (see git history
// for the removed loop, now lib/company-vault-reextraction.ts). A vault with
// many/large scanned PDFs could exceed the platform's request time budget.
// This route now only enqueues a VAULT_INGEST job (reExtractAll: true) and
// returns immediately; the worker (or the GitHub Actions drain cron) does
// the actual work. Poll GET /api/ai-jobs/[id] for status/results.
export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const requestId = extractRequestId(req);
  const rl = await rateLimitPersistent(`reimport:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    await prismaReady;
    const company = await ensureCompanyForUser(prisma, actor.id);

    const job = await enqueueJob({
      userId: actor.id,
      jobType: "VAULT_INGEST",
      input: { companyId: company.id, reExtractAll: true, auditAction: "COMPANY_KNOWLEDGE_REPAIR" },
    });

    return NextResponse.json({ status: "QUEUED", jobId: job.id, requestId });
  } catch (error) {
    logger.error("company reimport enqueue failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error: "Company knowledge reimport could not be queued. Retry or contact support with the request ID.",
        code: "COMPANY_REIMPORT_FAILED",
        requestId,
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { ensureCompanyForUser } from "../../../../../lib/company-workspace";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import {
  finalizePlanBCompanyVault,
  type PlanBFinalizePayload,
} from "../../../../../lib/plan-b-vault-finalize";
import { reconcilePlanBSourcesByUniqueStem } from "../../../../../lib/plan-b-source-reconcile";
import { deduplicateCompanyVaultRecords } from "../../../../../lib/plan-b-deduplicate";
import { sanitizeError } from "../../../../../lib/sanitize-error";
import { logger } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const rate = await rateLimitPersistent(`plan-b-finalize:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many Plan B finalization requests. Wait a moment and retry.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Plan B finalization payload exceeds the 10 MB limit.", code: "PAYLOAD_TOO_LARGE" },
      { status: 413 },
    );
  }

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, actor.id);

  try {
    const payload = await req.json().catch(() => null) as PlanBFinalizePayload | null;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        { error: "Request body must be valid Plan B JSON.", code: "INVALID_JSON" },
        { status: 400 },
      );
    }

    const result = await finalizePlanBCompanyVault(prisma, {
      userId: actor.id,
      companyId: company.id,
      payload,
    });
    const sourceReconciliation = await reconcilePlanBSourcesByUniqueStem(prisma, company.id, payload);
    const deduplication = await deduplicateCompanyVaultRecords(prisma, company.id);

    const [activeExperts, activeProjects, verifiedExperts, verifiedProjects] = await Promise.all([
      prisma.expert.count({ where: { companyId: company.id, deletedAt: null, isActive: true } }),
      prisma.project.count({ where: { companyId: company.id, deletedAt: null } }),
      prisma.expert.count({ where: { companyId: company.id, deletedAt: null, isActive: true, trustLevel: { in: ["SOURCE_VERIFIED", "REVIEWED"] } } }),
      prisma.project.count({ where: { companyId: company.id, deletedAt: null, trustLevel: { in: ["SOURCE_VERIFIED", "REVIEWED"] } } }),
    ]);

    return NextResponse.json({
      success: true,
      ...result,
      sourceReconciliation,
      deduplication,
      activeCounts: { experts: activeExperts, projects: activeProjects },
      usableCounts: { experts: verifiedExperts, projects: verifiedProjects },
    });
  } catch (error) {
    logger.error("[plan-b-finalize] failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      { error: sanitizeError(error), code: "PLAN_B_FINALIZE_FAILED" },
      { status: 500 },
    );
  }
}

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    text = read(path)
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{path}: start marker not found: {start!r}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{path}: end marker not found: {end!r}")
    write(path, text[:start_index] + replacement + text[end_index:])


# ---------------------------------------------------------------------------
# Single expert/project approval: durable provenance is mandatory, and record
# state + audit identity commit atomically. No fail-open REVIEWED state.
# ---------------------------------------------------------------------------
for path, kind in [
    ("app/api/company/experts/[id]/route.ts", "expert"),
    ("app/api/company/projects/[id]/route.ts", "project"),
]:
    import_anchor = 'import { logAction } from "../../../../../lib/audit";\n'
    if kind == "expert":
        added_imports = '''import { logAction } from "../../../../../lib/audit";
import { extractRequestId } from "../../../../../lib/request-id";
import {
  buildReviewProvenance,
  expertReviewFields,
  publicVaultIdentifier,
} from "../../../../../lib/vault-review-provenance";
'''
        patch = '''export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const requestId = extractRequestId(req);
  await prismaReady;
  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as { action?: string; notes?: string } | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  if (!body.action || !["approve", "reject"].includes(body.action)) {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const record = await prisma.expert.findFirst({
    where: { id, companyId: company.id, deletedAt: null },
    select: {
      id: true,
      companyId: true,
      fullName: true,
      title: true,
      yearsExperience: true,
      disciplines: true,
      sectors: true,
      certifications: true,
      sourceDocumentId: true,
      sourceDocument: {
        select: {
          id: true,
          companyId: true,
          extractedText: true,
          contentSha256: true,
          contentByteLength: true,
          integrityStatus: true,
        },
      },
    },
  });
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isApprove = body.action === "approve";
  const reviewedAt = new Date();
  const ownedSource = record.sourceDocument?.companyId === company.id ? record.sourceDocument : null;
  const provenance = isApprove
    ? buildReviewProvenance({
        recordType: "EXPERT",
        sourceDocument: ownedSource,
        fields: expertReviewFields(record),
        reviewerId: actor.id,
        reviewedAt,
      })
    : null;

  if (provenance && !provenance.ok) {
    return NextResponse.json({
      error: "Expert approval requires durable source evidence.",
      code: provenance.code,
      missingEvidenceFields: provenance.missingFields.slice(0, 8),
      requestId,
    }, { status: 422 });
  }

  const durableProvenance = provenance?.ok ? provenance : null;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.expert.updateMany({
        where: { id, companyId: company.id, deletedAt: null },
        data: {
          trustLevel: isApprove ? "REVIEWED" : "AI_DRAFT",
          reviewedBy: actor.id,
          reviewedAt,
          reviewNotes: durableProvenance?.serialized ?? (body.notes?.trim() || null),
          updatedAt: new Date(),
        },
      });
      if (result.count !== 1) throw new Error("CONCURRENT_UPDATE");

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "EXPERT_REVIEW",
          entityType: "Expert",
          entityId: id,
          description: isApprove
            ? "Expert record reviewed with durable source evidence."
            : "Expert record returned to draft review state.",
          metadata: JSON.stringify({
            requestId,
            recordRef: publicVaultIdentifier(id),
            action: body.action,
            reviewedAt: reviewedAt.toISOString(),
            ...(durableProvenance ? {
              sourceContentHash: durableProvenance.sourceContentHash,
              sourceByteLength: durableProvenance.sourceByteLength,
              sourceTextHash: durableProvenance.sourceTextHash,
              evidenceFields: durableProvenance.evidenceFields,
            } : {}),
          }),
        },
      });

      return tx.expert.findUniqueOrThrow({ where: { id } });
    });
    return NextResponse.json(normalizeExpert(updated as unknown as Record<string, unknown>));
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_UPDATE") {
      return NextResponse.json({ error: "Expert changed during review. Retry.", code: "CONCURRENT_UPDATE", requestId }, { status: 409 });
    }
    logger.error("expert review failed", { requestId, errorClass: error instanceof Error ? error.constructor.name : "UnknownError" });
    return NextResponse.json({ error: "Expert review failed. Retry with the request ID.", code: "EXPERT_REVIEW_FAILED", requestId }, { status: 500 });
  }
}

'''
    else:
        added_imports = '''import { logAction } from "../../../../../lib/audit";
import { extractRequestId } from "../../../../../lib/request-id";
import {
  buildReviewProvenance,
  projectReviewFields,
  publicVaultIdentifier,
} from "../../../../../lib/vault-review-provenance";
'''
        patch = '''export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const requestId = extractRequestId(req);
  await prismaReady;
  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as { action?: string; notes?: string } | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  if (!body.action || !["approve", "reject"].includes(body.action)) {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const record = await prisma.project.findFirst({
    where: { id, companyId: company.id, deletedAt: null },
    select: {
      id: true,
      companyId: true,
      name: true,
      clientName: true,
      country: true,
      sector: true,
      serviceAreas: true,
      contractValue: true,
      currency: true,
      sourceDocumentId: true,
      sourceDocument: {
        select: {
          id: true,
          companyId: true,
          extractedText: true,
          contentSha256: true,
          contentByteLength: true,
          integrityStatus: true,
        },
      },
    },
  });
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isApprove = body.action === "approve";
  const reviewedAt = new Date();
  const ownedSource = record.sourceDocument?.companyId === company.id ? record.sourceDocument : null;
  const provenance = isApprove
    ? buildReviewProvenance({
        recordType: "PROJECT",
        sourceDocument: ownedSource,
        fields: projectReviewFields(record),
        reviewerId: actor.id,
        reviewedAt,
      })
    : null;

  if (provenance && !provenance.ok) {
    return NextResponse.json({
      error: "Project approval requires durable source evidence.",
      code: provenance.code,
      missingEvidenceFields: provenance.missingFields.slice(0, 8),
      requestId,
    }, { status: 422 });
  }

  const durableProvenance = provenance?.ok ? provenance : null;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.project.updateMany({
        where: { id, companyId: company.id, deletedAt: null },
        data: {
          trustLevel: isApprove ? "REVIEWED" : "AI_DRAFT",
          reviewedBy: actor.id,
          reviewedAt,
          reviewNotes: durableProvenance?.serialized ?? (body.notes?.trim() || null),
          updatedAt: new Date(),
        },
      });
      if (result.count !== 1) throw new Error("CONCURRENT_UPDATE");

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "PROJECT_REVIEW",
          entityType: "Project",
          entityId: id,
          description: isApprove
            ? "Project record reviewed with durable source evidence."
            : "Project record returned to draft review state.",
          metadata: JSON.stringify({
            requestId,
            recordRef: publicVaultIdentifier(id),
            action: body.action,
            reviewedAt: reviewedAt.toISOString(),
            ...(durableProvenance ? {
              sourceContentHash: durableProvenance.sourceContentHash,
              sourceByteLength: durableProvenance.sourceByteLength,
              sourceTextHash: durableProvenance.sourceTextHash,
              evidenceFields: durableProvenance.evidenceFields,
            } : {}),
          }),
        },
      });

      return tx.project.findUniqueOrThrow({ where: { id } });
    });
    return NextResponse.json(normalizeProject(updated as unknown as Record<string, unknown>));
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_UPDATE") {
      return NextResponse.json({ error: "Project changed during review. Retry.", code: "CONCURRENT_UPDATE", requestId }, { status: 409 });
    }
    logger.error("project review failed", { requestId, errorClass: error instanceof Error ? error.constructor.name : "UnknownError" });
    return NextResponse.json({ error: "Project review failed. Retry with the request ID.", code: "PROJECT_REVIEW_FAILED", requestId }, { status: 500 });
  }
}

'''
    replace_once(path, import_anchor, added_imports)
    replace_between(path, "export async function PATCH(", "export async function DELETE(", patch)


# ---------------------------------------------------------------------------
# Matching uses the canonical durable-review authority, not a structural gate.
# ---------------------------------------------------------------------------
write("lib/engine/matching-eligibility.ts", '''import {
  canUseVaultRecord,
  type ReviewRecordState,
  type ReviewSourceDocument,
} from "../vault-review-provenance";

export type MatchingEligibilityRecord = {
  id: string;
  companyId?: string | null;
  trustLevel: string | null | undefined;
  sourceDocumentId: string | null | undefined;
  reviewedBy: string | null | undefined;
  reviewedAt: Date | string | null | undefined;
  reviewNotes?: string | null;
  sourceDocument?: (ReviewSourceDocument & { companyId: string }) | null;
  fullName?: string;
  title?: string | null;
  yearsExperience?: number | null;
  disciplines?: unknown;
  sectors?: unknown;
  certifications?: unknown;
  name?: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  serviceAreas?: unknown;
  contractValue?: number | null;
  currency?: string | null;
};

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: EligibilityRejectionCode; detail: string };

export type EligibilityRejectionCode =
  | "NOT_REVIEWED"
  | "NO_SOURCE_DOCUMENT"
  | "NO_REVIEWER"
  | "NO_REVIEW_TIMESTAMP"
  | "NO_DURABLE_PROVENANCE";

export function checkMatchingEligibility(record: MatchingEligibilityRecord): EligibilityResult {
  if (record.trustLevel !== "REVIEWED") {
    return { eligible: false, reason: "NOT_REVIEWED", detail: `trustLevel is "${record.trustLevel ?? "null"}", must be "REVIEWED"` };
  }
  if (!record.sourceDocumentId?.trim()) {
    return { eligible: false, reason: "NO_SOURCE_DOCUMENT", detail: "sourceDocumentId is missing" };
  }
  if (!record.reviewedBy?.trim()) {
    return { eligible: false, reason: "NO_REVIEWER", detail: "reviewedBy is missing" };
  }
  if (!record.reviewedAt || (typeof record.reviewedAt === "string" && !record.reviewedAt.trim())) {
    return { eligible: false, reason: "NO_REVIEW_TIMESTAMP", detail: "reviewedAt is missing" };
  }
  if (!record.companyId || (!record.fullName && !record.name) || !canUseVaultRecord(record as ReviewRecordState, "MATCHING")) {
    return {
      eligible: false,
      reason: "NO_DURABLE_PROVENANCE",
      detail: "review state is not bound to current verified source bytes and current record values",
    };
  }
  return { eligible: true };
}

export function isEligibleForMatching(record: MatchingEligibilityRecord): boolean {
  return checkMatchingEligibility(record).eligible;
}

export function enforceMatchingEligibility(score: number, record: MatchingEligibilityRecord): number {
  return checkMatchingEligibility(record).eligible ? score : 0;
}

export function eligibilityLabel(record: MatchingEligibilityRecord): string {
  const result = checkMatchingEligibility(record);
  return result.eligible ? "Eligible — durably reviewed and grounded" : `Ineligible: ${result.detail}`;
}
''')

replace_once(
    "lib/engine/matching.ts",
    'import { enforceMatchingEligibility } from "./matching-eligibility";',
    'import { checkMatchingEligibility } from "./matching-eligibility";',
)

expert_old = '''      const score = enforceMatchingEligibility(rawScore, {
        id: expert.id,
        trustLevel,
        sourceDocumentId: (expert as { sourceDocumentId?: string | null }).sourceDocumentId ?? null,
        reviewedBy: (expert as { reviewedBy?: string | null }).reviewedBy ?? null,
        reviewedAt: (expert as { reviewedAt?: Date | string | null }).reviewedAt ?? null,
      });'''
expert_new = '''      const matchingEligibility = checkMatchingEligibility({
        id: expert.id,
        companyId: (expert as { companyId?: string }).companyId ?? knowledge.companyId,
        trustLevel,
        sourceDocumentId: (expert as { sourceDocumentId?: string | null }).sourceDocumentId ?? null,
        reviewedBy: (expert as { reviewedBy?: string | null }).reviewedBy ?? null,
        reviewedAt: (expert as { reviewedAt?: Date | string | null }).reviewedAt ?? null,
        reviewNotes: (expert as { reviewNotes?: string | null }).reviewNotes ?? null,
        sourceDocument: (expert as { sourceDocument?: never }).sourceDocument ?? null,
        fullName: expert.fullName,
        title: expert.title,
        yearsExperience: expert.yearsExperience,
        disciplines: expert.disciplines,
        sectors: expert.sectors,
        certifications: expert.certifications,
      });
      const score = matchingEligibility.eligible ? rawScore : 0;'''
replace_once("lib/engine/matching.ts", expert_old, expert_new)
replace_once(
    "lib/engine/matching.ts",
    "      const trustLabel = trustLevelLabel(trustLevel);\n      const thresholdLabel = score >= SELECTION_THRESHOLD ? \"Auto-selected ≥75%.\" : \"Below 75%; review only.\";",
    "      const trustLabel = matchingEligibility.eligible ? trustLevelLabel(trustLevel) : \"⚠ Provenance required\";\n      const thresholdLabel = score >= SELECTION_THRESHOLD ? \"Auto-selected ≥75%.\" : \"Below 75%; review only.\";",
)

project_old = '''      const score = enforceMatchingEligibility(rawScore, {
        id: project.id,
        trustLevel,
        sourceDocumentId: (project as { sourceDocumentId?: string | null }).sourceDocumentId ?? null,
        reviewedBy: (project as { reviewedBy?: string | null }).reviewedBy ?? null,
        reviewedAt: (project as { reviewedAt?: Date | string | null }).reviewedAt ?? null,
      });'''
project_new = '''      const matchingEligibility = checkMatchingEligibility({
        id: project.id,
        companyId: (project as { companyId?: string }).companyId ?? knowledge.companyId,
        trustLevel,
        sourceDocumentId: (project as { sourceDocumentId?: string | null }).sourceDocumentId ?? null,
        reviewedBy: (project as { reviewedBy?: string | null }).reviewedBy ?? null,
        reviewedAt: (project as { reviewedAt?: Date | string | null }).reviewedAt ?? null,
        reviewNotes: (project as { reviewNotes?: string | null }).reviewNotes ?? null,
        sourceDocument: (project as { sourceDocument?: never }).sourceDocument ?? null,
        name: project.name,
        clientName: project.clientName,
        country: project.country,
        sector: project.sector,
        serviceAreas: project.serviceAreas,
        contractValue: project.contractValue,
        currency: project.currency,
      });
      const score = matchingEligibility.eligible ? rawScore : 0;'''
replace_once("lib/engine/matching.ts", project_old, project_new)
# The second identical trust label occurrence belongs to project matching.
replace_once(
    "lib/engine/matching.ts",
    "      const trustLabel = trustLevelLabel(trustLevel);\n      const thresholdLabel = score >= SELECTION_THRESHOLD ? \"Auto-selected ≥75%.\" : \"Below 75%; review only.\";",
    "      const trustLabel = matchingEligibility.eligible ? trustLevelLabel(trustLevel) : \"⚠ Provenance required\";\n      const thresholdLabel = score >= SELECTION_THRESHOLD ? \"Auto-selected ≥75%.\" : \"Below 75%; review only.\";",
)


# ---------------------------------------------------------------------------
# Engine loads source integrity and reports only durably reviewed vault rows as
# usable. Legacy REVIEWED rows without provenance remain explicit blockers.
# ---------------------------------------------------------------------------
replace_once(
    "lib/engine/run-tender-engine.ts",
    'import { REMATCH_TIMEOUT_MS } from "../timeout-config";',
    'import { REMATCH_TIMEOUT_MS } from "../timeout-config";\nimport { isDurablyReviewed } from "../vault-review-provenance";',
)
replace_once(
    "lib/engine/run-tender-engine.ts",
    '''      experts: true,
      projects: true,
      documents: { select: { id: true, category: true, originalFileName: true, extractedText: true } },''',
    '''      experts: {
        include: {
          sourceDocument: {
            select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true },
          },
        },
      },
      projects: {
        include: {
          sourceDocument: {
            select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true },
          },
        },
      },
      documents: { select: { id: true, category: true, originalFileName: true, extractedText: true } },''',
)
replace_once(
    "lib/engine/run-tender-engine.ts",
    '''    const reviewedExperts = company.experts.filter((expert) => expert.trustLevel === "REVIEWED");
    const reviewedProjects = company.projects.filter((project) => project.trustLevel === "REVIEWED");
    const aiDraftExpertCount = company.experts.filter((e) => e.trustLevel === "AI_DRAFT").length;
    const aiDraftProjectCount = company.projects.filter((p) => p.trustLevel === "AI_DRAFT").length;
    const regexDraftExpertCount = company.experts.filter((e) => !e.trustLevel || e.trustLevel === "REGEX_DRAFT").length;
    const regexDraftProjectCount = company.projects.filter((p) => !p.trustLevel || p.trustLevel === "REGEX_DRAFT").length;''',
    '''    const reviewedExperts = company.experts.filter((expert) => isDurablyReviewed(expert));
    const reviewedProjects = company.projects.filter((project) => isDurablyReviewed(project));
    const unsupportedReviewedExpertCount = company.experts.filter((expert) => expert.trustLevel === "REVIEWED" && !isDurablyReviewed(expert)).length;
    const unsupportedReviewedProjectCount = company.projects.filter((project) => project.trustLevel === "REVIEWED" && !isDurablyReviewed(project)).length;
    const aiDraftExpertCount = company.experts.filter((e) => e.trustLevel === "AI_DRAFT").length;
    const aiDraftProjectCount = company.projects.filter((p) => p.trustLevel === "AI_DRAFT").length;
    const regexDraftExpertCount = company.experts.filter((e) => !e.trustLevel || e.trustLevel === "REGEX_DRAFT").length;
    const regexDraftProjectCount = company.projects.filter((p) => !p.trustLevel || p.trustLevel === "REGEX_DRAFT").length;''',
)
replace_once(
    "lib/engine/run-tender-engine.ts",
    '''      reviewedExperts: reviewedExperts.length,
      reviewedProjects: reviewedProjects.length,
      aiDraftExperts: aiDraftExpertCount,''',
    '''      reviewedExperts: reviewedExperts.length,
      reviewedProjects: reviewedProjects.length,
      unsupportedReviewedExperts: unsupportedReviewedExpertCount,
      unsupportedReviewedProjects: unsupportedReviewedProjectCount,
      aiDraftExperts: aiDraftExpertCount,''',
)
replace_once(
    "lib/engine/run-tender-engine.ts",
    '''      hasBlockingExperts: aiDraftExpertCount + regexDraftExpertCount > 0,
      hasBlockingProjects: aiDraftProjectCount + regexDraftProjectCount > 0,''',
    '''      hasBlockingExperts: aiDraftExpertCount + regexDraftExpertCount + unsupportedReviewedExpertCount > 0,
      hasBlockingProjects: aiDraftProjectCount + regexDraftProjectCount + unsupportedReviewedProjectCount > 0,''',
)


# ---------------------------------------------------------------------------
# AI rematch: only durably reviewed candidates enter scoring; scalar/selection
# writes commit atomically, and a persistence failure returns an explicit error.
# ---------------------------------------------------------------------------
replace_once(
    "app/api/tenders/[id]/ai-rematch/route.ts",
    'import { childLogger, time, reportError, logger } from "../../../../../lib/observability";',
    'import { childLogger, time, reportError } from "../../../../../lib/observability";',
)
replace_once(
    "app/api/tenders/[id]/ai-rematch/route.ts",
    'import { sanitizeError } from "../../../../../lib/sanitize-error";',
    'import { sanitizeError } from "../../../../../lib/sanitize-error";\nimport { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT } from "../../../../../lib/vault-review-provenance";',
)
replace_once(
    "app/api/tenders/[id]/ai-rematch/route.ts",
    '''            select: {
              id: true,
              fullName: true,
              title: true,
              yearsExperience: true,
              disciplines: true,
              sectors: true,
              certifications: true,
              profile: true,
              trustLevel: true,
            },''',
    '''            select: {
              ...VAULT_REVIEW_CONSUMER_SELECT.EXPERT,
              id: true,
              profile: true,
            },''',
)
replace_once(
    "app/api/tenders/[id]/ai-rematch/route.ts",
    '''            select: {
              id: true,
              name: true,
              clientName: true,
              country: true,
              sector: true,
              serviceAreas: true,
              summary: true,
              contractValue: true,
              currency: true,
              startDate: true,
              endDate: true,
              trustLevel: true,
            },''',
    '''            select: {
              ...VAULT_REVIEW_CONSUMER_SELECT.PROJECT,
              id: true,
              summary: true,
              startDate: true,
              endDate: true,
            },''',
)
replace_once(
    "app/api/tenders/[id]/ai-rematch/route.ts",
    '  const expertCandidates: ExpertCandidateInput[] = tender.expertMatches.map((match) => ({',
    '  const expertCandidates: ExpertCandidateInput[] = tender.expertMatches\n    .filter((match) => canUseVaultRecord(match.expert, "MATCHING"))\n    .map((match) => ({',
)
replace_once(
    "app/api/tenders/[id]/ai-rematch/route.ts",
    '  const projectCandidates: ProjectCandidateInput[] = tender.projectMatches.map((match) => ({',
    '  const projectCandidates: ProjectCandidateInput[] = tender.projectMatches\n    .filter((match) => canUseVaultRecord(match.project, "MATCHING"))\n    .map((match) => ({',
)
replace_once(
    "app/api/tenders/[id]/ai-rematch/route.ts",
    '''  const userSelectedExpertIds = new Set(
    tender.expertMatches.filter((m) => m.isSelected).map((m) => m.expert.id)
  );
  const userSelectedProjectIds = new Set(
    tender.projectMatches.filter((m) => m.isSelected).map((m) => m.project.id)
  );''',
    '''  const eligibleExpertIds = new Set(expertCandidates.map((candidate) => candidate.id));
  const eligibleProjectIds = new Set(projectCandidates.map((candidate) => candidate.id));
  const userSelectedExpertIds = new Set(
    tender.expertMatches.filter((m) => m.isSelected && eligibleExpertIds.has(m.expert.id)).map((m) => m.expert.id)
  );
  const userSelectedProjectIds = new Set(
    tender.projectMatches.filter((m) => m.isSelected && eligibleProjectIds.has(m.project.id)).map((m) => m.project.id)
  );''',
)

atomic_block = '''  // Persist authoritative match state atomically. Score breakdown rows are
  // derived diagnostics and are written after the authoritative transaction.
  const { writeScoreBreakdown } = await import("../../../../../lib/engine/score-breakdown-writer");
  const expertPersistence = (expertBatchForResponse?.assessments ?? []).flatMap((assessment) => {
    const match = tender.expertMatches.find((candidate) => candidate.expert.id === assessment.candidateId);
    return match ? [{ assessment, match }] : [];
  });
  const projectPersistence = (projectBatchForResponse?.assessments ?? []).flatMap((assessment) => {
    const match = tender.projectMatches.find((candidate) => candidate.project.id === assessment.candidateId);
    return match ? [{ assessment, match }] : [];
  });

  try {
    await prisma.$transaction(async (tx) => {
      for (const { assessment, match } of expertPersistence) {
        await tx.tenderExpertMatch.update({
          where: { id: match.id },
          data: {
            score: assessment.overallScore,
            rationale: formatAssessmentRationale(assessment),
            ...(applySelections ? { isSelected: selectedExpertIds.has(assessment.candidateId) } : {}),
          },
        });
      }
      for (const { assessment, match } of projectPersistence) {
        await tx.tenderProjectMatch.update({
          where: { id: match.id },
          data: {
            score: assessment.overallScore,
            rationale: formatAssessmentRationale(assessment),
            ...(applySelections ? { isSelected: selectedProjectIds.has(assessment.candidateId) } : {}),
          },
        });
      }
      if (applySelections) {
        await tx.tender.update({
          where: { id: tenderId },
          data: {
            status: "COMPLIANCE_REVIEW",
            stage: "COMPLIANCE",
            notes: appendRematchNote(tender.notes, selectedExpertIds.size, selectedProjectIds.size),
          },
        });
      }
    });
  } catch (err) {
    void reportError(err, { tenderId, route: "/api/tenders/[id]/ai-rematch", phase: "persistence" });
    log.error("ai_rematch_persistence_failed", { error: sanitizeError(err) });
    return NextResponse.json({
      error: "AI rematch results could not be committed atomically. No partial selection update was retained.",
      code: "AI_REMATCH_PERSISTENCE_FAILED",
    }, { status: 500 });
  }

  const expertsUpdated = expertPersistence.length;
  const projectsUpdated = projectPersistence.length;
  for (const { assessment } of expertPersistence) {
    const perspectives100 = Object.fromEntries(
      Object.entries(assessment.perspectives).map(([key, value]) => [key, Number(value) * 10]),
    ) as Partial<Record<MatchPerspective, number>>;
    await writeScoreBreakdown({
      tenderId,
      entityType: "EXPERT",
      entityId: assessment.candidateId,
      perspectives: perspectives100,
      rationales: { DISCIPLINE_FIT: assessment.strength?.slice(0, 400), DELIVERY_RISK: assessment.concern?.slice(0, 400) },
      source: "AI_REMATCH",
    });
  }
  for (const { assessment } of projectPersistence) {
    const perspectives100 = Object.fromEntries(
      Object.entries(assessment.perspectives).map(([key, value]) => [key, Number(value) * 10]),
    ) as Partial<Record<MatchPerspective, number>>;
    await writeScoreBreakdown({
      tenderId,
      entityType: "PROJECT",
      entityId: assessment.candidateId,
      perspectives: perspectives100,
      rationales: { DISCIPLINE_FIT: assessment.strength?.slice(0, 400), DELIVERY_RISK: assessment.concern?.slice(0, 400) },
      source: "AI_REMATCH",
    });
  }

'''
replace_between(
    "app/api/tenders/[id]/ai-rematch/route.ts",
    "  // PR XX-G3 — write per-dimension scores",
    "  await logAction({",
    atomic_block,
)
replace_once(
    "app/api/tenders/[id]/ai-rematch/route.ts",
    "      complianceStatePreserved: true,",
    "      complianceStatePreserved: true,\n      persistenceAtomic: true,",
)
replace_once(
    "app/api/tenders/[id]/ai-rematch/route.ts",
    "    complianceStatePreserved: true,",
    "    complianceStatePreserved: true,\n    persistenceAtomic: true,",
)


# ---------------------------------------------------------------------------
# Restore exact 210-baseline scenario inventory while retaining newer routes.
# Current 54 routes + 26 baseline-only scenarios = 80 routes per viewport,
# yielding a 240-screenshot superset.
# ---------------------------------------------------------------------------
replace_once(
    "scripts/capture-production-pages.mjs",
    '''const authenticatedSeeds = Array.from(new Set(routeManifest
  .filter((entry) => entry.authenticated && entry.representativeRoute)
  .map((entry) => entry.representativeRoute)))
  .sort();''',
    '''const authenticatedSeeds = Array.from(new Set(routeManifest
  .filter((entry) => entry.authenticated && entry.representativeRoute)
  .map((entry) => entry.representativeRoute)))
  .sort();

const baselineTenderIds = [
  "45a2d090-af4c-4815-9736-c8b5bbbdf89d",
  "2362d615-c78b-4b01-b420-515c8679d0c2",
  "5cf8ae9b-af8a-4b8d-bcd0-dfaf75b6037c",
];
const baselineTenderStatuses = [
  "ALL", "DRAFT", "INTAKE", "ANALYZED", "AI_ANALYZED", "AI_ANALYSIS_PARTIAL",
  "FALLBACK_DRAFT_CREATED", "ANALYSIS_REQUIRES_REVIEW", "MATCHED", "COMPLIANCE_REVIEW",
  "READY_FOR_GENERATION", "GENERATED", "IN_REVIEW", "APPROVED", "EXPORTED", "CLOSED",
  "REGEX_FALLBACK",
];
const baselineScenarioRoutes = [
  ...baselineTenderIds.flatMap((id) => [
    `/dashboard/tenders/${id}`,
    `/dashboard/tenders/${id}/command-center`,
    `/dashboard/tenders/${id}/report`,
  ]),
  ...baselineTenderStatuses.map((status) => `/dashboard/tenders?status=${status}`),
];''',
)
replace_once(
    "scripts/capture-production-pages.mjs",
    "  const queue = [...authenticatedSeeds];",
    "  const queue = [...authenticatedSeeds, ...baselineScenarioRoutes];",
)

# Seed the three retained baseline tender IDs with distinct workflow states.
seed_path = "scripts/seed-e2e-user.mjs"
seed_text = read(seed_path)
seed_insert = '''
  const baselineTenders = [
    { id: "45a2d090-af4c-4815-9736-c8b5bbbdf89d", title: "Baseline Draft Tender", status: "DRAFT", stage: "INTAKE" },
    { id: "2362d615-c78b-4b01-b420-515c8679d0c2", title: "Baseline Compliance Tender", status: "COMPLIANCE_REVIEW", stage: "COMPLIANCE" },
    { id: "5cf8ae9b-af8a-4b8d-bcd0-dfaf75b6037c", title: "Baseline Approved Tender", status: "APPROVED", stage: "APPROVAL" },
  ];
  for (const fixture of baselineTenders) {
    await prisma.tender.upsert({
      where: { id: fixture.id },
      update: { userId: primaryUser.id, title: fixture.title, status: fixture.status, stage: fixture.stage },
      create: { id: fixture.id, userId: primaryUser.id, title: fixture.title, status: fixture.status, stage: fixture.stage },
    });
  }
'''
anchor = '''  await prisma.tender.upsert({
    where: { id: SECONDARY_TENDER_ID },'''
idx = seed_text.find(anchor)
if idx < 0:
    raise RuntimeError("seed anchor not found")
# Insert after the complete secondary tender upsert block by locating the next '\n  });'.
end_idx = seed_text.find("\n  });", idx)
if end_idx < 0:
    raise RuntimeError("secondary tender upsert end not found")
end_idx += len("\n  });")
seed_text = seed_text[:end_idx] + seed_insert + seed_text[end_idx:]
write(seed_path, seed_text)


# ---------------------------------------------------------------------------
# Tests: canonical matching authority, source-contract regressions and real
# PostgreSQL single-record approval zero-write behavior.
# ---------------------------------------------------------------------------
matching_test = "tests/matching-fail-closed-negative-tests.test.ts"
replace_once(
    matching_test,
    'import { readFileSync } from "node:fs";',
    'import { readFileSync } from "node:fs";\nimport { createHash } from "node:crypto";\nimport { buildReviewProvenance, expertReviewFields } from "../lib/vault-review-provenance";',
)
helper = '''
function durableExpertRecord() {
  const companyId = "company-durable";
  const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
  const sourceText = "Hana Durable is a Structural Engineer with 20 years of experience in Buildings and holds PE certification.";
  const sourceDocument = {
    id: "doc-durable",
    companyId,
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const record = {
    id: "expert-durable",
    companyId,
    fullName: "Hana Durable",
    title: "Structural Engineer",
    yearsExperience: 20,
    disciplines: JSON.stringify(["Structural Engineer"]),
    sectors: JSON.stringify(["Buildings"]),
    certifications: JSON.stringify(["PE"]),
    trustLevel: "REVIEWED",
    sourceDocumentId: sourceDocument.id,
    reviewedBy: "user-durable",
    reviewedAt,
    sourceDocument,
  };
  const provenance = buildReviewProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(record),
    reviewerId: record.reviewedBy,
    reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("durable fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

'''
replace_once(matching_test, "// ─── Gap #1: Irrelevant projects must NOT score high for healthcare ────────\n", helper + "// ─── Gap #1: Irrelevant projects must NOT score high for healthcare ────────\n")
old_eligible = '''  it("fully-grounded REVIEWED record IS eligible for matching", () => {
    const record = {
      id: "expert-6",
      trustLevel: "REVIEWED",
      sourceDocumentId: "doc-1",
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    assert.equal(
      isEligibleForMatching(record),
      true,
      "Fully-grounded REVIEWED record must be eligible",
    );
  });'''
new_eligible = '''  it("durably-grounded REVIEWED record IS eligible for matching", () => {
    assert.equal(
      isEligibleForMatching(durableExpertRecord()),
      true,
      "Only a REVIEWED record bound to current verified source bytes must be eligible",
    );
  });'''
replace_once(matching_test, old_eligible, new_eligible)
old_preserve = '''  it("enforceMatchingEligibility preserves eligible record score", () => {
    const record = {
      id: "expert-8",
      trustLevel: "REVIEWED",
      sourceDocumentId: "doc-1",
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    const score = enforceMatchingEligibility(0.85, record);
    assert.equal(
      score,
      0.85,
      "Eligible record score must be preserved, got " + score,
    );
  });'''
new_preserve = '''  it("enforceMatchingEligibility preserves only a durably reviewed record score", () => {
    const score = enforceMatchingEligibility(0.85, durableExpertRecord());
    assert.equal(score, 0.85, "Durably eligible record score must be preserved, got " + score);
  });'''
replace_once(matching_test, old_preserve, new_preserve)

contract_test = '''import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const expertRoute = readFileSync("app/api/company/experts/[id]/route.ts", "utf8");
const projectRoute = readFileSync("app/api/company/projects/[id]/route.ts", "utf8");
const eligibility = readFileSync("lib/engine/matching-eligibility.ts", "utf8");
const matching = readFileSync("lib/engine/matching.ts", "utf8");
const engine = readFileSync("lib/engine/run-tender-engine.ts", "utf8");
const rematch = readFileSync("app/api/tenders/[id]/ai-rematch/route.ts", "utf8");
const capture = readFileSync("scripts/capture-production-pages.mjs", "utf8");

describe("PR 1175 final gap repair contracts", () => {
  for (const [name, source] of [["expert", expertRoute], ["project", projectRoute]] as const) {
    it(`${name} single approval is fail-closed and atomic`, () => {
      assert.match(source, /contentSha256: true/);
      assert.match(source, /contentByteLength: true/);
      assert.match(source, /integrityStatus: true/);
      assert.match(source, /buildReviewProvenance/);
      assert.match(source, /status: 422/);
      assert.match(source, /prisma\.\$transaction\(async \(tx\)/);
      assert.match(source, /await tx\.auditLog\.create/);
      assert.doesNotMatch(source, /fail-open behavior/);
    });
  }

  it("matching delegates to the durable provenance authority", () => {
    assert.match(eligibility, /canUseVaultRecord/);
    assert.match(eligibility, /NO_DURABLE_PROVENANCE/);
    assert.match(matching, /checkMatchingEligibility/);
    assert.match(matching, /sourceDocument:/);
    assert.match(engine, /isDurablyReviewed/);
    assert.match(engine, /unsupportedReviewedExpertCount/);
  });

  it("AI rematch filters candidates and commits authoritative state atomically", () => {
    assert.match(rematch, /canUseVaultRecord\(match\.expert, "MATCHING"\)/);
    assert.match(rematch, /canUseVaultRecord\(match\.project, "MATCHING"\)/);
    assert.match(rematch, /prisma\.\$transaction\(async \(tx\)/);
    assert.match(rematch, /AI_REMATCH_PERSISTENCE_FAILED/);
    assert.doesNotMatch(rematch, /continuing with remaining assessments/);
  });

  it("screenshot audit is a superset of the retained 210-image baseline", () => {
    assert.match(capture, /baselineScenarioRoutes/);
    assert.match(capture, /REGEX_FALLBACK/);
    assert.match(capture, /45a2d090-af4c-4815-9736-c8b5bbbdf89d/);
    assert.match(capture, /2362d615-c78b-4b01-b420-515c8679d0c2/);
    assert.match(capture, /5cf8ae9b-af8a-4b8d-bcd0-dfaf75b6037c/);
  });
});
'''
write("tests/pr1175-final-gap-repair.test.ts", contract_test)

# Extend real PostgreSQL route test with single-record endpoint behavior.
route_test = "tests/vault-review-route-postgres.test.ts"
replace_once(
    route_test,
    '''  let expertRoute: { PATCH(req: Request): Promise<Response> };
  let projectRoute: { PATCH(req: Request): Promise<Response> };''',
    '''  let expertRoute: { PATCH(req: Request): Promise<Response> };
  let projectRoute: { PATCH(req: Request): Promise<Response> };
  let expertSingleRoute: { PATCH(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> };
  let projectSingleRoute: { PATCH(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> };''',
)
replace_once(
    route_test,
    '''    expertRoute = await import("../app/api/company/experts/batch/route");
    projectRoute = await import("../app/api/company/projects/batch/route");''',
    '''    expertRoute = await import("../app/api/company/experts/batch/route");
    projectRoute = await import("../app/api/company/projects/batch/route");
    expertSingleRoute = await import("../app/api/company/experts/[id]/route");
    projectSingleRoute = await import("../app/api/company/projects/[id]/route");''',
)
single_tests = '''

  it("single expert approval creates durable provenance and audit atomically", async () => {
    const owner = await createWorkspace("ADMIN");
    userIds.push(owner.user.id);
    const source = await createSourceDocument(owner.company.id);
    const expert = await prisma.expert.create({
      data: {
        companyId: owner.company.id,
        fullName: "Hana Route",
        title: "Structural Engineer",
        yearsExperience: 20,
        disciplines: JSON.stringify(["Structural Engineering"]),
        sectors: JSON.stringify(["Buildings"]),
        sourceDocumentId: source.id,
      },
    });
    await authenticate(owner.user.id);
    const response = await expertSingleRoute.PATCH(new Request(`http://localhost/api/company/experts/${expert.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }), { params: Promise.resolve({ id: expert.id }) });
    assert.equal(response.status, 200);
    const reviewed = await prisma.expert.findUniqueOrThrow({
      where: { id: expert.id },
      select: {
        companyId: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true,
        trustLevel: true, reviewedBy: true, reviewedAt: true, reviewNotes: true, sourceDocumentId: true,
        sourceDocument: { select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true } },
      },
    });
    assert.equal(isDurablyReviewed(reviewed), true);
    assert.equal(await prisma.auditLog.count({ where: { userId: owner.user.id, action: "EXPERT_REVIEW", entityId: expert.id } }), 1);
  });

  it("single project approval rejects unverified bytes with zero writes", async () => {
    const owner = await createWorkspace("PROPOSAL_MANAGER");
    userIds.push(owner.user.id);
    const source = await createSourceDocument(owner.company.id, false);
    const project = await prisma.project.create({
      data: {
        companyId: owner.company.id,
        name: "Project Route",
        clientName: "Client Route",
        country: "Ethiopia",
        sector: "Buildings",
        serviceAreas: JSON.stringify(["Structural Engineering"]),
        contractValue: 1000,
        currency: "ETB",
        sourceDocumentId: source.id,
      },
    });
    await authenticate(owner.user.id);
    const response = await projectSingleRoute.PATCH(new Request(`http://localhost/api/company/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }), { params: Promise.resolve({ id: project.id }) });
    assert.equal(response.status, 422);
    const unchanged = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(unchanged.trustLevel, "REGEX_DRAFT");
    assert.equal(unchanged.reviewedAt, null);
    assert.equal(await prisma.auditLog.count({ where: { userId: owner.user.id, action: "PROJECT_REVIEW", entityId: project.id } }), 0);
  });

  it("single approval returns not found for a foreign-company record", async () => {
    const owner = await createWorkspace("REVIEWER");
    const foreign = await createWorkspace("ADMIN");
    userIds.push(owner.user.id, foreign.user.id);
    const source = await createSourceDocument(foreign.company.id);
    const expert = await prisma.expert.create({
      data: { companyId: foreign.company.id, fullName: "Hana Route", sourceDocumentId: source.id },
    });
    await authenticate(owner.user.id);
    const response = await expertSingleRoute.PATCH(new Request(`http://localhost/api/company/experts/${expert.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }), { params: Promise.resolve({ id: expert.id }) });
    assert.equal(response.status, 404);
    const unchanged = await prisma.expert.findUniqueOrThrow({ where: { id: expert.id } });
    assert.equal(unchanged.trustLevel, "REGEX_DRAFT");
  });
'''
text = read(route_test)
last = text.rfind("\n});")
if last < 0:
    raise RuntimeError("vault route test closing marker not found")
write(route_test, text[:last] + single_tests + text[last:])

print("PR 1175 final-gap repair applied")

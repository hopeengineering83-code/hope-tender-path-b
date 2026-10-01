import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { requireRole, forbiddenResponse, unauthorizedResponse, getSession } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../lib/rate-limit";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import {
  buildReviewProvenance,
  buildPartialSourceVerificationProvenance,
  expertReviewFields,
} from "../../../../lib/vault-review-provenance";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function parseBoundedLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}


function toJsonArray(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.filter(Boolean));
  return JSON.stringify(
    String(value || "").split(",").map((v) => v.trim()).filter(Boolean)
  );
}

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function normalizeExpert(e: Record<string, unknown>) {
  return {
    ...e,
    disciplines: safeParseArr(e.disciplines),
    sectors: safeParseArr(e.sectors),
    certifications: safeParseArr(e.certifications),
  };
}

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { searchParams } = new URL(req.url);
  const limit = parseBoundedLimit(searchParams.get("limit"));
  const cursor = searchParams.get("cursor") ?? undefined;
  const trustLevel = searchParams.get("trustLevel") ?? undefined;
  const q = searchParams.get("q") ?? "";

  const company = await ensureCompanyForUser(prisma, userId);

  const experts = await prisma.expert.findMany({
    where: {
      companyId: company.id,
      deletedAt: null,
      ...(trustLevel ? { trustLevel } : {}),
      ...(q ? { OR: [{ fullName: { contains: q } }, { title: { contains: q } }] } : {}),
    },
    orderBy: [{ trustLevel: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: { id: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true, trustLevel: true, createdAt: true },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = experts.length > limit;
  const items = hasMore ? experts.slice(0, limit) : experts;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items: items.map(normalizeExpert), nextCursor, hasMore });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`expert-create:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many expert creation requests. Wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  }

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, actor.id);

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    if (!body.fullName || String(body.fullName).trim().length < 2) {
      return NextResponse.json({ error: "fullName is required" }, { status: 400 });
    }
    const yearsExp = body.yearsExperience != null ? Number(body.yearsExperience) : null;
    if (yearsExp !== null && (yearsExp < 0 || yearsExp > 70)) {
      return NextResponse.json({ error: "yearsExperience must be between 0 and 70" }, { status: 400 });
    }
    // Optional sourceDocumentId — when the user supplies it, the new Expert
    // row is audit-traceable to the uploaded CompanyDocument it was derived
    // from. Earlier the field was never set on manual creation, so manually
    // entered experts had no provenance link back to their source CV.
    let sourceDocumentId: string | null = null;
    if (typeof body.sourceDocumentId === "string" && body.sourceDocumentId.trim()) {
      const docId = body.sourceDocumentId.trim();
      // Validate that the document exists AND belongs to the same company —
      // prevents cross-tenant provenance injection.
      const doc = await prisma.companyDocument.findFirst({
        where: { id: docId, companyId: company.id },
        select: { id: true },
      });
      if (!doc) {
        return NextResponse.json({ error: "sourceDocumentId does not reference a document in your Company Vault." }, { status: 400 });
      }
      sourceDocumentId = doc.id;
    }
    // ── Review state must be EARNED, never asserted on creation ──────────
    //
    // This route previously wrote trustLevel REVIEWED with reviewedBy,
    // reviewedAt and the free-text note "Manual expert record created by
    // authenticated user." That is precisely the state the authority model
    // forbids: PATCH /api/company/experts/{id} says so in its own words —
    // "Source-less auto-approval is forbidden. When no verified source exists,
    // the record stays UNVERIFIED — never REVIEWED, never reviewedBy, never
    // reviewedAt, never a fabricated 'manual' hash."
    //
    // isDurablyReviewed() re-parses reviewNotes as structured provenance and
    // rejects anything else, so those records read as REVIEWED in the vault
    // list while canUseVaultRecordSafely() refused them forever. Generation
    // then failed with "No verified, source-backed experts are available" and
    // advised uploading or reprocessing source documents — which cannot fix a
    // record whose review state was never verifiable in the first place.
    //
    // The create path now applies the same ladder as the approve path:
    // full provenance → REVIEWED; identity-only verification →
    // SOURCE_VERIFIED with no reviewer identity; otherwise AI_DRAFT, honestly
    // unverified and reported as such.
    const reviewedAt = new Date();
    const sourceDocument = sourceDocumentId
      ? await prisma.companyDocument.findFirst({
          where: { id: sourceDocumentId, companyId: company.id },
          select: {
            id: true,
            companyId: true,
            extractedText: true,
            contentSha256: true,
            contentByteLength: true,
            integrityStatus: true,
            metadata: true,
          },
        })
      : null;

    const candidateFields = {
      fullName: String(body.fullName).trim(),
      title: body.title || null,
      yearsExperience: yearsExp,
      disciplines: toJsonArray(body.disciplines),
      sectors: toJsonArray(body.sectors),
      certifications: toJsonArray(body.certifications),
    };

    const durable = sourceDocument
      ? buildReviewProvenance({
          recordType: "EXPERT",
          sourceDocument,
          fields: expertReviewFields(candidateFields),
          reviewerId: actor.id,
          reviewedAt,
        })
      : null;

    const partial = !durable?.ok && sourceDocument
      ? buildPartialSourceVerificationProvenance({
          recordType: "EXPERT",
          sourceDocument,
          fields: expertReviewFields(candidateFields),
          verificationMethod: "HYBRID",
          verifiedAt: reviewedAt,
        })
      : null;

    const reviewState = durable?.ok
      ? { trustLevel: "REVIEWED", reviewedBy: actor.id, reviewedAt, reviewNotes: durable.serialized }
      : partial?.ok
        ? { trustLevel: "SOURCE_VERIFIED", reviewedBy: null, reviewedAt: null, reviewNotes: partial.serialized }
        : {
            trustLevel: "MANUAL_DRAFT",
            reviewedBy: null,
            reviewedAt: null,
            reviewNotes: "Manual expert record awaiting automatic source verification. Uploaded Company Vault documents are the official source of truth.",
          };

    const expert = await prisma.expert.create({
      data: {
        companyId: company.id,
        fullName: candidateFields.fullName,
        title: body.title || null,
        email: body.email || null,
        phone: body.phone || null,
        yearsExperience: yearsExp,
        disciplines: candidateFields.disciplines,
        sectors: candidateFields.sectors,
        certifications: candidateFields.certifications,
        profile: body.profile || null,
        ...reviewState,
        sourceDocumentId,
      },
    });

    await logAction({
      userId: actor.id,
      action: "EXPERT_CREATE",
      entityType: "Expert",
      entityId: expert.id,
      description: `Expert "${expert.fullName}" created`,
      metadata: { expertId: expert.id, fullName: expert.fullName, companyId: company.id },
    });

    return NextResponse.json(normalizeExpert(expert as unknown as Record<string, unknown>), { status: 201 });
  } catch (error) {
    logger.error("Request failed", { detail: error });
    return NextResponse.json({ error: "Failed to create expert" }, { status: 500 });
  }
}

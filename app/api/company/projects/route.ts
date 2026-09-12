import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { requireRole, forbiddenResponse, unauthorizedResponse, getSession } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../lib/rate-limit";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { resolveProjectCountry } from "../../../../lib/engine/country-reference";
import { extractProjectFacts, mergeProjectFacts } from "../../../../lib/engine/project-fact-extractor";
import {
  buildReviewProvenance,
  buildPartialSourceVerificationProvenance,
  projectReviewFields,
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

function normalizeProject(p: Record<string, unknown>) {
  return { ...p, serviceAreas: safeParseArr(p.serviceAreas) };
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

  const projects = await prisma.project.findMany({
    where: {
      companyId: company.id,
      deletedAt: null,
      ...(trustLevel ? { trustLevel } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { clientName: { contains: q } }, { sector: { contains: q } }] } : {}),
    },
    orderBy: [{ trustLevel: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: { id: true, name: true, clientName: true, country: true, sector: true, serviceAreas: true, trustLevel: true, createdAt: true },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = projects.length > limit;
  const items = hasMore ? projects.slice(0, limit) : projects;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items: items.map(normalizeProject), nextCursor, hasMore });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`project-create:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many project creation requests. Wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  }

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, actor.id);

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    if (!body.name || String(body.name).trim().length < 2) {
      return NextResponse.json({ error: "Project name is required (min 2 characters)" }, { status: 400 });
    }
    const contractValue = body.contractValue ? Number(body.contractValue) : null;
    if (contractValue !== null && (!Number.isFinite(contractValue) || contractValue < 0 || contractValue > 1e12)) {
      return NextResponse.json({ error: "contractValue must be a finite non-negative number up to 1,000,000,000,000" }, { status: 400 });
    }
    // Optional sourceDocumentId — when the user supplies it, the new Project
    // row is audit-traceable to the uploaded CompanyDocument (testimony
    // letter, contract, etc.) it was derived from. Earlier the field was
    // never set on manual creation, so manually entered projects had no
    // provenance link back to their source document.
    let sourceDocumentId: string | null = null;
    if (typeof body.sourceDocumentId === "string" && body.sourceDocumentId.trim()) {
      const docId = body.sourceDocumentId.trim();
      const doc = await prisma.companyDocument.findFirst({
        where: { id: docId, companyId: company.id },
        select: { id: true },
      });
      if (!doc) {
        return NextResponse.json({ error: "sourceDocumentId does not reference a document in your Company Vault." }, { status: 400 });
      }
      sourceDocumentId = doc.id;
    }
    // Same rule as the expert create path and PATCH
    // /api/company/projects/{id}: a review state is earned from a verified
    // source document, never asserted at creation. Writing REVIEWED with a
    // free-text note produced records the authority model rejects forever, so
    // generation reported "No verified, source-backed projects are available"
    // for projects the vault listed as reviewed.
    const projectReviewedAt = new Date();
    const projectSourceDocument = sourceDocumentId
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

    // DERIVED FACTS ARE PART OF THE RECORD BEING VERIFIED.
    //
    // These used to be extracted after the row was created and written in a
    // second update, which quietly un-verified the record it was enriching.
    // Durable source verification is a claim about a SET of fields, and
    // provenanceMatchesCurrentRecord refuses a record that has GROWN since —
    // and normalizedEvidenceFields drops empty values, so a project created
    // with contractValue, currency or country blank was verified without them
    // and then failed verification the moment the extractor filled them in.
    // Observed on the live vault through the bulk path, which had the same
    // shape. Deriving first means what gets written is what gets proved.
    const derivedCandidateFacts = (() => {
      const summary = typeof body.summary === "string" ? body.summary : "";
      if (summary.trim().length <= 50) return {} as Record<string, unknown>;
      try {
        return mergeProjectFacts(
          {
            clientName: body.clientName || null,
            country: body.country || null,
            sector: body.sector || null,
            contractValue,
            currency: body.currency || null,
          },
          extractProjectFacts(summary, String(body.name).trim()),
        ) as Record<string, unknown>;
      } catch (extractErr) {
        logger.warn("[project-fact-extractor] pre-create extraction failed:", {
          detail: extractErr instanceof Error ? extractErr.message : extractErr,
        });
        return {} as Record<string, unknown>;
      }
    })();

    const candidateCountry = (() => {
      const stored = (derivedCandidateFacts.country as string | undefined) ?? body.country ?? null;
      const resolution = resolveProjectCountry({
        storedCountry: stored,
        sourceText: typeof body.summary === "string" ? body.summary : null,
      });
      return resolution.shouldWrite ? resolution.country : stored || null;
    })();

    const projectCandidateFields = {
      name: String(body.name).trim(),
      clientName: (derivedCandidateFacts.clientName as string | undefined) ?? body.clientName ?? null,
      country: candidateCountry,
      sector: (derivedCandidateFacts.sector as string | undefined) ?? body.sector ?? null,
      serviceAreas: toJsonArray(body.serviceAreas),
      contractValue: (derivedCandidateFacts.contractValue as number | undefined) ?? contractValue,
      currency: (derivedCandidateFacts.currency as string | undefined) ?? body.currency ?? null,
    };

    const projectDurable = projectSourceDocument
      ? buildReviewProvenance({
          recordType: "PROJECT",
          sourceDocument: projectSourceDocument,
          fields: projectReviewFields(projectCandidateFields),
          reviewerId: actor.id,
          reviewedAt: projectReviewedAt,
        })
      : null;

    const projectPartial = !projectDurable?.ok && projectSourceDocument
      ? buildPartialSourceVerificationProvenance({
          recordType: "PROJECT",
          sourceDocument: projectSourceDocument,
          fields: projectReviewFields(projectCandidateFields),
          verificationMethod: "HYBRID",
          verifiedAt: projectReviewedAt,
        })
      : null;

    const projectReviewState = projectDurable?.ok
      ? { trustLevel: "REVIEWED", reviewedBy: actor.id, reviewedAt: projectReviewedAt, reviewNotes: projectDurable.serialized }
      : projectPartial?.ok
        ? { trustLevel: "SOURCE_VERIFIED", reviewedBy: null, reviewedAt: null, reviewNotes: projectPartial.serialized }
        : {
            trustLevel: "MANUAL_DRAFT",
            reviewedBy: null,
            reviewedAt: null,
            reviewNotes: "Manual project record awaiting automatic source verification. Uploaded Company Vault documents are the official source of truth.",
          };

    const project = await prisma.project.create({
      data: {
        companyId: company.id,
        // The verified field set, written verbatim. A second, different set of
        // values here is how the provenance and the row drift apart.
        name: projectCandidateFields.name,
        clientName: projectCandidateFields.clientName,
        country: projectCandidateFields.country,
        sector: projectCandidateFields.sector,
        serviceAreas: projectCandidateFields.serviceAreas,
        summary: body.summary || null,
        contractValue: projectCandidateFields.contractValue,
        currency: projectCandidateFields.currency,
        ...(derivedCandidateFacts.startDate ? { startDate: derivedCandidateFacts.startDate as Date } : {}),
        ...(derivedCandidateFacts.endDate ? { endDate: derivedCandidateFacts.endDate as Date } : {}),
        ...projectReviewState,
        sourceDocumentId,
      },
    });

    // No second write here on purpose. Deriving the facts after creation and
    // patching them in is what made the record grow past its own provenance;
    // the derivation now happens above, inside the field set that gets verified.

    const refreshed = await prisma.project.findUnique({ where: { id: project.id } });

    await logAction({
      userId: actor.id,
      action: "PROJECT_CREATE",
      entityType: "Project",
      entityId: project.id,
      description: `Project "${project.name}" created`,
      metadata: { projectId: project.id, name: project.name, companyId: company.id },
    });

    return NextResponse.json(normalizeProject((refreshed ?? project) as unknown as Record<string, unknown>), { status: 201 });
  } catch (error) {
    logger.error("Request failed", { detail: error });
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}

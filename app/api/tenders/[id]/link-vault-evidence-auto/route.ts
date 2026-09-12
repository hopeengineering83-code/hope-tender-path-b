import { NextResponse } from "next/server";
import { forbiddenResponse, requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { includeVaultDocumentInPackage, INCLUDABLE_VAULT_DOCUMENT_WHERE } from "../../../../../lib/engine/vault-document-package-inclusion";
import { getStorageAdapter } from "../../../../../lib/storage";
import { getCanonicalReadinessSummary } from "../../../../../lib/canonical-tender-readiness";

export const dynamic = "force-dynamic";

const mapCats = (s: string) => { const t = s.toLowerCase(); if (/financial|audited|bank|turnover|capacity/.test(t)) return ["FINANCIAL_STATEMENT"]; if (/legal|license|tax|vat|tin|registration|cert/.test(t)) return ["LEGAL_REGISTRATION", "CERTIFICATION"]; if (/profile|capability/.test(t)) return ["COMPANY_PROFILE"]; if (/manual|policy|quality|safeguard|compliance/.test(t)) return ["MANUAL", "COMPLIANCE_RECORD"]; if (/cv|personnel|expert/.test(t)) return ["EXPERT_CV"]; if (/project|reference|experience|contract/.test(t)) return ["PROJECT_REFERENCE", "PROJECT_CONTRACT"]; return []; };
const scoreOption = (rowName: string, category: string, fileName: string) => { let score = 0; const label = `${rowName} ${fileName}`.toLowerCase(); if (label.includes(category.toLowerCase().replace(/_/g, " "))) score += 2; if (/audited|financial|tax|vat|tin|legal|license|cv|project|reference/.test(label)) score += 1; if (rowName.toLowerCase() === fileName.toLowerCase()) score += 3; return score; };

/**
 * POST /api/tenders/[id]/link-vault-evidence-auto
 *
 * Includes the highest-scored official Vault document in each eligible package
 * row in a single request. Equivalent to calling GET link-vault-evidence
 * (fetch candidates) then POST link-vault-evidence (include each best option)
 * in a loop — consolidated here so the recovery action can treat it as a plain
 * "api" action instead of custom code.
 *
 * ADMIN only, like the single-document route: this places unchanged official
 * company documents into a package that goes to a client.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`link-vault-auto:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json(
    { error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
    { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
  );

  await prismaReady;
  const { id } = await params;

  const [tender, company] = await Promise.all([
    prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: {
        generatedDocuments: {
          where: { generationStatus: { not: "SUPERSEDED" }, reviewStatus: { in: ["REPLACE_WITH_ORIGINAL", "PENDING", "CHANGES_REQUESTED"] } },
          select: { id: true, name: true, exactFileName: true, documentType: true, reviewStatus: true, fileContent: true, storagePath: true, format: true },
        },
      },
    }),
    prisma.company.findUnique({ where: { userId: actor.id }, select: { id: true } }),
  ]);

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  if (!company) return NextResponse.json({
    error: "Company profile not found. Set up your company profile in the Company section before linking vault evidence.",
    code: "COMPANY_NOT_FOUND",
    nextAction: "OPEN_COMPANY_READINESS",
  }, { status: 422 });

  // Only documents inclusion can actually accept, filtered in the query so the
  // base64 blobs are never loaded just to build a candidate list.
  const vault = await prisma.companyDocument.findMany({
    where: { companyId: company.id, ...INCLUDABLE_VAULT_DOCUMENT_WHERE },
    select: { id: true, fileName: true, category: true },
  });

  const candidates = tender.generatedDocuments.map((row) => {
    const cats = mapCats(`${row.exactFileName ?? row.name} ${row.documentType ?? ""}`);
    const options = vault
      .filter((v) => cats.includes(v.category))
      .map((v) => ({ ...v, score: scoreOption(row.exactFileName ?? row.name, v.category, v.fileName) }))
      .sort((a, b) => b.score - a.score);
    return { row, cats, options };
  }).filter((x) => x.options.length > 0);

  if (candidates.length === 0) {
    // Three different situations used to share one message, and it named the
    // remedy for only one of them. Running this before generation — when the
    // tender has no document rows at all — answered "No reviewed evidence
    // available in the Knowledge Vault ... Add expert CVs, project references
    // ..." to an owner whose vault held six verified documents. Following that
    // advice could not help, because the vault was never the problem.
    const awaitingOriginals = tender.generatedDocuments.length;
    const { message, nextAction } = awaitingOriginals === 0
      ? {
        message: "This tender has no document rows awaiting an official original yet, so there is nothing to attach Vault documents to. The post-Engine workflow generates them; retry once it has.",
        // AUTOMATIC_PROCESSING, not an invented GENERATE_DOCUMENTS: generation
        // is owned by the durable workflow and there is no owner-facing
        // generate action for the UI to offer.
        nextAction: "AUTOMATIC_PROCESSING",
      }
      : vault.length === 0
        ? {
          message: "No Company Vault document has verified stored bytes, so none can be placed in the package. Upload the official company documents (licence, tax clearance, audited statements, CVs, project references) to the Company Vault, then retry.",
          nextAction: "OPEN_COMPANY_READINESS",
        }
        : {
          message: `None of the ${vault.length} verified Vault document(s) matches the category of the ${awaitingOriginals} document(s) awaiting an original on this tender. Upload an official document in the required category, then retry.`,
          nextAction: "OPEN_COMPANY_READINESS",
        };

    return NextResponse.json({
      success: true,
      linked: 0,
      skipped: 0,
      blockedReasons: [],
      documentsAwaitingOriginal: awaitingOriginals,
      verifiedVaultDocuments: vault.length,
      message,
      nextAction,
    });
  }

  // Idempotency no longer needs a time window. Inclusion is itself idempotent:
  // re-running writes the same verified bytes and the same digest, and a row
  // that already holds them is skipped outright. The old five-minute guard
  // existed only to stop duplicate DocumentReview rows piling up — and those
  // rows should never have been written in the first place, since including a
  // file is not reviewing it.
  const alreadyIncluded = new Set(
    (await prisma.generatedDocument.findMany({
      where: {
        id: { in: candidates.map((c) => c.row.id) },
        reviewNotes: { startsWith: "machine:vault-document-inclusion" },
      },
      select: { id: true },
    })).map((doc) => doc.id),
  );

  let linked = 0;
  let skipped = 0;
  const blockedReasons: string[] = [];

  for (const { row, options } of candidates) {
    const best = options[0];
    if (!best) { skipped++; continue; }
    if (alreadyIncluded.has(row.id)) { skipped++; continue; }

    // Same inclusion authority as the single-document route: verified bytes
    // only, copied unchanged, digests computed from what was actually written.
    // A document that cannot be included that way is skipped with its reason
    // rather than filled with an approximation.
    const outcome = await includeVaultDocumentInPackage({
      client: prisma,
      storage: getStorageAdapter(),
      tenderId: id,
      userId: actor.id,
      documentId: row.id,
      vaultDocumentId: best.id,
    });

    if (!outcome.included) {
      blockedReasons.push(outcome.reason);
      skipped++;
      continue;
    }

    await logAction({
      userId: actor.id,
      action: "VAULT_EVIDENCE_LINKED",
      entityType: "GeneratedDocument",
      entityId: row.id,
      description: `Official Vault document included unchanged: ${outcome.vaultFileName} → ${row.exactFileName ?? row.name}. Awaiting validation and approval.`,
      metadata: { tenderId: id, packageDocId: row.id, vaultDocId: outcome.vaultDocumentId, vaultFileName: outcome.vaultFileName, sha256: outcome.sha256, byteLength: outcome.byteLength },
    });

    linked++;
  }

  // Never say "ready for export" here. An included document is real official
  // bytes awaiting canonical validation and an approver — claiming otherwise
  // is the kind of confident-but-wrong status the export gate then contradicts.
  const message =
    linked === 0
      ? blockedReasons.length > 0
        ? `No official Vault documents could be included: ${blockedReasons[0]}`
        : "No official Vault documents were available to include for this tender's package rows."
      : `${linked} official Vault document(s) included unchanged. They still need canonical validation and approval before final export.`;

  // Gap 4: re-query the canonical final-export authority after the mutation.
  const canonicalReadiness = await getCanonicalReadinessSummary(prisma, actor.id, id);
  return NextResponse.json({ success: true, linked, skipped, blockedReasons, message, canonicalReadiness });
}

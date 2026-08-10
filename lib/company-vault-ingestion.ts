import { prisma, prismaReady } from "./prisma";
import { shouldScanForExperts, shouldScanForProjects } from "./company-document-classifier";
import {
  extractCompanyKnowledgeWithAI,
  isCompanyKnowledgeAIEnabled,
  type AIExpertDraft,
  type AIProjectDraft,
} from "./company-knowledge-ai";
import {
  collectDeterministicCandidates,
  persistCompanyKnowledgeCandidates,
  type CompanyExpertCandidate,
  type CompanyProjectCandidate,
} from "./company-knowledge-safety-import";
import { autoVerifyCompanyKnowledge } from "./company-auto-verification";
import { COMPANY_DOCUMENT_PENDING_DELETE_MARKER } from "./company-document-durable-deletion";
import { remapUnlinkedVaultSources } from "./company-vault-source-remap";
import { reconcileCompanyDocumentByteIntegrity } from "./company-document-byte-integrity-reconcile";
import { sanitizeError } from "./sanitize-error";

const DEDICATED_EXPERT_CATEGORIES = new Set(["EXPERT_CV"]);
const DEDICATED_PROJECT_CATEGORIES = new Set(["PROJECT_REFERENCE", "PROJECT_CONTRACT", "PORTFOLIO"]);

export type VaultDocument = {
  id: string;
  originalFileName: string;
  category: string;
  mimeType: string;
  extractedText: string | null;
  integrityStatus: string;
};

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function usableDocument(document: VaultDocument): boolean {
  const text = document.extractedText?.trim() ?? "";
  return document.integrityStatus === "VERIFIED" &&
    text.length >= 100 &&
    !/^\[(Scanned PDF|Extraction failed)/i.test(text);
}

function hasExpertEvidence(document: VaultDocument): boolean {
  return shouldScanForExperts(document.originalFileName, document.category, document.extractedText);
}

function hasProjectEvidence(document: VaultDocument): boolean {
  return shouldScanForProjects(document.originalFileName, document.category, document.extractedText);
}

function sourceAuthority(document: VaultDocument, kind: "EXPERT" | "PROJECT"): number {
  if (kind === "EXPERT" && DEDICATED_EXPERT_CATEGORIES.has(document.category)) return 3;
  if (kind === "PROJECT" && DEDICATED_PROJECT_CATEGORIES.has(document.category)) return 3;
  return 2;
}

type QuoteBindingCandidate = {
  document: VaultDocument;
  quoteStrength: 1 | 2;
  authority: number;
};

/**
 * Bind an AI-returned source quote to exactly one owned document without ever
 * using database/list order as authority. The quote match itself is mandatory;
 * among matching documents a dedicated CV/project source outranks a generic
 * profile/summary. If the strongest candidates are genuinely tied, return
 * null and leave the draft unpersisted rather than attaching unverifiable
 * provenance to whichever row Prisma happened to return first.
 */
export function resolveQuotedSourceDocument(
  documents: VaultDocument[],
  sourceQuote: string,
  kind: "EXPERT" | "PROJECT",
): VaultDocument | null {
  const quote = normalizedText(sourceQuote);
  if (quote.length < 10) return null;
  const bounded = quote.slice(0, Math.min(160, quote.length));

  const candidates: QuoteBindingCandidate[] = [];
  for (const document of documents) {
    const text = normalizedText(document.extractedText ?? "");
    if (!text) continue;
    const exact = text.includes(quote);
    const boundedMatch = !exact && bounded.length >= 40 && text.includes(bounded);
    if (!exact && !boundedMatch) continue;
    candidates.push({
      document,
      quoteStrength: exact ? 2 : 1,
      authority: sourceAuthority(document, kind),
    });
  }

  candidates.sort((a, b) =>
    b.quoteStrength - a.quoteStrength ||
    b.authority - a.authority,
  );
  if (candidates.length === 0) return null;
  const best = candidates[0];
  const tied = candidates[1] &&
    candidates[1].quoteStrength === best.quoteStrength &&
    candidates[1].authority === best.authority;
  return tied ? null : best.document;
}

function expertCandidate(draft: AIExpertDraft, document: VaultDocument): CompanyExpertCandidate {
  return {
    fullName: draft.fullName,
    title: draft.title ?? null,
    yearsExperience: draft.yearsExperience ?? null,
    disciplines: draft.disciplines ?? [],
    sectors: draft.sectors ?? [],
    certifications: draft.certifications ?? [],
    profile: `AI extraction from ${document.originalFileName}.`,
    sourceSnippet: draft.sourceQuote,
    sourceDocumentId: document.id,
    sourceAuthority: sourceAuthority(document, "EXPERT"),
    trustLevel: "AI_DRAFT",
  };
}

function projectCandidate(draft: AIProjectDraft, document: VaultDocument): CompanyProjectCandidate {
  return {
    name: draft.name,
    clientName: draft.clientName ?? null,
    country: draft.country ?? null,
    sector: draft.sector ?? null,
    serviceAreas: draft.serviceAreas ?? [],
    summary: draft.summary || `AI extraction from ${document.originalFileName}.`,
    contractValue: draft.contractValue ?? null,
    currency: draft.currency ?? null,
    sourceSnippet: draft.sourceQuote,
    sourceDocumentId: document.id,
    sourceAuthority: sourceAuthority(document, "PROJECT"),
    trustLevel: "AI_DRAFT",
  };
}

function promptText(documents: VaultDocument[]): string {
  return documents.map((document) =>
    `[SOURCE FILE: ${document.originalFileName}; CATEGORY: ${document.category}; MIME: ${document.mimeType}]\n${document.extractedText}`,
  ).join("\n\n--- NEXT OWNED SOURCE DOCUMENT ---\n\n");
}

export type CompanyVaultIngestionResult = {
  status: "SUCCEEDED" | "PARTIAL_SUCCESS";
  docsProcessed: number;
  aiUsed: boolean;
  aiFailures: number;
  warnings: string[];
  expertsCreated: number;
  projectsCreated: number;
  expertsUpdated: number;
  projectsUpdated: number;
  deterministicCandidates: { experts: number; projects: number };
  aiCandidates: { experts: number; projects: number };
  sourceRemap: Awaited<ReturnType<typeof remapUnlinkedVaultSources>>;
  sourceVerification: Awaited<ReturnType<typeof autoVerifyCompanyKnowledge>>;
};

export async function ingestCompanyVault(companyId: string): Promise<CompanyVaultIngestionResult> {
  await prismaReady;

  const documents = await prisma.companyDocument.findMany({
    where: {
      companyId,
      NOT: { metadata: { contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER } },
    },
    select: {
      id: true,
      originalFileName: true,
      category: true,
      mimeType: true,
      extractedText: true,
      integrityStatus: true,
    },
  });
  const usable = documents.filter(usableDocument);
  const deterministic = collectDeterministicCandidates(usable);

  const warnings: string[] = [];
  const aiExperts: CompanyExpertCandidate[] = [];
  const aiProjects: CompanyProjectCandidate[] = [];
  const aiUsed = isCompanyKnowledgeAIEnabled();
  let aiFailures = 0;

  if (aiUsed) {
    const expertDocuments = usable.filter(hasExpertEvidence);
    const projectDocuments = usable.filter(hasProjectEvidence);
    try {
      const extraction = await extractCompanyKnowledgeWithAI({
        expertText: promptText(expertDocuments),
        projectText: promptText(projectDocuments),
      });
      warnings.push(...extraction.warnings);
      aiFailures += extraction.warnings.filter((warning) => /failed/i.test(warning)).length;

      for (const draft of extraction.experts) {
        const source = resolveQuotedSourceDocument(expertDocuments, draft.sourceQuote, "EXPERT");
        if (!source) {
          warnings.push(`An expert candidate was not persisted because its source quote did not bind unambiguously to one strongest owned document.`);
          continue;
        }
        aiExperts.push(expertCandidate(draft, source));
      }
      for (const draft of extraction.projects) {
        const source = resolveQuotedSourceDocument(projectDocuments, draft.sourceQuote, "PROJECT");
        if (!source) {
          warnings.push(`A project candidate was not persisted because its source quote did not bind unambiguously to one strongest owned document.`);
          continue;
        }
        aiProjects.push(projectCandidate(draft, source));
      }
    } catch (error) {
      aiFailures += 1;
      warnings.push(`AI extraction was unavailable; deterministic ingestion completed instead (${sanitizeError(error)}).`);
    }
  } else {
    warnings.push("AI extraction was unavailable; deterministic ingestion completed.");
  }

  const persisted = await persistCompanyKnowledgeCandidates(prisma, companyId, {
    experts: [...deterministic.experts, ...aiExperts],
    projects: [...deterministic.projects, ...aiProjects],
  });
  // Backfills sourceDocumentId for drafts that already have a bona fide
  // owned document (for example, Plan-B legacy-data imports that persist
  // uploaded documents but do not always declare which one produced each
  // record) before running the same source-verification pass that already
  // covers freshly-ingested candidates.
  // Documents that were persisted before byte integrity was computed are
  // invisible to the remapper, which accepts VERIFIED sources only. Establish
  // that baseline from the stored bytes first so legacy vaults reconcile
  // automatically instead of reporting zero verified records forever.
  await reconcileCompanyDocumentByteIntegrity(companyId);
  const sourceRemap = await remapUnlinkedVaultSources(companyId);
  const sourceVerification = await autoVerifyCompanyKnowledge(companyId);

  const failedDocumentIds = new Set<string>();
  if (aiFailures > 0) {
    for (const document of usable.filter((item) => hasExpertEvidence(item) || hasProjectEvidence(item))) {
      failedDocumentIds.add(document.id);
    }
  }
  await prisma.$transaction(usable.map((document) => prisma.companyDocument.update({
    where: { id: document.id },
    data: {
      aiExtractionStatus: aiUsed
        ? failedDocumentIds.has(document.id) ? "FAILED" : "EXTRACTED"
        : "PENDING",
      aiExtractedAt: aiUsed && !failedDocumentIds.has(document.id) ? new Date() : null,
      aiExtractionError: failedDocumentIds.has(document.id)
        ? "AI knowledge extraction failed; deterministic ingestion completed."
        : null,
    },
  })));

  return {
    status: aiFailures > 0 ? "PARTIAL_SUCCESS" : "SUCCEEDED",
    docsProcessed: usable.length,
    aiUsed,
    aiFailures,
    warnings,
    ...persisted,
    deterministicCandidates: {
      experts: deterministic.experts.length,
      projects: deterministic.projects.length,
    },
    aiCandidates: { experts: aiExperts.length, projects: aiProjects.length },
    sourceRemap,
    sourceVerification,
  };
}
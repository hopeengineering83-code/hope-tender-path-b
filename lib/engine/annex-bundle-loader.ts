/**
 * Loads what planAnnexBundle needs for one tender: its requirements, the
 * owner's Company Vault documents, and the experts and projects the engine
 * selected. Shared by AUTO_FINALIZE (which binds the originals) and the
 * readiness gate (which refuses a combined file that lacks them), so both ask
 * the same question of the same rows.
 */

import { prisma as defaultPrisma } from "../prisma";
import { COMPANY_DOCUMENT_PENDING_DELETE_MARKER } from "../company-document-durable-deletion";
import { getStorageAdapter } from "../storage";
import { requireVerifiedPersistedFileBytes } from "./persisted-byte-integrity";
import { statedSingleSubmissionFile } from "./single-submission-file-rule";
import { parseStringArray } from "./submission-plan";
import { planAnnexBundle, type AnnexBundlePlan, type AnnexVaultDocument } from "./annex-bundle";

// "a single electronic PDF file named 'Technical Proposal.pdf' containing all
// required sections and annexes" — one PDF that must CONTAIN the annexes.
// A dot inside a word ("Technical Proposal.pdf") does not end the sentence.
const IN_SENTENCE = String.raw`(?:[^.;]|\.(?=\w))`;
const CONTAINS_ANNEXES = new RegExp(String.raw`\b(?:single|one)\b${IN_SENTENCE}{0,60}\b(?:pdf|file|document)\b${IN_SENTENCE}{0,160}\b(?:contain\w*|includ\w*|incorporat\w*|with)\b${IN_SENTENCE}{0,80}\b(?:annex\w*|attachments?|appendi\w*|supporting\s+documents?)`, "i");

/** The one file the tender says must hold the whole submission, annexes included. */
export function combinedSubmissionFileName(
  requirements: ReadonlyArray<{ id: string; title: string; description?: string | null; restrictions?: string | null; requirementType: string; priority: string }>,
  declaredFileNames: readonly string[],
): string | null {
  const stated = statedSingleSubmissionFile(requirements as never);
  if (stated && /\.pdf$/i.test(stated.fileName)) return stated.fileName;
  const pdfs = declaredFileNames.filter((n) => /\.pdf$/i.test(n.trim()));
  if (declaredFileNames.length !== 1 || pdfs.length !== 1) return null;
  const text = requirements.map((r) => `${r.title}. ${r.description ?? ""} ${r.restrictions ?? ""}`).join("\n");
  return CONTAINS_ANNEXES.test(text) ? pdfs[0]!.trim() : null;
}

const VAULT_SELECT = {
  id: true, originalFileName: true, fileName: true, category: true, mimeType: true,
  contentMimeType: true, detectedFormat: true, integrityStatus: true, contentSha256: true,
  contentByteLength: true, storagePath: true, fileContent: true,
} as const;

export type LoadedAnnexBundle = {
  plan: AnnexBundlePlan;
  /** Reads one planned original's bytes and re-verifies them; null when they do not verify. */
  loadOriginal: (doc: AnnexVaultDocument) => Promise<Buffer | null>;
};

export async function loadAnnexBundlePlan(tenderId: string, userId: string, db: any = defaultPrisma): Promise<LoadedAnnexBundle> {
  const tender = await db.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      exactFileNaming: true,
      requirements: { select: { id: true, title: true, description: true, restrictions: true, requirementType: true, priority: true } },
      expertMatches: { where: { isSelected: true }, select: { expert: { select: { sourceDocumentId: true } } } },
      projectMatches: { where: { isSelected: true }, select: { project: { select: { sourceDocumentId: true } } } },
    },
  });
  const empty: LoadedAnnexBundle = { plan: { applies: false, combinedFileName: null, parts: [], missing: [] }, loadOriginal: async () => null };
  if (!tender) return empty;
  const combinedFileName = combinedSubmissionFileName(tender.requirements, parseStringArray(tender.exactFileNaming));
  if (!combinedFileName) return empty;

  // A document being deleted is never bound in.
  const vault = await db.companyDocument.findMany({
    where: { company: { userId }, NOT: { metadata: { contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER } } },
    select: VAULT_SELECT,
    orderBy: { createdAt: "asc" },
  });
  const byId = new Map<string, any>(vault.map((doc: any) => [doc.id, doc]));
  const plan = planAnnexBundle({
    combinedFileName,
    requirementTexts: tender.requirements.map((r: any) => `${r.title} ${r.description ?? ""}`),
    vaultDocuments: vault,
    selectedExpertSourceDocumentIds: tender.expertMatches.map((m: any) => m.expert?.sourceDocumentId).filter(Boolean),
    selectedProjectSourceDocumentIds: tender.projectMatches.map((m: any) => m.project?.sourceDocumentId).filter(Boolean),
  });
  const loadOriginal = async (doc: AnnexVaultDocument): Promise<Buffer | null> => {
    const row = byId.get(doc.id);
    if (!row) return null;
    try {
      const bytes = await getStorageAdapter().getFile({ storagePath: row.storagePath || undefined, fileContent: row.fileContent, fileName: row.fileName });
      requireVerifiedPersistedFileBytes({ bytes, filename: row.originalFileName, claimedMimeType: row.mimeType, persisted: row });
      return bytes;
    } catch {
      return null;
    }
  };
  return { plan, loadOriginal };
}

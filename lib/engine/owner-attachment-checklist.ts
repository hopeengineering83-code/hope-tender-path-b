/**
 * The Owner Attachment Checklist: every original or supporting document the
 * tender requires that the app does not produce.
 *
 * The owner does not have to upload originals to the app for it to finish the
 * proposal. The app writes the technical and financial proposal; the
 * originals (licences, tax certificates, signed declarations, CVs, reference
 * letters, audited statements, powers of attorney, tender-issued forms) are
 * listed here exactly as the tender asks for them — what, where in the tender,
 * which kind of copy, signed or stamped, how many, which envelope, in which
 * order, whether the Company Vault already holds it, and the one thing the
 * owner does about it. A verified PDF original already in the Vault is
 * packaged automatically (bound into a combined file); anything else is the
 * owner's to attach.
 *
 * It never claims a document exists: an item is "packaged" only when the
 * delivered file actually carries it.
 */

import { prisma as defaultPrisma } from "../prisma";
import { COMPANY_DOCUMENT_PENDING_DELETE_MARKER } from "../company-document-durable-deletion";
import { tenderAnnexPolicy } from "./annex-policy";
import { isOwnerSignedKind, isVerifiedPdf, vaultCandidatesForKind, readAnnexBundleMarker, type AnnexVaultDocument } from "./annex-bundle";
import { combinedSubmissionFileName } from "./annex-bundle-loader";
import { isAwaitingOwnerPricing } from "./owner-pricing-stop";
import { parseStringArray, inferEnvelope } from "./submission-plan";

export type AttachmentCopyType = "ORIGINAL" | "CERTIFIED_COPY" | "SCANNED_COPY" | "COPY" | "NOT_STATED";
export type AttachmentVaultStatus = "VERIFIED_PDF_ORIGINAL" | "HELD_NOT_VERIFIED_PDF" | "NOT_IN_VAULT" | "NOT_APPLICABLE";

export type OwnerAttachmentItem = {
  order: number;
  kind: string;
  /** The document as the tender words it. */
  document: string;
  source: { requirementId: string | null; requirementTitle: string | null; page: number | null; quote: string | null };
  copyType: AttachmentCopyType;
  signatureRequired: boolean;
  stampRequired: boolean;
  copies: number | null;
  envelope: "TECHNICAL" | "FINANCIAL" | "ADMIN";
  /** Where in the submission it goes. */
  location: string;
  vault: { status: AttachmentVaultStatus; documents: string[] };
  status: "PACKAGED_AUTOMATICALLY" | "OWNER_TO_ATTACH";
  ownerAction: string;
};

export type OwnerAttachmentChecklist = {
  mode: "COMBINED_FILE" | "SEPARATE_ATTACHMENTS" | "NONE";
  combinedFileName: string | null;
  items: OwnerAttachmentItem[];
  outstanding: number;
};

export type ChecklistRequirement = {
  id: string;
  title: string;
  description?: string | null;
  requirementType?: string | null;
  priority?: string | null;
  restrictions?: string | null;
  exactFileName?: string | null;
  sourcePageNumber?: number | null;
  sourceExactQuote?: string | null;
};

export type ChecklistInput = {
  requirements: ChecklistRequirement[];
  declaredFileNames: string[];
  vaultDocuments: AnnexVaultDocument[];
  selectedExpertSourceDocumentIds: string[];
  selectedProjectSourceDocumentIds: string[];
  /** Rows awaiting a tender-issued original (REPLACE_WITH_ORIGINAL), pricing excluded. */
  formsAwaitingOriginal: Array<{ fileName: string; documentType?: string | null }>;
  /** Content hashes bound into the delivered combined file (its marker). */
  boundHashes: string[];
};

const KIND_TEST: Record<string, RegExp> = {
  "Company profile": /\bcompany\s+profile\b/i,
  "Signed declaration form issued with the tender": /\b(?:supplier|bidder|vendor|self)[-\s]+declaration\b|\bdeclaration\s+form\b/i,
  "Business licence and registration certificates": /\bbusiness\s+licen[cs]e|\bcommercial\s+registration|\bregistration\s+certificate|\btrade\s+licen[cs]e/i,
  "Tax clearance, VAT and TIN certificates": /\btax\s+clearance|\bVAT\b|\bTIN\b/,
  "Curricula vitae of the proposed experts": /\bCVs?\b|\bcurricul(?:um|a)\s+vita/i,
  "Professional licences and certificates of the proposed experts": /\b(?:professional\s+)?licen[cs]es\b|\bcertificates\b|\bcertifications\b/i,
  "Client reference and completion letters for the cited projects": /\b(?:project\s+)?references\b|\breference\s+letters?\b|\btestimon(?:y|ial)|\bcompletion\s+certificate/i,
  "Audited financial statements": /\baudited\s+financial|\bfinancial\s+statements\b/i,
  "Power of attorney": /\bpower\s+of\s+attorney\b/i,
};

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function clauseFor(text: string, test: RegExp): string | null {
  const parts = text.replace(/\s+/g, " ").split(/(?<=[.;])\s+|\s*•\s*|\s+-\s+(?=[A-Z])/);
  const hit = parts.find((p) => test.test(p));
  return hit ? hit.trim().replace(/[;,.]$/, "").slice(0, 220) : null;
}

export function copyTypeOf(text: string): AttachmentCopyType {
  if (/\b(?:certified|notari[sz]ed|attested|authenticated)\b/i.test(text)) return "CERTIFIED_COPY";
  if (/\bscanned\b/i.test(text)) return "SCANNED_COPY";
  if (/\boriginal\b/i.test(text)) return "ORIGINAL";
  if (/\bcop(?:y|ies)\b|\bphotocop/i.test(text)) return "COPY";
  return "NOT_STATED";
}

function copiesOf(text: string): number | null {
  const m = /\b(\d{1,2}|one|two|three|four|five|six)\s*(?:\(\d+\)\s*)?(?:hard\s+|printed\s+|bound\s+)?cop(?:y|ies)\b/i.exec(text);
  if (!m) return null;
  return /^\d+$/.test(m[1]!) ? Number(m[1]) : NUMBER_WORDS[m[1]!.toLowerCase()] ?? null;
}

function envelopeOf(text: string): OwnerAttachmentItem["envelope"] {
  return /\bfinancial\s+(?:envelope|proposal|offer)\b/i.test(text) && !/\btechnical\s+(?:envelope|proposal)\b/i.test(text) ? "FINANCIAL" : "TECHNICAL";
}

const COPY_PHRASE: Record<AttachmentCopyType, string> = {
  ORIGINAL: "original",
  CERTIFIED_COPY: "certified copy",
  SCANNED_COPY: "scanned copy",
  COPY: "copy",
  NOT_STATED: "copy",
};

/** Build the checklist. Pure. */
export function buildOwnerAttachmentChecklist(input: ChecklistInput): OwnerAttachmentChecklist {
  const combined = combinedSubmissionFileName(input.requirements.map((r) => ({
    id: r.id, title: r.title, description: r.description ?? null, restrictions: r.restrictions ?? null,
    requirementType: r.requirementType ?? "", priority: r.priority ?? "",
  })), input.declaredFileNames);
  const texts = input.requirements.map((r) => `${r.title} ${r.description ?? ""}`);
  const policy = tenderAnnexPolicy(texts);
  const items: OwnerAttachmentItem[] = [];
  const bound = new Set(input.boundHashes);
  const mode: OwnerAttachmentChecklist["mode"] = combined && policy.required ? "COMBINED_FILE" : policy.required || input.formsAwaitingOriginal.length > 0 ? "SEPARATE_ATTACHMENTS" : "NONE";

  policy.items.forEach((kind, index) => {
    const test = KIND_TEST[kind];
    const req = input.requirements.find((r) => test?.test(`${r.title} ${r.description ?? ""} ${r.sourceExactQuote ?? ""}`)) ?? null;
    const reqText = req ? `${req.sourceExactQuote ?? ""} ${req.description ?? ""} ${req.title}` : "";
    const clause = (test && clauseFor(reqText, test)) || kind;
    const copyType = copyTypeOf(clause);
    const ownerSigned = isOwnerSignedKind(kind);
    const signatureRequired = ownerSigned || /\bsign(?:ed|ature)\b/i.test(clause);
    const stampRequired = /\b(?:stamp(?:ed)?|seal(?:ed)?)\b/i.test(clause);
    const candidates = vaultCandidatesForKind(kind, input);
    const verified = candidates.filter((d) => isVerifiedPdf(d));
    const vaultStatus: AttachmentVaultStatus = verified.length > 0 ? "VERIFIED_PDF_ORIGINAL" : candidates.length > 0 ? "HELD_NOT_VERIFIED_PDF" : "NOT_IN_VAULT";
    const envelope = envelopeOf(reqText);
    const annexNo = index + 1;
    const packaged = mode === "COMBINED_FILE" && verified.length > 0 && verified.every((d) => bound.has(d.contentSha256 || d.id));
    const what = `${COPY_PHRASE[copyType]} of ${clause.replace(/^(?:a\s+|the\s+)?(?:scanned|certified|notari[sz]ed|attested)?\s*cop(?:y|ies)\s+of\s+/i, "")}${signatureRequired ? ", signed" : ""}${stampRequired ? " and stamped" : ""}`;
    const location = mode === "COMBINED_FILE"
      ? `Inside "${combined}", after the proposal pages, as Annex ${annexNo}`
      : `${envelope === "FINANCIAL" ? "Financial" : "Technical"} envelope, as Annex ${annexNo} after the proposal`;
    let ownerAction: string;
    if (packaged) {
      ownerAction = `Nothing to do: the verified original from the Company Vault is bound into "${combined}" as Annex ${annexNo}.${signatureRequired ? " Confirm it carries the required signature." : ""}`;
    } else if (vaultStatus === "VERIFIED_PDF_ORIGINAL") {
      ownerAction = mode === "COMBINED_FILE"
        ? `The Company Vault holds it (${verified.map((d) => d.originalFileName).join(", ")}); it is bound into "${combined}" when the package is next finalized.`
        : `Attach the ${what} — the Company Vault holds ${verified.map((d) => `"${d.originalFileName}"`).join(", ")} — to the ${location.toLowerCase()}.`;
    } else {
      ownerAction = mode === "COMBINED_FILE"
        ? `Insert the ${what} into "${combined}" as Annex ${annexNo} when assembling the file${copiesOf(clause) ? ` (${copiesOf(clause)} copies)` : ""}, or upload it to the Company Vault as a PDF and it is bound in automatically.`
        : `Attach the ${what} to the ${location.toLowerCase()}${copiesOf(clause) ? ` (${copiesOf(clause)} copies)` : ""}.`;
    }
    items.push({
      order: annexNo,
      kind,
      document: clause,
      source: { requirementId: req?.id ?? null, requirementTitle: req?.title ?? null, page: req?.sourcePageNumber ?? null, quote: req?.sourceExactQuote ?? null },
      copyType,
      signatureRequired,
      stampRequired,
      copies: copiesOf(clause),
      envelope,
      location,
      vault: { status: vaultStatus, documents: (verified.length > 0 ? verified : candidates).map((d) => d.originalFileName) },
      status: packaged ? "PACKAGED_AUTOMATICALLY" : "OWNER_TO_ATTACH",
      ownerAction,
    });
  });

  // Tender-issued forms the owner completes and signs (not the priced
  // financial proposal, which the owner approves rather than attaches).
  for (const form of input.formsAwaitingOriginal) {
    const req = input.requirements.find((r) => (r.exactFileName ?? "").toLowerCase() === form.fileName.toLowerCase()) ?? null;
    const text = req ? `${req.sourceExactQuote ?? ""} ${req.description ?? ""}` : form.fileName;
    const envelope = inferEnvelope(form.documentType ?? "", form.fileName) as OwnerAttachmentItem["envelope"];
    items.push({
      order: items.length + 1,
      kind: "Tender-issued form",
      document: form.fileName,
      source: { requirementId: req?.id ?? null, requirementTitle: req?.title ?? null, page: req?.sourcePageNumber ?? null, quote: req?.sourceExactQuote ?? null },
      copyType: copyTypeOf(text) === "NOT_STATED" ? "ORIGINAL" : copyTypeOf(text),
      signatureRequired: true,
      stampRequired: /\b(?:stamp(?:ed)?|seal(?:ed)?)\b/i.test(text),
      copies: copiesOf(text),
      envelope,
      location: `${envelope === "FINANCIAL" ? "Financial" : envelope === "ADMIN" ? "Administrative" : "Technical"} envelope, as "${form.fileName}"`,
      vault: { status: "NOT_APPLICABLE", documents: [] },
      status: "OWNER_TO_ATTACH",
      ownerAction: `Complete and sign the tender's form "${form.fileName}" and include it in the ${envelope.toLowerCase()} envelope (or attach it to this tender as the original and it is packaged automatically).`,
    });
  }

  return { mode, combinedFileName: combined, items, outstanding: items.filter((i) => i.status === "OWNER_TO_ATTACH").length };
}

/** Load the checklist for one tender. Read-only. */
export async function loadOwnerAttachmentChecklist(tenderId: string, userId: string, db: any = defaultPrisma): Promise<OwnerAttachmentChecklist | null> {
  const tender = await db.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      exactFileNaming: true,
      requirements: { select: { id: true, title: true, description: true, requirementType: true, priority: true, restrictions: true, exactFileName: true, sourcePageNumber: true, sourceExactQuote: true } },
      expertMatches: { where: { isSelected: true }, select: { expert: { select: { sourceDocumentId: true } } } },
      projectMatches: { where: { isSelected: true }, select: { project: { select: { sourceDocumentId: true } } } },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: { name: true, exactFileName: true, documentType: true, reviewStatus: true, fileContent: true },
      },
    },
  });
  if (!tender) return null;
  const vault = await db.companyDocument.findMany({
    where: { company: { userId }, NOT: { metadata: { contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER } } },
    select: { id: true, originalFileName: true, category: true, mimeType: true, contentMimeType: true, detectedFormat: true, integrityStatus: true, contentSha256: true },
    orderBy: { createdAt: "asc" },
  }).catch(() => []);
  const declaredFileNames = parseStringArray(tender.exactFileNaming);
  const combined = combinedSubmissionFileName(tender.requirements, declaredFileNames);
  let boundHashes: string[] = [];
  if (combined) {
    const row = tender.generatedDocuments.find((d: any) => String(d.exactFileName ?? "").toLowerCase() === combined.toLowerCase() && d.fileContent);
    if (row) boundHashes = (await readAnnexBundleMarker(Buffer.from(row.fileContent, "base64")))?.bound ?? [];
  }
  return buildOwnerAttachmentChecklist({
    requirements: tender.requirements,
    declaredFileNames,
    vaultDocuments: vault,
    selectedExpertSourceDocumentIds: tender.expertMatches.map((m: any) => m.expert?.sourceDocumentId).filter(Boolean),
    selectedProjectSourceDocumentIds: tender.projectMatches.map((m: any) => m.project?.sourceDocumentId).filter(Boolean),
    formsAwaitingOriginal: tender.generatedDocuments
      .filter((d: any) => String(d.reviewStatus ?? "").toUpperCase() === "REPLACE_WITH_ORIGINAL" && !isAwaitingOwnerPricing(d))
      .map((d: any) => ({ fileName: d.exactFileName ?? d.name, documentType: d.documentType })),
    boundHashes,
  });
}

/** The checklist as plain text, for printing beside the package. */
export function ownerAttachmentChecklistText(tenderTitle: string, checklist: OwnerAttachmentChecklist): string {
  const lines = [
    `OWNER ATTACHMENT CHECKLIST — ${tenderTitle}`,
    "For the bidder's own use when assembling the submission. Do not submit this list.",
    checklist.mode === "COMBINED_FILE" ? `The tender requires one combined file: "${checklist.combinedFileName}". Annexes follow the proposal pages in this order.` : "Attach each item in this order.",
    "",
  ];
  for (const item of checklist.items) {
    lines.push(`${item.order}. ${item.kind} — ${item.status === "PACKAGED_AUTOMATICALLY" ? "PACKAGED" : "OWNER TO ATTACH"}`);
    lines.push(`   Required: ${item.document}`);
    lines.push(`   Source: ${item.source.requirementTitle ?? "tender requirement"}${item.source.page ? `, page ${item.source.page}` : ""}${item.source.quote ? ` — "${item.source.quote.replace(/\s+/g, " ").slice(0, 200)}"` : ""}`);
    lines.push(`   Copy: ${item.copyType.replace(/_/g, " ").toLowerCase()}; signature ${item.signatureRequired ? "required" : "not stated"}; stamp ${item.stampRequired ? "required" : "not stated"}${item.copies ? `; ${item.copies} copies` : ""}`);
    lines.push(`   Goes: ${item.location}`);
    lines.push(`   Company Vault: ${item.vault.status.replace(/_/g, " ").toLowerCase()}${item.vault.documents.length ? ` (${item.vault.documents.join(", ")})` : ""}`);
    lines.push(`   Action: ${item.ownerAction}`);
    lines.push("");
  }
  return lines.join("\n");
}

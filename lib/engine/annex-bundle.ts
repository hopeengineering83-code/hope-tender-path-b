/**
 * The tender's annexes, bound into the one file it asks for.
 *
 * A tender that says the whole submission is a single named PDF "containing
 * all required sections and annexes" receives one file. The app used to render
 * only the proposal into it and list the annexes in the Annex Schedule, so the
 * delivered file said what it should contain without containing it. This module
 * decides which verified Company Vault originals belong in that file — in the
 * order the tender names them — and appends them after the proposal pages,
 * unchanged.
 *
 * It never invents or retypes evidence:
 *   • only originals whose stored bytes are integrity-VERIFIED and are PDFs
 *     are bound in; their pages are copied as they are;
 *   • CVs and reference letters come only from the experts and projects the
 *     engine selected for this tender, never from the rest of the Vault;
 *   • a kind with no such original — or one the owner must sign (a declaration,
 *     a power of attorney) — is reported as missing, and the package stays
 *     blocked until the owner supplies it.
 *
 * When the tender asks for separate attachments instead, nothing here applies:
 * the attachments are the owner's to upload, as before.
 *
 * The merged PDF records where the proposal ends (`hope-proposal-pages:N` in
 * its keywords), so every reader that judges the proposal's own wording reads
 * those pages only. Annex originals legitimately carry figures, letterheads and
 * signatures that are not the proposal's claims.
 */

import { PDFDocument } from "pdf-lib";
import { tenderAnnexPolicy } from "./annex-policy";

export type AnnexVaultDocument = {
  id: string;
  originalFileName: string;
  category: string;
  mimeType?: string | null;
  contentMimeType?: string | null;
  detectedFormat?: string | null;
  integrityStatus?: string | null;
  contentSha256?: string | null;
};

export type AnnexBundleInput = {
  /** The single file the tender says the whole submission is (statedSingleSubmissionFile). */
  combinedFileName: string | null;
  /** Requirement texts (title + description), read for the attachment rule. */
  requirementTexts: readonly string[];
  vaultDocuments: readonly AnnexVaultDocument[];
  /** Source documents of the experts / projects selected for this tender. */
  selectedExpertSourceDocumentIds: readonly string[];
  selectedProjectSourceDocumentIds: readonly string[];
  /**
   * Full names of the selected experts. An expert record has one source
   * document — the CV — so a professional licence stored as its own Vault
   * document is bound to the expert by the name the owner filed it under.
   */
  selectedExpertNames?: readonly string[];
  /**
   * Full names of every expert of the firm, so a file is never bound when
   * another expert's name fits it as well. Without it no certificate is bound
   * by name at all.
   */
  companyExpertNames?: readonly string[];
};

export type AnnexBundlePart = { kind: string; documents: AnnexVaultDocument[] };
export type AnnexBundleMissing = { kind: string; reason: string };

export type AnnexBundlePlan = {
  applies: boolean;
  combinedFileName: string | null;
  parts: AnnexBundlePart[];
  missing: AnnexBundleMissing[];
};

const OWNER_SIGNED = "an original the owner signs for this tender and inserts when assembling the file";

type KindRule = {
  /** Which Vault originals answer this kind. */
  select: (doc: AnnexVaultDocument, input: AnnexBundleInput) => boolean;
  /** Why it is missing when nothing answers it. */
  missingReason: string;
};

const name = (doc: AnnexVaultDocument) => doc.originalFileName.toLowerCase();

const HONORIFICS = new Set(["dr", "eng", "engr", "mr", "mrs", "ms", "miss", "prof", "ato", "wro", "arch", "ir"]);
const nameWords = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

const nameParts = (fullName: string) => nameWords(fullName).filter((word) => word.length >= 2 && !HONORIFICS.has(word));

/**
 * The selected expert a file the owner named is filed under, or null.
 *
 * Every part of the expert's name must appear in the file name as a whole
 * word (titles and accents aside), and no other expert of the firm may fit
 * the file as well: "Mohammed_Ahmed_Hassan_Licence.pdf" is not Mohammed Ahmed
 * Ali's, and when the firm also has a Mohammed Ahmed Hassan it is not
 * Mohammed Ahmed's either — the fullest name that fits wins, and a tie binds
 * nothing, as does a name two of the firm's experts share. A one-word name
 * binds nothing. A licence bound to the wrong person
 * would be submitted as evidence for the wrong expert, so every doubt leaves
 * the original to the owner.
 */
export function expertFiledUnder(fileName: string, selectedExperts: readonly string[], companyExperts: readonly string[] = []): string | null {
  const words = new Set(nameWords(fileName.replace(/\.[a-z0-9]{1,5}$/i, "")));
  const key = (name: string) => nameParts(name).join(" ");
  const selected = new Set(selectedExperts.map(key));
  // How many of the firm's experts carry each name. The firm's list includes
  // the selected experts; a selected name missing from it still counts once.
  // Two experts with the same name cannot be told apart by a file name.
  const people = new Map<string, number>();
  for (const name of companyExperts) people.set(key(name), (people.get(key(name)) ?? 0) + 1);
  for (const name of selected) if (!people.has(name)) people.set(name, 1);
  const fits = [...people.keys()].filter((name) => {
    const parts = name.split(" ").filter(Boolean);
    return parts.length >= 2 && parts.every((part) => words.has(part));
  });
  if (fits.length === 0) return null;
  const fullest = Math.max(...fits.map((name) => name.split(" ").length));
  const best = fits.filter((name) => name.split(" ").length === fullest);
  return best.length === 1 && people.get(best[0]!) === 1 && selected.has(best[0]!) ? best[0]! : null;
}

// Keyed by the names tenderAnnexPolicy returns (annex-policy.ts ANNEX_KINDS).
const KIND_RULES: Record<string, KindRule> = {
  "Company profile": {
    select: (doc) => doc.category === "COMPANY_PROFILE",
    missingReason: "no verified company profile PDF in the Company Vault",
  },
  // Never bound from the Vault. The Vault is the firm's, not the tender's: a
  // file named "declaration" or "power of attorney" there was signed for some
  // other procurement, and binding it would submit a stale legal attestation
  // as this tender's (release review, 2026-10-11). The owner signs these for
  // this tender and inserts them.
  "Signed declaration form issued with the tender": {
    select: () => false,
    missingReason: OWNER_SIGNED,
  },
  "Business licence and registration certificates": {
    select: (doc) => doc.category === "LEGAL_REGISTRATION" && !/\b(?:vat|tin|tax)\b/.test(name(doc)),
    missingReason: "no verified business licence / registration certificate PDF in the Company Vault",
  },
  "Tax clearance, VAT and TIN certificates": {
    select: (doc) => ["LEGAL_REGISTRATION", "COMPLIANCE_RECORD", "CERTIFICATION"].includes(doc.category) && /\b(?:vat|tin|tax)\b/.test(name(doc)),
    missingReason: "no verified tax / VAT / TIN certificate PDF in the Company Vault",
  },
  "Curricula vitae of the proposed experts": {
    select: (doc, input) => input.selectedExpertSourceDocumentIds.includes(doc.id),
    missingReason: "the selected experts have no verified CV PDF in the Company Vault",
  },
  "Professional licences and certificates of the proposed experts": {
    // The expert's own source document when it is the certificate, or a
    // certificate filed under a selected expert's name. Requiring the CV's id
    // meant a separately stored certificate could never answer this kind.
    select: (doc, input) => doc.category === "CERTIFICATION"
      && (input.selectedExpertSourceDocumentIds.includes(doc.id)
        || (input.companyExpertNames !== undefined && expertFiledUnder(doc.originalFileName, input.selectedExpertNames ?? [], input.companyExpertNames) !== null)),
    missingReason: "no verified professional licence / certificate PDF linked to the selected experts (file it under the expert's full name)",
  },
  "Client reference and completion letters for the cited projects": {
    select: (doc, input) => input.selectedProjectSourceDocumentIds.includes(doc.id),
    missingReason: "the selected projects have no verified reference / completion letter PDF in the Company Vault",
  },
  "Audited financial statements": {
    select: (doc) => doc.category === "FINANCIAL_STATEMENT",
    missingReason: "no verified audited financial statement PDF in the Company Vault",
  },
  "Power of attorney": {
    select: () => false,
    missingReason: OWNER_SIGNED,
  },
};

export function isVerifiedPdf(doc: AnnexVaultDocument): boolean {
  if (String(doc.integrityStatus ?? "").toUpperCase() !== "VERIFIED") return false;
  const format = String(doc.detectedFormat ?? "").toUpperCase();
  const mime = String(doc.contentMimeType ?? doc.mimeType ?? "").toLowerCase();
  return format === "PDF" || mime === "application/pdf";
}

/** The Vault documents that answer one annex kind (verified or not). Empty for a kind with no rule. */
export function vaultCandidatesForKind(kind: string, input: Pick<AnnexBundleInput, "vaultDocuments" | "selectedExpertSourceDocumentIds" | "selectedProjectSourceDocumentIds" | "selectedExpertNames" | "companyExpertNames">): AnnexVaultDocument[] {
  const rule = KIND_RULES[kind];
  if (!rule) return [];
  return input.vaultDocuments.filter((doc) => rule.select(doc, input as AnnexBundleInput));
}

/** Kinds only the owner can produce: they must be signed. */
export function isOwnerSignedKind(kind: string): boolean {
  return KIND_RULES[kind]?.missingReason === OWNER_SIGNED;
}

/** Which originals the combined file must carry, and which are missing. */
export function planAnnexBundle(input: AnnexBundleInput): AnnexBundlePlan {
  const combined = input.combinedFileName?.trim() ?? "";
  const policy = tenderAnnexPolicy(input.requirementTexts);
  if (!/\.pdf$/i.test(combined) || !policy.required) {
    return { applies: false, combinedFileName: combined || null, parts: [], missing: [] };
  }
  const parts: AnnexBundlePart[] = [];
  const missing: AnnexBundleMissing[] = [];
  const seen = new Set<string>();
  for (const kind of policy.items) {
    const rule = KIND_RULES[kind];
    if (!rule) continue;
    const candidates = input.vaultDocuments.filter((doc) => rule.select(doc, input));
    const usable = candidates.filter(isVerifiedPdf).filter((doc) => {
      const key = doc.contentSha256 || doc.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (usable.length > 0) {
      parts.push({ kind, documents: usable });
    } else {
      missing.push({
        kind,
        reason: candidates.length > 0
          ? "the Company Vault holds it, but not as an integrity-verified PDF original"
          : rule.missingReason,
      });
    }
  }
  return { applies: true, combinedFileName: combined, parts, missing };
}

/** The content hashes the bundle binds in, in order — the bundle's identity. */
export function annexBundleIdentity(plan: AnnexBundlePlan): string[] {
  return plan.parts.flatMap((part) => part.documents.map((doc) => doc.contentSha256 || doc.id));
}

export const PROPOSAL_PAGES_KEYWORD = "hope-proposal-pages:";
const ANNEX_IDENTITY_KEYWORD = "hope-annex-bundle:";

export type AnnexBundleResult = {
  bytes: Buffer;
  proposalPages: number;
  /** Content hashes actually bound in, in order. */
  bound: string[];
  /** Originals that could not be opened as PDFs. */
  unreadable: Array<{ kind: string; fileName: string }>;
};

/**
 * Append the planned originals after the proposal's pages. Pages are copied
 * unchanged. An original that cannot be opened (encrypted, damaged) is not
 * bound and is reported, so the package stays blocked rather than shipping a
 * file that silently lacks it.
 */
export async function bindAnnexBundle(
  proposalPdf: Buffer,
  plan: AnnexBundlePlan,
  loadOriginal: (doc: AnnexVaultDocument) => Promise<Buffer | null>,
): Promise<AnnexBundleResult> {
  const merged = await PDFDocument.load(proposalPdf);
  const proposalPages = merged.getPageCount();
  const bound: string[] = [];
  const unreadable: AnnexBundleResult["unreadable"] = [];
  for (const part of plan.parts) {
    for (const doc of part.documents) {
      try {
        const bytes = await loadOriginal(doc);
        if (!bytes) throw new Error("no bytes");
        const source = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(source, source.getPageIndices());
        for (const page of pages) merged.addPage(page);
        bound.push(doc.contentSha256 || doc.id);
      } catch {
        unreadable.push({ kind: part.kind, fileName: doc.originalFileName });
      }
    }
  }
  merged.setKeywords([`${PROPOSAL_PAGES_KEYWORD}${proposalPages}`, `${ANNEX_IDENTITY_KEYWORD}${bound.join(",")}`]);
  return { bytes: Buffer.from(await merged.save()), proposalPages, bound, unreadable };
}

/** What a merged PDF says about itself: where the proposal ends and what it binds. */
export async function readAnnexBundleMarker(pdf: Buffer): Promise<{ proposalPages: number; bound: string[] } | null> {
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    const keywords = doc.getKeywords() ?? "";
    const pages = new RegExp(`${PROPOSAL_PAGES_KEYWORD}(\\d+)`).exec(keywords);
    if (!pages) return null;
    const bound = new RegExp(`${ANNEX_IDENTITY_KEYWORD}([^\\s]*)`).exec(keywords)?.[1] ?? "";
    return { proposalPages: Number(pages[1]), bound: bound ? bound.split(",") : [] };
  } catch {
    return null;
  }
}

/** The proposal's own pages of a merged PDF, or the PDF unchanged when it binds nothing. */
export async function proposalPagesOnly(pdf: Buffer): Promise<Buffer> {
  const marker = await readAnnexBundleMarker(pdf);
  if (!marker) return pdf;
  const source = await PDFDocument.load(pdf, { updateMetadata: false });
  if (marker.proposalPages >= source.getPageCount()) return pdf;
  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, Array.from({ length: marker.proposalPages }, (_, i) => i));
  for (const page of pages) out.addPage(page);
  return Buffer.from(await out.save());
}

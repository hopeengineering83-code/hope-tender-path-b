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
};

export type AnnexBundlePart = { kind: string; documents: AnnexVaultDocument[] };
export type AnnexBundleMissing = { kind: string; reason: string };

export type AnnexBundlePlan = {
  applies: boolean;
  combinedFileName: string | null;
  parts: AnnexBundlePart[];
  missing: AnnexBundleMissing[];
};

const OWNER_SIGNED = "an original the owner signs; upload the signed PDF to the Company Vault";

type KindRule = {
  /** Which Vault originals answer this kind. */
  select: (doc: AnnexVaultDocument, input: AnnexBundleInput) => boolean;
  /** Why it is missing when nothing answers it. */
  missingReason: string;
};

const name = (doc: AnnexVaultDocument) => doc.originalFileName.toLowerCase();

// Keyed by the names tenderAnnexPolicy returns (annex-policy.ts ANNEX_KINDS).
const KIND_RULES: Record<string, KindRule> = {
  "Company profile": {
    select: (doc) => doc.category === "COMPANY_PROFILE",
    missingReason: "no verified company profile PDF in the Company Vault",
  },
  "Signed declaration form issued with the tender": {
    select: (doc) => /declaration/.test(name(doc)) && ["COMPLIANCE_RECORD", "LEGAL_REGISTRATION", "CERTIFICATION", "OTHER"].includes(doc.category),
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
    select: (doc, input) => doc.category === "CERTIFICATION" && input.selectedExpertSourceDocumentIds.includes(doc.id),
    missingReason: "no verified professional licence / certificate PDF linked to the selected experts",
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
    select: (doc) => /power\s+of\s+attorney/.test(name(doc)),
    missingReason: OWNER_SIGNED,
  },
};

function isVerifiedPdf(doc: AnnexVaultDocument): boolean {
  if (String(doc.integrityStatus ?? "").toUpperCase() !== "VERIFIED") return false;
  const format = String(doc.detectedFormat ?? "").toUpperCase();
  const mime = String(doc.contentMimeType ?? doc.mimeType ?? "").toLowerCase();
  return format === "PDF" || mime === "application/pdf";
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

// Resolves the genuine, client-visible narrative text of a stored proposal
// GeneratedDocument for consumers that need PLAIN TEXT (currently:
// EVALUATOR_SIM). Previously this logic lived inline in the EVALUATOR_SIM
// job handler and assumed the stored document was always Markdown — it
// base64-decoded fileContent straight to UTF-8 regardless of format. Once
// automatic generation started producing real DOCX (lib/engine/generate-elite.ts),
// that assumption broke: decoding a DOCX's binary bytes as UTF-8 produces
// mojibake, which the evaluator panel would then score as if it were the
// actual proposal content.
//
// This resolver is format-aware: only a genuinely text-based stored format
// (MARKDOWN) is decoded directly; anything else (DOCX, PDF) goes through the
// same extractTextFromBuffer() extractor every other ingestion path in the
// app uses, so the evaluator sees the real visible narrative — not raw
// binary bytes, and not internal document XML/metadata.
import { extractTextFromBuffer } from "../extract-text";
import { isStrictBase64 } from "./generated-file-integrity";

export type StoredProposalDocument = {
  fileContent: string | null;
  format: string | null;
  contentMimeType: string | null;
  exactFileName: string | null;
  name: string | null;
} | null | undefined;

export async function resolveProposalNarrativeText(
  doc: StoredProposalDocument,
  explicitOverride?: string | null,
): Promise<string> {
  if (typeof explicitOverride === "string" && explicitOverride) return explicitOverride;

  const storedProposal = doc?.fileContent ?? "";
  if (!storedProposal) return "";

  if (doc?.format && doc.format !== "MARKDOWN") {
    const buffer = Buffer.from(storedProposal, "base64");
    return extractTextFromBuffer(
      buffer,
      doc.contentMimeType ?? "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      doc.exactFileName ?? doc.name ?? "proposal.docx",
    );
  }

  return isStrictBase64(storedProposal) ? Buffer.from(storedProposal, "base64").toString("utf8") : storedProposal;
}

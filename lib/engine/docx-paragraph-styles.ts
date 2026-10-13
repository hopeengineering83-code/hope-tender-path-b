// Paragraph style ids the proposal DOCX carries so that its structure survives
// the one other reader of that DOCX: pdf-finalizer renders the delivered PDF
// from markdown re-extracted out of the DOCX (export-readiness.ts
// extractDocxProposalParts), and markdown has no way to say "this is the cover"
// or "this is the contents title" except by what the paragraph is styled as.
//
// The writer (generate-elite.ts) and the reader share these names so neither
// can drift from the other.

/** Word's own built-in style id for a table-of-contents title. */
export const TOC_HEADING_STYLE = "TOCHeading";

/**
 * The DOCX cover block. The PDF draws its own cover page from the same tender
 * and company records, so these paragraphs are not repeated in the PDF body.
 */
export const COVER_STYLE = "ProposalCover";

/**
 * Cover lines holding company-record facts the PDF cover has no other source
 * for (registration numbers, signatory, submission date and validity, service
 * lines). The PDF cover prints them rather than dropping them.
 */
export const COVER_DETAIL_STYLE = "ProposalCoverDetail";

// lib/extraction/tender-file-classifier.ts
//
// Classifies uploaded tender files into categories.
// Supports multi-file tender packs (main RFP + TOR + BOQ + CV form + addendum).

export type TenderFileClassification =
  | "main_tender_document"
  | "rfp_rfq_eoi_document"
  | "tor_scope_document"
  | "addendum"
  | "clarification"
  | "boq_price_schedule"
  | "technical_forms"
  | "financial_forms"
  | "cv_form"
  | "project_reference_form"
  | "legal_compliance_document"
  | "company_document_mistake"
  | "unknown";

export type FileClassificationResult = {
  classification: TenderFileClassification;
  confidence: number;
  reason: string;
};

/**
 * Classify a tender file based on its filename, extracted text, and MIME type.
 */
export function classifyTenderFile(args: {
  fileName: string;
  mimeType: string;
  extractedText: string | null;
  existingClassifications?: TenderFileClassification[];
}): FileClassificationResult {
  const { fileName, mimeType, extractedText } = args;
  const name = fileName.toLowerCase();
  const text = (extractedText ?? "").toLowerCase();
  const existing = args.existingClassifications ?? [];

  // 1. Addendum
  if (name.includes("addendum") || name.includes("addenda") || name.includes("amendment") || name.includes("corrigendum")) {
    return { classification: "addendum", confidence: 0.9, reason: "Filename contains 'addendum/amendment/corrigendum'" };
  }
  if (text.includes("addendum") && text.includes("supersedes") && text.length < 5000) {
    return { classification: "addendum", confidence: 0.7, reason: "Short document mentioning 'addendum' and 'supersedes'" };
  }

  // 2. Clarification
  if (name.includes("clarification") || name.includes("q&a") || name.includes("qa_") || name.includes("queries")) {
    return { classification: "clarification", confidence: 0.85, reason: "Filename contains 'clarification/queries'" };
  }

  // 3. BOQ / Price schedule
  if (name.includes("boq") || name.includes("bill of quantities") || name.includes("price schedule") || name.includes("price_schedule") || name.includes("financial schedule")) {
    return { classification: "boq_price_schedule", confidence: 0.85, reason: "Filename contains BOQ/price schedule keywords" };
  }
  if (name.endsWith(".xlsx") && (text.includes("unit price") || text.includes("quantity") || text.includes("amount") || text.includes("total price"))) {
    return { classification: "boq_price_schedule", confidence: 0.7, reason: "Excel file with price/quantity columns" };
  }

  // 4. Technical forms
  if (name.includes("technical form") || name.includes("tech_form") || name.includes("form a") || name.includes("form-a")) {
    return { classification: "technical_forms", confidence: 0.8, reason: "Filename contains 'technical form'" };
  }

  // 5. Financial forms
  if (name.includes("financial form") || name.includes("fin_form") || name.includes("form b") || name.includes("form-b") || name.includes("price form")) {
    return { classification: "financial_forms", confidence: 0.8, reason: "Filename contains 'financial form'" };
  }

  // 6. CV form / expert form
  if (name.includes("cv") || name.includes("curriculum vitae") || name.includes("expert form") || name.includes("key personnel")) {
    return { classification: "cv_form", confidence: 0.8, reason: "Filename contains CV/expert keywords" };
  }
  if (text.includes("curriculum vitae") && text.includes("position") && text.length < 3000) {
    return { classification: "cv_form", confidence: 0.65, reason: "Short document with CV/position text" };
  }

  // 7. Project reference form
  if (name.includes("project reference") || name.includes("experience form") || name.includes("past performance")) {
    return { classification: "project_reference_form", confidence: 0.8, reason: "Filename contains 'project reference'" };
  }

  // 8. Legal/compliance document
  if (name.includes("legal") || name.includes("compliance") || name.includes("tax clearance") || name.includes("license") || name.includes("certificate")) {
    return { classification: "legal_compliance_document", confidence: 0.75, reason: "Filename contains legal/compliance keywords" };
  }

  // 9. TOR / Scope document
  if (name.includes("tor") || name.includes("terms of reference") || name.includes("scope of work") || name.includes("scope of services")) {
    return { classification: "tor_scope_document", confidence: 0.85, reason: "Filename contains TOR/scope keywords" };
  }
  if (text.includes("terms of reference") && text.includes("scope of services") && text.length > 2000) {
    return { classification: "tor_scope_document", confidence: 0.65, reason: "Document contains TOR and scope of services text" };
  }

  // 10. RFP/RFQ/EOI document (if no main document classified yet)
  if (name.includes("rfp") || name.includes("rfq") || name.includes("eoi") || name.includes("request for proposal") || name.includes("request for quotation") || name.includes("expression of interest")) {
    if (!existing.includes("main_tender_document")) {
      return { classification: "main_tender_document", confidence: 0.8, reason: "Filename contains RFP/RFQ/EOI and no main document classified yet" };
    }
    return { classification: "rfp_rfq_eoi_document", confidence: 0.75, reason: "Filename contains RFP/RFQ/EOI keywords" };
  }

  // 11. Main tender document (largest file with submission instructions)
  if (text.includes("submission instructions") || text.includes("submission deadline") || text.includes("instructions to bidders")) {
    if (!existing.includes("main_tender_document")) {
      return { classification: "main_tender_document", confidence: 0.7, reason: "Document contains submission instructions and no main document classified yet" };
    }
  }

  // 12. Company document uploaded by mistake (check for company-related keywords)
  if (name.includes("company profile") || name.includes("company_registration") || name.includes("audit report")) {
    return { classification: "company_document_mistake", confidence: 0.6, reason: "Filename suggests company document, not tender document" };
  }

  return { classification: "unknown", confidence: 0.3, reason: "Could not classify from filename or text" };
}

/**
 * Classify all files in a multi-file tender pack.
 * The first file matching "main_tender_document" is the primary; others are classified relative to it.
 */
export function classifyMultiFilePack(files: Array<{ fileId: string; fileName: string; mimeType: string; extractedText: string | null }>): Map<string, FileClassificationResult> {
  const results = new Map<string, FileClassificationResult>();
  const existingClassifications: TenderFileClassification[] = [];

  // Sort by text length descending (largest file first) — main document is usually the longest
  const sorted = [...files].sort((a, b) => (b.extractedText?.length ?? 0) - (a.extractedText?.length ?? 0));

  for (const file of sorted) {
    const result = classifyTenderFile({
      fileName: file.fileName,
      mimeType: file.mimeType,
      extractedText: file.extractedText,
      existingClassifications,
    });
    results.set(file.fileId, result);
    existingClassifications.push(result.classification);
  }

  return results;
}

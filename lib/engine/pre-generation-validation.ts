import { Tender } from "@prisma/client";
import {
  isValidClientName,
  isPlaceholderClientName,
  isGarbageClientName,
  isClientNameContaminated,
  clientNameContaminationReason,
  containsMetadataPlaceholder,
} from "./metadata-validators";

export type PreGenerationValidationResult = {
  valid: boolean;
  blockers: string[];
  warnings: string[];
};

/**
 * Pre-generation validation gate. Ensures that critical metadata is present
 * and not contaminated before generation begins. This is the FIRST gate —
 * blocks before markdown/DOCX is even generated.
 *
 * Blocks on:
 * 1. Client name is placeholder ("Bid-Team to confirm", "Unknown", etc.)
 * 2. Client name is contaminated by portal text (contains | or old tender references)
 * 3. Submission method contains placeholders
 * 4. Deadline is in the past (warning + soft block for export, not generation)
 * 5. Critical source traceability missing (AI extracted field but no source page)
 */
export async function validateTenderBeforeGeneration(
  tender: Tender & {
    requirements: Array<{ id: string; sourcePageNumber?: number | null; sourceQuote?: string | null }>;
    clientNameSourcePage?: number | null;
    clientNameSourceQuote?: string | null;
  },
): Promise<PreGenerationValidationResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // ── Placeholder data blocking ────────────────────────────────────────
  // CLAUDE.md: "Do not fill missing client fields with placeholders such as
  // 'Bid-Team to confirm', 'unknown', 'not specified', or 'N/A' as if they are valid."
  if (tender.clientName && isPlaceholderClientName(tender.clientName)) {
    blockers.push(
      `Client name is a placeholder ("${tender.clientName}"). Set the real procuring entity name from the tender document before generating documents.`
    );
  }

  if (tender.submissionMethod && containsMetadataPlaceholder(tender.submissionMethod)) {
    blockers.push(
      `Submission method contains placeholder text. Provide the actual submission method (email, physical address, online portal, etc.) before generating.`
    );
  }

  // ── Client contamination detection ───────────────────────────────────
  // CLAUDE.md: "If the extracted client name is polluted by unrelated tender
  // portal text, navigation text, old tender alerts, or unrelated tenders,
  // flag it as contaminated and block final generation until corrected."
  if (tender.clientName && isClientNameContaminated(tender.clientName)) {
    const reason = clientNameContaminationReason(tender.clientName);
    blockers.push(
      reason ||
        `Client name appears contaminated by portal/navigation text. Manually review and correct before generating documents.`
    );
  }

  // ── Source traceability enforcement ──────────────────────────────────
  // CLAUDE.md: "Source page and source quote/snippet for every extracted
  // client field." If AI extracted the client name but didn't provide source,
  // block and ask for manual verification or re-analysis.
  if (
    tender.clientName &&
    isValidClientName(tender.clientName) &&
    !isGarbageClientName(tender.clientName) &&
    (!tender.clientNameSourcePage || !tender.clientNameSourceQuote)
  ) {
    blockers.push(
      `Client name extracted but source page/quote missing. Re-run AI Analyze to capture the source, or manually verify the client name in the tender document.`
    );
  }

  // ── Requirements source traceability ─────────────────────────────────
  const requirementsWithoutSource = tender.requirements.filter(
    (r) => !r.sourcePageNumber || !r.sourceQuote
  );
  if (requirementsWithoutSource.length > 0) {
    warnings.push(
      `${requirementsWithoutSource.length} requirement(s) extracted but source page/quote missing. Re-run AI Analyze to add traceability.`
    );
  }

  // ── Deadline in the past (warning, not generation blocker) ────────────
  if (tender.deadline && new Date(tender.deadline) < new Date()) {
    warnings.push(
      `Submission deadline (${tender.deadline.toISOString().split("T")[0]}) has passed. Proposals can be generated but export will be blocked.`
    );
  }

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
  };
}

/**
 * Check if a tender is ready for export. Stricter than generation —
 * blocks on all generation blockers PLUS deadline-in-past.
 */
export function validateTenderBeforeExport(tender: Tender): PreGenerationValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (tender.clientName && isPlaceholderClientName(tender.clientName)) {
    blockers.push(`Client name is a placeholder. Cannot export with unverified metadata.`);
  }

  if (tender.clientName && isClientNameContaminated(tender.clientName)) {
    blockers.push(`Client name is contaminated. Cannot export with mixed/corrupted metadata.`);
  }

  // Deadline-in-past IS a hard block for export
  if (tender.deadline && new Date(tender.deadline) < new Date()) {
    blockers.push(
      `Submission deadline has passed (${tender.deadline.toISOString().split("T")[0]}). Late submissions are typically rejected by evaluators. Export is blocked.`
    );
  }

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
  };
}

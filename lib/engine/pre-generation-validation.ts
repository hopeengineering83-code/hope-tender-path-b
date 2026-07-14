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
 * Pre-generation validation gate.
 *
 * For DRAFT_GENERATION (called from /generate):
 *   Metadata issues (placeholder, contamination, missing source) are
 *   WARNINGS only — they never make valid=false. Draft work proceeds
 *   with unavailable metadata omitted from generated output.
 *
 * For FINAL_SUBMISSION_READY (called via validateTenderBeforeExport):
 *   Stricter — blocks on placeholder, contamination, and deadline-in-past.
 *
 * The operation gate (lib/engine/tender-operation-gate.ts) is the sole
 * authority for metadata eligibility. This function is kept for backward
 * compatibility with routes that call it directly.
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

  // ── Metadata issues are WARNINGS for draft work ─────────────────────
  // Placeholder client name — warning (omitted from output, not a blocker)
  if (tender.clientName && isPlaceholderClientName(tender.clientName)) {
    warnings.push(
      `clientName is a placeholder ("${tender.clientName}") — omitted from draft output.`
    );
  }

  // Placeholder submission method — warning
  if (tender.submissionMethod && containsMetadataPlaceholder(tender.submissionMethod)) {
    warnings.push(
      `submissionMethod contains placeholder text — omitted from draft output.`
    );
  }

  // Contaminated client name — warning (omitted, neutral framing used)
  if (tender.clientName && isClientNameContaminated(tender.clientName)) {
    const reason = clientNameContaminationReason(tender.clientName);
    warnings.push(
      reason ||
        `Client name appears contaminated by portal/navigation text — omitted from draft output.`
    );
  }

  // Source traceability missing — warning (not a blocker for draft)
  if (
    tender.clientName &&
    isValidClientName(tender.clientName) &&
    !isGarbageClientName(tender.clientName) &&
    (!tender.clientNameSourcePage || !tender.clientNameSourceQuote)
  ) {
    warnings.push(
      `Client name extracted but source page/quote missing — re-run AI Analyze to capture the source.`
    );
  }

  // ── Requirements source traceability ─────────────────────────────────
  const requirementsWithoutSource = tender.requirements.filter(
    (r) => !r.sourcePageNumber || !r.sourceQuote
  );
  if (requirementsWithoutSource.length > 0) {
    warnings.push(
      `${requirementsWithoutSource.length} requirement(s) extracted but source page/quote missing.`
    );
  }

  // ── Deadline in the past (warning, not generation blocker) ────────────
  if (tender.deadline && new Date(tender.deadline) < new Date()) {
    warnings.push(
      `Submission deadline has passed — export will be blocked but draft work proceeds.`
    );
  }

  // For DRAFT_GENERATION: valid is always true — metadata never blocks draft work.
  return {
    valid: true,
    blockers: [],
    warnings,
  };
}

/**
 * DEPRECATED — kept only to avoid breaking imports in older branches.
 *
 * The historic implementation hard-blocked export when the deadline had passed.
 * This contradicts the application's content-first authority model: a passed
 * deadline is an HIGH advisory in `lib/engine/export-readiness.ts` (a deadline
 * extension may have been granted), never a hard block on export, generation,
 * or any other workflow step.
 *
 * The canonical export gate is `assertTenderReadyForGenerationAndExport` in
 * `lib/engine/generation-readiness-gate.ts` (called with `purpose: "final-zip"`),
 * which delegates metadata eligibility to `lib/engine/tender-operation-gate.ts`.
 * That gate already emits `DEADLINE_PASSED` as an advisory warning, never a block.
 *
 * This function is preserved as an advisory-only mirror of the draft validator
 * so that any code still importing it receives consistent, non-blocking behavior.
 * It will be removed in a follow-up once the dead import is cleaned up everywhere.
 */
export async function validateTenderBeforeExport(
  tender: Tender,
): Promise<PreGenerationValidationResult> {
  // Reuse the draft validator — final-export blocking is the responsibility of
  // the central generation-readiness gate, not this helper.
  return validateTenderBeforeGeneration({
    ...tender,
    requirements: [],
  } as Tender & {
    requirements: Array<{ id: string; sourcePageNumber?: number | null; sourceQuote?: string | null }>;
    clientNameSourcePage?: number | null;
    clientNameSourceQuote?: string | null;
  });
}

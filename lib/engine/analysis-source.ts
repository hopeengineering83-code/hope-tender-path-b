// Analysis source detection and "human approval" gate.
//
// `lib/engine/run-tender-engine.ts` writes a line into `tender.notes`
// that records the analysis source:
//   - "Analysis source: AI (chunked multi-call when tender > 60K chars)."
//   - "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR). <reason>"
//   - "Analysis source: regex fallback (REGEX_FALLBACK_AI_DISABLED). <reason>"
//   - "Analysis source: regex fallback (REGEX_FALLBACK_NO_TEXT). <reason>"
//
// Final proposal generation must NOT run from a regex fallback analysis
// unless a human has explicitly approved the analysis (e.g. the engineer
// reviewed it and confirmed it captured the tender correctly).
//
// Storage: human approval is recorded by re-using the existing
// `ComplianceGap` table — title="ANALYSIS_APPROVAL:REGEX_FALLBACK",
// severity="ADVISORY", isResolved=true. The same pattern we use for
// donor advisory resolutions (no new Prisma model required).
//
// Public helpers:
//   detectAnalysisSource(tender)
//     -> "AI" | "REGEX_FALLBACK_AI_ERROR" | "HUMAN_APPROVED_REGEX_FALLBACK" | "UNKNOWN"
//   assertAnalysisReadyForFinalGeneration(client, tenderId, tender)
//     -> { ok, reason?, code? }
//
// Used by:
//   - lib/engine/final-submission-readiness.ts (canonical helper reports
//     analysisSource in summary)
//   - app/api/tenders/[id]/generate/route.ts (block final generation)
//   - app/api/tenders/[id]/ai-proposal/route.ts (block AI proposal pass)
//   - app/api/tenders/[id]/approve-analysis/route.ts (sets the approval)
//   - lib/engine/readiness-scoring.ts (analysisSource cap)

import type { PrismaClient } from "@prisma/client";

export const ANALYSIS_APPROVAL_GAP_TITLE = "ANALYSIS_APPROVAL:REGEX_FALLBACK";

export type AnalysisSource =
  | "AI"
  | "REGEX_FALLBACK_AI_ERROR"
  | "HUMAN_APPROVED_REGEX_FALLBACK"
  | "UNKNOWN";

export type TenderAnalysisSourceLike = {
  notes?: string | null;
};

function notesIncludeRegexFallback(notes?: string | null): boolean {
  return /analysis\s+source:\s*regex\s+fallback/i.test(notes ?? "");
}

function notesIncludeAiAnalysis(notes?: string | null): boolean {
  return /analysis\s+source:\s*ai/i.test(notes ?? "");
}

/** Synchronous detection from the tender.notes line alone. Does NOT
 * consider human approval — call `detectAnalysisSourceWithApproval`
 * for the full picture. */
export function detectAnalysisSource(tender: TenderAnalysisSourceLike): AnalysisSource {
  if (notesIncludeRegexFallback(tender.notes)) return "REGEX_FALLBACK_AI_ERROR";
  if (notesIncludeAiAnalysis(tender.notes)) return "AI";
  return "UNKNOWN";
}

/** Returns the analysis source taking human approval into account.
 * Looks up an ANALYSIS_APPROVAL ComplianceGap row to decide whether
 * a regex-fallback analysis has been explicitly approved by a human.
 */
export async function detectAnalysisSourceWithApproval(
  client: PrismaClient,
  tenderId: string,
  tender: TenderAnalysisSourceLike,
): Promise<AnalysisSource> {
  const base = detectAnalysisSource(tender);
  if (base !== "REGEX_FALLBACK_AI_ERROR") return base;
  const approval = await client.complianceGap.findFirst({
    where: { tenderId, title: ANALYSIS_APPROVAL_GAP_TITLE, severity: "ADVISORY", isResolved: true },
    select: { id: true },
  });
  return approval ? "HUMAN_APPROVED_REGEX_FALLBACK" : "REGEX_FALLBACK_AI_ERROR";
}

export type AnalysisGateResult =
  | { ok: true }
  | { ok: false; code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED"; message: string; nextAction: string };

/** Throws/returns the standard "regex fallback unapproved" blocker for
 * routes that must not produce final-quality output from regex fallback
 * analysis. Returns {ok: true} when the analysis is AI or human-approved.
 */
export async function assertAnalysisReadyForFinalGeneration(
  client: PrismaClient,
  tenderId: string,
  tender: TenderAnalysisSourceLike,
): Promise<AnalysisGateResult> {
  // FM-009: Prefer the canonical analysis-state resolver (which considers
  // AiJob + AiAnalyzeChunk + promoted fallback state) over the legacy
  // notes-based heuristic. Falls back to the legacy path on any error so
  // behaviour is no worse than before.
  try {
    const tenderRow = await client.tender.findUnique({
      where: { id: tenderId },
      select: { userId: true },
    });
    if (tenderRow) {
      const { resolveTenderAnalysisState } = await import("./analysis-state-resolver");
      // The resolver uses the global prisma internally, so we pass null here.
      const detail = await resolveTenderAnalysisState(null as any, tenderId, tenderRow.userId);
      if (detail.state === "AI_SUCCEEDED" || detail.state === "HUMAN_APPROVED_FALLBACK") {
        return { ok: true };
      }
      if (detail.state === "NOT_STARTED") {
        return {
          ok: false,
          code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
          message:
            "Analysis source has not been confirmed. Run AI analysis before final proposal generation, or approve the current analysis as sufficient.",
          nextAction: "RUN_ENGINE_OR_APPROVE_ANALYSIS",
        };
      }
      return {
        ok: false,
        code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
        message:
          "Latest analysis used the regex fallback (AI providers failed). Final proposal generation is blocked until AI analysis is re-run successfully, or a human explicitly approves the fallback analysis as sufficient.",
        nextAction: "RUN_ENGINE_OR_APPROVE_ANALYSIS",
      };
    }
  } catch {
    // Fall through to legacy notes-based detection below.
  }

  const source = await detectAnalysisSourceWithApproval(client, tenderId, tender);
  if (source === "AI" || source === "HUMAN_APPROVED_REGEX_FALLBACK") return { ok: true };
  if (source === "UNKNOWN") {
    return {
      ok: false,
      code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
      message: "Analysis source has not been confirmed. Run AI analysis before final proposal generation, or approve the current analysis as sufficient.",
      nextAction: "RUN_ENGINE_OR_APPROVE_ANALYSIS",
    };
  }
  return {
    ok: false,
    code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
    message: "Latest analysis used the regex fallback (AI providers failed). Final proposal generation is blocked until AI analysis is re-run successfully, or a human explicitly approves the fallback analysis as sufficient.",
    nextAction: "RUN_ENGINE_OR_APPROVE_ANALYSIS",
  };
}

/** Records human approval of a regex-fallback analysis. Idempotent. */
export async function approveRegexFallbackAnalysis(
  client: PrismaClient,
  tenderId: string,
  approverNote?: string | null,
): Promise<void> {
  const existing = await client.complianceGap.findFirst({
    where: { tenderId, title: ANALYSIS_APPROVAL_GAP_TITLE, severity: "ADVISORY" },
    select: { id: true },
  });
  const resolvedNote = approverNote && approverNote.trim().length > 0 ? approverNote.trim().slice(0, 500) : "Human-approved";
  if (existing) {
    await client.complianceGap.update({
      where: { id: existing.id },
      data: { isResolved: true, resolvedNote },
    });
  } else {
    await client.complianceGap.create({
      data: {
        tenderId,
        severity: "ADVISORY",
        title: ANALYSIS_APPROVAL_GAP_TITLE,
        description: "Human approval that the current regex-fallback analysis is sufficient for final proposal generation.",
        isResolved: true,
        resolvedNote,
      },
    });
  }
}

/** Revokes the human approval (e.g. user toggled off). Idempotent. */
export async function revokeRegexFallbackApproval(client: PrismaClient, tenderId: string): Promise<void> {
  const existing = await client.complianceGap.findFirst({
    where: { tenderId, title: ANALYSIS_APPROVAL_GAP_TITLE, severity: "ADVISORY" },
    select: { id: true },
  });
  if (existing) await client.complianceGap.delete({ where: { id: existing.id } });
}

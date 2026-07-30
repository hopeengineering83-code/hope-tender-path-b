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
// Storage: analysis approval is recorded by re-using the existing
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
  // Anchored to the start of a line (`^` + `m` flag) and bounded with
  // `\b` so that "REGEX_FALLBACK_AI_ERROR" appearing mid-sentence in a
  // notes blob can NEVER match. Without the anchor, the old regex
  // `/analysis\s+source:\s*regex\s+fallback/i` could be tripped by any
  // line containing those words out of order — and worse, the AI
  // variant below could match "REGEX_FALLBACK_AI_ERROR" because of the
  // bare "ai" substring. The anchor + word boundary closes that hole.
  return /^analysis\s+source:\s*regex\s+fallback\b/im.test(notes ?? "");
}

function notesIncludeAiAnalysis(notes?: string | null): boolean {
  // Anchored + word-bounded so that "REGEX_FALLBACK_AI_ERROR" in notes
  // (which contains the substring "ai") can NEVER be misread as an AI
  // success marker. This is the Root Cause #3 fix — without the `^`
  // anchor and `\b` word boundary, the legacy regex
  // `/analysis\s+source:\s*ai/i` matched "Analysis source: regex
  // fallback (REGEX_FALLBACK_AI_ERROR)" and unlocked generation/export
  // on a tender that had actually fallen back to regex.
  return /^analysis\s+source:\s*ai\b/im.test(notes ?? "");
}

/** Synchronous detection from the tender.notes line alone. Does NOT
 * consider auto-approval — call `detectAnalysisSourceWithApproval`
 * for the full picture. */
export function detectAnalysisSource(tender: TenderAnalysisSourceLike): AnalysisSource {
  if (notesIncludeRegexFallback(tender.notes)) return "REGEX_FALLBACK_AI_ERROR";
  if (notesIncludeAiAnalysis(tender.notes)) return "AI";
  return "UNKNOWN";
}

/** Returns the analysis source including auto-approval.
 * Looks up an ANALYSIS_APPROVAL ComplianceGap row to decide whether
 * a regex-fallback analysis has been auto-approved.
 *
 * NOTE: As of the release-safety consolidation, analysis approval is AUDIT-ONLY.
 * `HUMAN_APPROVED_REGEX_FALLBACK` is still returned here so panels can display
 * the audit trail, but it MUST NEVER be treated as ready/ok by any release
 * path (generate, export, download, regenerate, AI proposal, missing-file
 * generation, ZIP). The release paths use `assertAnalysisReadyForFinalGeneration`
 * below, which only authorizes on `AI` / `AI_SUCCEEDED`.
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
 * analysis. Returns {ok: true} ONLY when the analysis is genuine AI
 * (AI_SUCCEEDED / "AI"). HUMAN_APPROVED_FALLBACK and
 * HUMAN_APPROVED_REGEX_FALLBACK are PERMANENTLY BLOCKED — analysis approval is
 * audit-only and MUST NEVER authorize generation, export, download,
 * regeneration, AI proposal, missing-file generation, or ZIP.
 *
 * FM-009 FIX: Tries the canonical resolver (resolveTenderAnalysisState)
 * first, which checks both tender.notes AND AiJob/AiAnalyzeChunk rows.
 * Falls back to detectAnalysisSourceWithApproval if the canonical resolver
 * is unavailable.
 */
export async function assertAnalysisReadyForFinalGeneration(
  client: PrismaClient,
  tenderId: string,
  tender: TenderAnalysisSourceLike,
): Promise<AnalysisGateResult> {
  // Try the canonical resolver first — it looks at AiJob rows, not just notes.
  try {
    const tenderRow = await client.tender.findUnique({
      where: { id: tenderId },
      select: { userId: true },
    });
    if (tenderRow) {
      const { resolveTenderAnalysisState } = await import("./analysis-state-resolver");
      // FIX (central readiness gate): pass the real Prisma client. The previous
      // `null as any` made resolveTenderAnalysisState throw on its first query,
      // which the catch below swallowed — silently demoting this gate to the
      // notes-only legacy path and defeating the canonical AiJob/chunk checks.
      const detail = await resolveTenderAnalysisState(client, tenderId, tenderRow.userId);
      // ONLY AI_SUCCEEDED authorizes release. HUMAN_APPROVED_FALLBACK is
      // permanently blocked — analysis approval is audit-only.
      if (detail.state === "AI_SUCCEEDED") {
        return { ok: true };
      }
      if (detail.state === "HUMAN_APPROVED_FALLBACK") {
        return {
          ok: false,
          code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
          message: "Latest analysis used the regex fallback (AI providers failed) and was human-approved as audit-only. Human approval no longer authorizes final proposal generation, export, download, regeneration, AI proposal, missing-file generation, or ZIP. Re-run AI Analyze with healthy providers to produce a genuine AI analysis.",
          nextAction: "RERUN_AI_ANALYZE",
        };
      }
      if (detail.state === "NOT_STARTED") {
        return {
          ok: false,
          code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
          message: "Analysis source has not been confirmed. Run AI analysis before final proposal generation. You may also approve the current regex-fallback analysis as audit-only — approval is recorded but does NOT authorize release.",
          nextAction: "RUN_ENGINE_OR_APPROVE_ANALYSIS",
        };
      }
      return {
        ok: false,
        code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
        message: "Latest analysis used the regex fallback (AI providers failed). Final proposal generation is blocked until AI analysis is re-run successfully. You may approve the current regex-fallback analysis as audit-only — approval is recorded but does NOT authorize release.",
        nextAction: "RUN_ENGINE_OR_APPROVE_ANALYSIS",
      };
    }
  } catch {
    // Fall through to the legacy notes-based check.
  }

  // Legacy fallback: notes-based detection only.
  // ONLY "AI" authorizes release. HUMAN_APPROVED_REGEX_FALLBACK is permanently
  // blocked — analysis approval is audit-only.
  const source = await detectAnalysisSourceWithApproval(client, tenderId, tender);
  if (source === "AI") return { ok: true };
  if (source === "HUMAN_APPROVED_REGEX_FALLBACK") {
    return {
      ok: false,
      code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
      message: "Latest analysis used the regex fallback and was human-approved as audit-only. Human approval no longer authorizes final proposal generation, export, download, regeneration, AI proposal, missing-file generation, or ZIP. Re-run AI Analyze with healthy providers to produce a genuine AI analysis.",
      nextAction: "RERUN_AI_ANALYZE",
    };
  }
  if (source === "UNKNOWN") {
    return {
      ok: false,
      code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
      message: "Analysis source has not been confirmed. Run AI analysis before final proposal generation. You may also approve the current regex-fallback analysis as audit-only — approval is recorded but does NOT authorize release.",
      nextAction: "RUN_ENGINE_OR_APPROVE_ANALYSIS",
    };
  }
  return {
    ok: false,
    code: "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
    message: "Latest analysis used the regex fallback (AI providers failed). Final proposal generation is blocked until AI analysis is re-run successfully. You may approve the current regex-fallback analysis as audit-only — approval is recorded but does NOT authorize release.",
    nextAction: "RUN_ENGINE_OR_APPROVE_ANALYSIS",
  };
}

/** Records approval of a regex-fallback analysis. Idempotent. */
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
        description: "Approval that the regex-fallback analysis is sufficient for final proposal generation.",
        isResolved: true,
        resolvedNote,
      },
    });
  }
}

/** Revokes the approval (e.g. user toggled off). Idempotent. */
export async function revokeRegexFallbackApproval(client: PrismaClient, tenderId: string): Promise<void> {
  const existing = await client.complianceGap.findFirst({
    where: { tenderId, title: ANALYSIS_APPROVAL_GAP_TITLE, severity: "ADVISORY" },
    select: { id: true },
  });
  if (existing) await client.complianceGap.delete({ where: { id: existing.id } });
}

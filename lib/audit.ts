import { prisma } from "./prisma";
import { logger } from "./observability";

export type AuditAction =
  | "LOGIN" | "LOGOUT"
  | "COMPANY_DOCUMENT_UPLOAD" | "COMPANY_DOCUMENT_DELETE" | "COMPANY_DOCUMENT_REEXTRACT" | "COMPANY_KNOWLEDGE_REPAIR"
  | "COMPANY_KNOWLEDGE_REPAIR_BLOCKED" | "COMPANY_KNOWLEDGE_REPAIR_SUCCESS"
  | "COMPANY_ASSET_UPLOAD" | "COMPANY_ASSET_DELETE"
  | "TENDER_CREATE" | "TENDER_UPDATE" | "TENDER_DELETE"
  | "TENDER_FILE_UPLOAD"
  | "TENDER_ANALYSIS_RUN" | "TENDER_ANALYZED" | "TENDER_MATCHED" | "TENDER_GENERATED" | "TENDER_VALIDATED" | "TENDER_EXPORTED"
  | "TENDER_WORKFLOW_RUN"
  | "ENGINE_RUN" | "AI_ANALYZE" | "AI_PROPOSAL"
  | "EXPORT_PACKAGE_CREATE" | "EXPORT_PACKAGE_DOWNLOAD" | "EXPORT_PACKAGE_REPAIR"
  | "OVERRIDE" | "GAP_RESOLVED"
  | "CREATE" | "UPDATE" | "DELETE"
  | "DOCUMENT_REVIEW"
  // PR #247 — DocumentComment audit actions for the per-document
  // approval / threaded-comment workflow.
  | "DOCUMENT_COMMENT" | "DOCUMENT_COMMENT_UPDATE"
  // PR #251 — Evaluator Persona Simulator runs (4-persona synthetic
  // panel scoring before submission).
  | "EVALUATOR_SIMULATION_RUN"
  // PR #255 — Multi-Perspective AI Rematch (re-scores expert/project
  // matches via Claude with 4-perspective evaluation).
  | "AI_REMATCH_RUN"
  | "TENDER_DUPLICATE"
  // Tender engine audit trail (run-tender-engine.ts writeEngineRunAudit).
  | "TENDER_ENGINE_RUN_STARTED"
  | "TENDER_ENGINE_RUN_COMPLETED"
  | "TENDER_ENGINE_RUN_FAILED"
  | "TENDER_ENGINE_DOCUMENTS_SUPERSEDED"
  // Bid/No-Bid decision engine applied or overridden.
  | "TENDER_BID_DECISION_APPLIED"
  // Tender AI Copilot question answered.
  | "TENDER_COPILOT_QUESTION"
  // Evaluator committee simulation result recorded.
  | "EVALUATOR_COMMITTEE_RESULT"
  // Evaluator objection closure workflow.
  | "EVALUATOR_OBJECTION_RESOLVED"
  | "EVALUATOR_OBJECTION_WAIVED"
  // Tender Control Ledger entries (one per control type).
  | "TENDER_CONTROL_ADDENDUM"
  | "TENDER_CONTROL_CLARIFICATION"
  | "TENDER_CONTROL_QUESTION"
  | "TENDER_CONTROL_MILESTONE"
  | "TENDER_CONTROL_TASK"
  | "TENDER_CONTROL_RISK"
  | "TENDER_CONTROL_COMMERCIAL_ASSUMPTION"
  // Suggestion accept/reject from the Controls Ledger panel (H).
  // ACCEPTED is implicit (a new TENDER_CONTROL_* row is written when a
  // suggestion is accepted); REJECTED records the decision so the panel
  // can hide the suggestion on the next reload.
  | "TENDER_CONTROL_SUGGESTION_REJECTED"
  | "TENDER_BID_OUTCOME_SET"
  // Maintenance: regenerate Expert CV DOCX files after the trace-stripper
  // fix landed in expert-cv-docx.ts. Triggered via /regenerate-cvs.
  | "EXPERT_CV_REGENERATE"
  // Central generation gate blocked a GENERATED-document persist on the
  // interactive AI-proposal path. The proposal text is still returned to
  // the UI, but it is NOT persisted as a GeneratedDocument until the
  // tender is genuinely ready (analysis SUCCEEDED + promoted + grounded).
  | "AI_PROPOSAL_PERSIST_BLOCKED"
  // Manual reconciliation of GeneratedDocument rows against the current
  // submission plan (POST /api/tenders/[id]/reconcile-docs).
  | "TENDER_DOCS_RECONCILED"
  // Round 6 — deep-reasoning generation telemetry. Emitted once per
  // proposal generation when TENDER_DEEP_REASONING is on and at least
  // one deep-reasoning capability ran. Metadata carries:
  //   - tenderId, generatedDocumentId (when known)
  //   - comprehension: { criteriaCount, disqualifierCount, prohibitionCount, totalWeight }
  //   - alignment: { alignmentCount, criterionCoverageCount }
  //   - refinement: { applied, iterations, scoreLift }
  //   - telemetry: { totalCalls, totalMs, byStep }
  // Allows operators to query historical deep-reasoning runs without
  // parsing console logs.
  | "TENDER_DEEP_REASONING_RUN"
  | "DOCUMENT_GENERATE"
  | "VAULT_EVIDENCE_LINKED"
  | "OUTSIDE_PLAN_SUPERSEDED"
  | "AUTO_FINALIZE_RUN"
  // Donor advisory resolution recorded against a tender (Export Readiness
  // panel → mark advisory NOT_REQUIRED_BY_TOR / POST_AWARD_DELIVERABLE /
  // DONOR_TEMPLATE_PROVIDED / ADDED_TO_TECHNICAL / REOPEN).
  | "ADVISORY_RESOLUTION"
  // Human approval / revocation of a regex-fallback analysis. Recorded
  // when a senior engineer confirms a regex-fallback analysis is
  // sufficient (or revokes that confirmation), so the readiness scoring
  // helper and the generate route can decide whether to allow final
  // proposal generation from that analysis.
  | "ANALYSIS_REGEX_FALLBACK_APPROVED"
  | "ANALYSIS_REGEX_FALLBACK_REVOKED"
  // Generate routes refused to produce a final proposal because the
  // analysis source was an unapproved regex fallback (see
  // lib/engine/analysis-source.ts).
  | "GENERATION_BLOCKED_REGEX_FALLBACK"
  // Bulk reassessment of generated documents against the quality gate.
  // POST /api/admin/generated-proposals/reassess records this with the
  // demoted-count + inspected-count in description.
  | "QUALITY_REASSESSMENT"
  // AI provider chain failed over from one provider to the next
  // (Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic). Tracked so
  // an operator can confirm a fallback was attempted before regex was used.
  | "AI_PROVIDER_FAILOVER"
  // Knowledge vault — expert and project lifecycle events.
  | "EXPERT_CREATE" | "EXPERT_UPDATE" | "EXPERT_DELETE" | "EXPERT_REVIEW"
  | "PROJECT_CREATE" | "PROJECT_UPDATE" | "PROJECT_DELETE" | "PROJECT_REVIEW"
  // Document reclassification and deduplication maintenance routes.
  | "DOCUMENT_RECLASSIFY"
  | "DOCUMENT_DEDUPLICATE"
  // Per-row submission-plan recovery actions (reclassify / mark-not-exportable /
  // supersede / exclude) from the Submission Plan Completeness panel.
  | "SUBMISSION_PLAN_ROW_ACTION"
  // Explicit plan and evidence-confirmation workflow actions.
  | "SUBMISSION_PLAN_BUILT"
  | "SUBMISSION_PLAN_CONFIRMED"
  | "SUBMISSION_PLAN_AUTO_CLASSIFY"
  | "TENDER_PLAN_BUILT"
  | "REQUIREMENT_EVIDENCE_CONFIRMED"
  | "REQUIREMENT_EVIDENCE_SUGGESTION_REJECTED"
  | "REQUIREMENT_COVERAGE_MANUALLY_CONFIRMED"
  | "REQUIREMENT_SUPPORT_LEVEL_SET"
  // Metadata repair from source text (deterministic extractor) and
  // manual confirmation by the user via the tender edit form.
  | "TENDER_METADATA_REPAIRED"
  | "TENDER_METADATA_MANUAL_CONFIRMED"
  | "LOGIN_FAILED"
  | "COMPANY_PROFILE_UPDATED"
  | "SETTINGS_UPDATED"
  // Metadata field override — user marks a field NOT_APPLICABLE, USER_CONFIRMED,
  // USER_EDITED, or IGNORED_WITH_REASON via the metadata completion panel.
  | "TENDER_METADATA_OVERRIDE"
  // Admin maintenance/recovery operations from the Recovery Command Center
  // and admin maintenance routes.
  | "TENDER_EVIDENCE_SELECT" | "TENDER_EVIDENCE_CONFIRM" | "TENDER_EVIDENCE_NOT_APPLICABLE" | "ADMIN_RELEASE_STUCK_JOBS"
  | "ADMIN_REPAIR_EXECUTED"
  | "VALIDATE_DOCUMENTS";

export async function logAction(opts: {
  userId?: string;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  description: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
}) {
  try {
    const meta = opts.requestId
      ? { ...opts.metadata, requestId: opts.requestId }
      : (opts.metadata ?? {});
    await prisma.auditLog.create({
      data: {
        userId: opts.userId ?? null,
        action: opts.action,
        entityType: opts.entityType ?? null,
        entityId: opts.entityId ?? null,
        description: opts.description,
        metadata: JSON.stringify(meta),
      },
    });
  } catch (e) {
    // Never let audit logging crash the main flow — but surface the failure so
    // operators can detect audit-trail gaps (which may indicate DB outages or,
    // worse, evidence-tampering detection gaps). Previously this was a bare
    // `catch {}` and audit failures were invisible.
    logger.warn("[audit] write failed — audit trail gap possible", {
      detail: e,
      action: opts.action,
      entityType: opts.entityType ?? null,
      entityId: opts.entityId ?? null,
    });
  }
}

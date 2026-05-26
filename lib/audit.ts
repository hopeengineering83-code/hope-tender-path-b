import { prisma } from "./prisma";

export type AuditAction =
  | "LOGIN" | "LOGOUT"
  | "COMPANY_DOCUMENT_UPLOAD" | "COMPANY_DOCUMENT_DELETE" | "COMPANY_DOCUMENT_REEXTRACT" | "COMPANY_KNOWLEDGE_REPAIR"
  | "COMPANY_KNOWLEDGE_REPAIR_BLOCKED" | "COMPANY_KNOWLEDGE_REPAIR_SUCCESS"
  | "COMPANY_ASSET_UPLOAD" | "COMPANY_ASSET_DELETE"
  | "TENDER_CREATE" | "TENDER_UPDATE" | "TENDER_DELETE"
  | "TENDER_FILE_UPLOAD"
  | "TENDER_ANALYSIS_RUN" | "TENDER_ANALYZED" | "TENDER_MATCHED" | "TENDER_GENERATED" | "TENDER_VALIDATED" | "TENDER_EXPORTED"
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
  | "TENDER_BID_OUTCOME_SET"
  // Maintenance: regenerate Expert CV DOCX files after the trace-stripper
  // fix landed in expert-cv-docx.ts. Triggered via /regenerate-cvs.
  | "EXPERT_CV_REGENERATE"
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
  | "AUTO_FINALIZE_RUN";

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
  } catch {
    // Never let audit logging crash the main flow
  }
}

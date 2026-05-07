import { prisma } from "./prisma";

export type AuditAction =
  | "LOGIN" | "LOGOUT"
  | "COMPANY_DOCUMENT_UPLOAD" | "COMPANY_DOCUMENT_DELETE" | "COMPANY_DOCUMENT_REEXTRACT" | "COMPANY_KNOWLEDGE_REPAIR"
  | "COMPANY_ASSET_UPLOAD" | "COMPANY_ASSET_DELETE"
  | "TENDER_CREATE" | "TENDER_UPDATE" | "TENDER_DELETE"
  | "TENDER_FILE_UPLOAD"
  | "TENDER_ANALYSIS_RUN" | "TENDER_ANALYZED" | "TENDER_MATCHED" | "TENDER_GENERATED" | "TENDER_VALIDATED" | "TENDER_EXPORTED"
  | "ENGINE_RUN" | "AI_ANALYZE" | "AI_PROPOSAL"
  | "EXPORT_PACKAGE_CREATE" | "EXPORT_PACKAGE_DOWNLOAD"
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
  // Bid/No-Bid decision engine applied or overridden.
  | "TENDER_BID_DECISION_APPLIED"
  // Tender AI Copilot question answered.
  | "TENDER_COPILOT_QUESTION"
  // Evaluator committee simulation result recorded.
  | "EVALUATOR_COMMITTEE_RESULT"
  // Tender Control Ledger entries (one per control type).
  | "TENDER_CONTROL_ADDENDUM"
  | "TENDER_CONTROL_CLARIFICATION"
  | "TENDER_CONTROL_QUESTION"
  | "TENDER_CONTROL_MILESTONE"
  | "TENDER_CONTROL_TASK"
  | "TENDER_CONTROL_RISK"
  | "TENDER_CONTROL_COMMERCIAL_ASSUMPTION";

export async function logAction(opts: {
  userId?: string;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: opts.userId ?? null,
        action: opts.action,
        entityType: opts.entityType ?? null,
        entityId: opts.entityId ?? null,
        description: opts.description,
        metadata: JSON.stringify(opts.metadata ?? {}),
      },
    });
  } catch {
    // Never let audit logging crash the main flow
  }
}

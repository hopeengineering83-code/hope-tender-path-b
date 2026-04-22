import { prisma } from "./prisma";

export type AuditAction =
  | "LOGIN" | "LOGOUT"
  | "COMPANY_DOCUMENT_UPLOAD" | "COMPANY_DOCUMENT_DELETE"
  | "COMPANY_ASSET_UPLOAD" | "COMPANY_ASSET_DELETE"
  | "TENDER_CREATE" | "TENDER_UPDATE" | "TENDER_DELETE"
  | "TENDER_FILE_UPLOAD"
  | "TENDER_ANALYZED" | "TENDER_MATCHED" | "TENDER_GENERATED" | "TENDER_VALIDATED" | "TENDER_EXPORTED"
  | "ENGINE_RUN" | "AI_ANALYZE" | "AI_PROPOSAL"
  | "EXPORT_PACKAGE_CREATE" | "EXPORT_PACKAGE_DOWNLOAD"
  | "OVERRIDE" | "GAP_RESOLVED";

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

import { createHash } from "node:crypto";

export type RawAuditLog = {
  id: string;
  action: string;
  entityType: string | null;
  description: string;
  createdAt: Date | string;
};

export type PresentedAuditLog = {
  id: string;
  action: string;
  entityType: string | null;
  description: string;
  createdAt: string;
  count: number;
};

const SAFE_DESCRIPTIONS: Record<string, string> = {
  AUDIT_EVENT: "Audit event recorded.",
  LOGIN: "Signed in.",
  LOGOUT: "Signed out.",
  TENDER_FILE_UPLOAD: "Tender source file uploaded.",
  COMPANY_DOCUMENT_UPLOAD: "Company evidence document uploaded.",
  COMPANY_DOCUMENT_DELETE: "Company evidence document removed.",
  COMPANY_DOCUMENT_REEXTRACT: "Company evidence extraction retried.",
  COMPANY_KNOWLEDGE_REPAIR: "Company knowledge repair completed.",
  COMPANY_KNOWLEDGE_REPAIR_BLOCKED: "Company knowledge repair was blocked.",
  COMPANY_KNOWLEDGE_REPAIR_SUCCESS: "Company knowledge repair completed.",
  TENDER_CREATE: "Tender record created.",
  TENDER_UPDATE: "Tender record updated.",
  TENDER_DELETE: "Tender record removed.",
  TENDER_ANALYSIS_RUN: "Tender analysis started.",
  TENDER_ANALYZED: "Tender analysis completed.",
  TENDER_MATCHED: "Tender evidence matching completed.",
  TENDER_GENERATED: "Tender documents generated.",
  TENDER_VALIDATED: "Tender validation completed.",
  TENDER_EXPORTED: "Tender export completed.",
  TENDER_ENGINE_RUN_STARTED: "Tender processing started.",
  TENDER_ENGINE_RUN_COMPLETED: "Tender processing completed.",
  TENDER_ENGINE_RUN_FAILED: "Tender processing failed.",
  TENDER_ENGINE_DOCUMENTS_SUPERSEDED: "Earlier generated documents were superseded.",
  AI_ANALYZE: "AI analysis queued.",
  AI_PROPOSAL: "AI proposal generation requested.",
  ENGINE_RUN: "Tender processing event recorded.",
  VAULT_EVIDENCE_LINKED: "Vault evidence linked to a generated document.",
  EXPORT_PACKAGE_CREATE: "Export package prepared.",
  EXPORT_PACKAGE_DOWNLOAD: "Export package downloaded.",
  EXPORT_PACKAGE_REPAIR: "Export package repair completed.",
  EXPERT_REVIEW: "Expert record reviewed with durable source evidence.",
  PROJECT_REVIEW: "Project record reviewed with durable source evidence.",
};

const SAFE_ENTITY_TYPES: Record<string, string> = {
  Company: "Company",
  Tender: "Tender",
  Expert: "Expert",
  Project: "Project",
  GeneratedDocument: "Generated document",
  CompanyDocument: "Company document",
  ExportPackage: "Export package",
  AiProviderHealth: "System health",
};

function publicId(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function safeDescription(action: string): string {
  return SAFE_DESCRIPTIONS[action] ?? "Audit event recorded.";
}

export function isSafeAuditAction(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(SAFE_DESCRIPTIONS, action);
}

function safeEntityType(entityType: string | null): string | null {
  if (!entityType) return null;
  return SAFE_ENTITY_TYPES[entityType] ?? null;
}

export function presentAuditLog(row: RawAuditLog): PresentedAuditLog {
  const createdAt = new Date(row.createdAt);
  const action = isSafeAuditAction(row.action) ? row.action : "AUDIT_EVENT";
  return {
    id: publicId(row.id),
    action,
    entityType: safeEntityType(row.entityType),
    description: safeDescription(action),
    createdAt: Number.isFinite(createdAt.getTime()) ? createdAt.toISOString() : new Date(0).toISOString(),
    count: 1,
  };
}

export function groupAuditLogs(
  rows: RawAuditLog[],
  windowMs = 15 * 60 * 1000,
): PresentedAuditLog[] {
  const presented = rows.map(presentAuditLog);
  const grouped: PresentedAuditLog[] = [];

  for (const current of presented) {
    const currentTime = new Date(current.createdAt).getTime();
    const existing = grouped.find((candidate) =>
      candidate.action === current.action &&
      candidate.entityType === current.entityType &&
      candidate.description === current.description &&
      Math.abs(new Date(candidate.createdAt).getTime() - currentTime) <= windowMs,
    );

    if (existing) {
      existing.count += 1;
      existing.id = publicId(`${existing.id}:${current.id}:${existing.count}`);
      continue;
    }
    grouped.push({ ...current });
  }

  return grouped;
}

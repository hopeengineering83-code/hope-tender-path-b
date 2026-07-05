import { Role } from "../auth";

export type Action =
  | "TENDER_READ"
  | "TENDER_UPDATE"
  | "TENDER_DELETE"
  | "AI_ANALYZE_TRIGGER"
  | "GENERATION_TRIGGER"
  | "REVIEW"
  | "APPROVAL"
  | "FINAL_EXPORT"
  | "COMPANY_KNOWLEDGE_MGMT"
  | "USER_ADMIN"
  | "OPERATIONAL_DIAGNOSTICS"
  | "DATA_REPAIR";

const PERMISSION_MATRIX: Record<Role, Set<Action>> = {
  ADMIN: new Set([
    "TENDER_READ", "TENDER_UPDATE", "TENDER_DELETE",
    "AI_ANALYZE_TRIGGER", "GENERATION_TRIGGER",
    "REVIEW", "APPROVAL", "FINAL_EXPORT",
    "COMPANY_KNOWLEDGE_MGMT", "USER_ADMIN",
    "OPERATIONAL_DIAGNOSTICS", "DATA_REPAIR"
  ]),
  PROPOSAL_MANAGER: new Set([
    "TENDER_READ", "TENDER_UPDATE", "TENDER_DELETE",
    "AI_ANALYZE_TRIGGER", "GENERATION_TRIGGER",
    "REVIEW", "APPROVAL", "FINAL_EXPORT",
    "COMPANY_KNOWLEDGE_MGMT"
  ]),
  REVIEWER: new Set([
    "TENDER_READ", "REVIEW"
  ]),
  VIEWER: new Set([
    "TENDER_READ"
  ]),
};

export function canPerform(role: Role, action: Action): boolean {
  return PERMISSION_MATRIX[role]?.has(action) ?? false;
}

/**
 * Tender Control Ledger — deterministic control record builder.
 *
 * Used by the Control Ledger API route (app/api/tenders/[id]/controls) to
 * normalize incoming control payloads, log them as typed audit events, and
 * reconstruct structured control records from the audit log for display.
 *
 * Control types:
 *   ADDENDUM             — formal document change issued by the client
 *   CLARIFICATION        — question/answer exchange with the client
 *   QUESTION             — internal bid-team question logged for tracking
 *   MILESTONE            — key bid milestone (e.g., draft-ready, reviewed)
 *   TASK                 — bid-team action item requiring follow-up
 *   RISK                 — identified bid risk with severity and mitigation
 *   COMMERCIAL_ASSUMPTION — commercial assumption logged for review
 */

import type { AuditAction } from "../audit";

export type ControlType =
  | "ADDENDUM"
  | "CLARIFICATION"
  | "QUESTION"
  | "MILESTONE"
  | "TASK"
  | "RISK"
  | "COMMERCIAL_ASSUMPTION";

export interface TenderControl {
  type: ControlType;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  owner?: string | null;
  severity?: "HIGH" | "MEDIUM" | "LOW" | null;
  status?: "OPEN" | "RESOLVED" | null;
}

export interface TenderControlRecord extends TenderControl {
  id: string;
  action: string;
  createdAt: string;
  createdBy: string | null;
}

export type ControlSummary = {
  total: number;
  open: number;
  resolved: number;
  highRisk: number;
  byType: Partial<Record<ControlType, number>>;
};

const VALID_TYPES: ControlType[] = [
  "ADDENDUM",
  "CLARIFICATION",
  "QUESTION",
  "MILESTONE",
  "TASK",
  "RISK",
  "COMMERCIAL_ASSUMPTION",
];

const ACTION_MAP: Record<ControlType, AuditAction> = {
  ADDENDUM: "TENDER_CONTROL_ADDENDUM",
  CLARIFICATION: "TENDER_CONTROL_CLARIFICATION",
  QUESTION: "TENDER_CONTROL_QUESTION",
  MILESTONE: "TENDER_CONTROL_MILESTONE",
  TASK: "TENDER_CONTROL_TASK",
  RISK: "TENDER_CONTROL_RISK",
  COMMERCIAL_ASSUMPTION: "TENDER_CONTROL_COMMERCIAL_ASSUMPTION",
};

// ─── Validators ───────────────────────────────────────────────────────────────

function str(value: unknown, max = 500): string {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return s.slice(0, max);
}

function severity(value: unknown): "HIGH" | "MEDIUM" | "LOW" | null {
  if (["HIGH", "MEDIUM", "LOW"].includes(value as string)) return value as "HIGH" | "MEDIUM" | "LOW";
  return null;
}

function status(value: unknown): "OPEN" | "RESOLVED" | null {
  if (["OPEN", "RESOLVED"].includes(value as string)) return value as "OPEN" | "RESOLVED";
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse and validate an incoming control payload. Throws a descriptive
 * Error if the payload is missing required fields or has an unknown type.
 */
export function normalizeTenderControlPayload(body: unknown): TenderControl {
  if (!body || typeof body !== "object") throw new Error("Control payload must be a JSON object.");
  const b = body as Record<string, unknown>;

  const type = str(b.type);
  if (!VALID_TYPES.includes(type as ControlType)) {
    throw new Error(`Invalid control type "${type}". Expected one of: ${VALID_TYPES.join(", ")}.`);
  }

  const title = str(b.title, 240);
  if (!title) throw new Error("Control title is required.");

  return {
    type: type as ControlType,
    title,
    description: b.description ? str(b.description, 1200) : null,
    dueDate: b.dueDate ? str(b.dueDate, 32) : null,
    owner: b.owner ? str(b.owner, 120) : null,
    severity: severity(b.severity),
    status: status(b.status) ?? "OPEN",
  };
}

/**
 * Map a control type to its typed AuditAction string for `logAction()`.
 */
export function controlActionForType(type: string): AuditAction {
  return ACTION_MAP[type as ControlType] ?? "TENDER_CONTROL_TASK";
}

/**
 * Build the human-readable audit log description for a control event.
 */
export function controlDescription(email: string, tenderTitle: string, control: TenderControl): string {
  const severityTag = control.severity ? ` [${control.severity}]` : "";
  const ownerTag = control.owner ? ` (owner: ${control.owner})` : "";
  return `${email} logged ${control.type}${severityTag}: "${control.title}"${ownerTag} on "${tenderTitle}"`;
}

/**
 * Append a short control summary line to the tender's notes field,
 * keeping the existing notes content intact.
 */
export function appendControlNote(existingNotes: string | null, control: TenderControl): string {
  const severityTag = control.severity ? ` [${control.severity}]` : "";
  const line = `[${control.type}${severityTag}] ${control.title}`;
  if (!existingNotes?.trim()) return line;
  return `${existingNotes.trim()}\n${line}`;
}

/**
 * Reconstruct a TenderControlRecord from an AuditLog row. Returns null when
 * the metadata cannot be parsed or the control payload is missing/malformed.
 */
export function auditLogToControlRecord(log: {
  id: string;
  userId: string | null;
  action: string;
  description: string;
  metadata: string;
  createdAt: Date;
}): TenderControlRecord | null {
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(log.metadata) as Record<string, unknown>;
  } catch {
    return null;
  }

  const control = meta.control as Record<string, unknown> | undefined;
  if (!control || typeof control !== "object") return null;

  const type = str(control.type);
  if (!VALID_TYPES.includes(type as ControlType)) return null;

  const title = str(control.title, 240);
  if (!title) return null;

  return {
    id: log.id,
    type: type as ControlType,
    title,
    description: control.description ? str(control.description, 1200) : null,
    dueDate: control.dueDate ? str(control.dueDate, 32) : null,
    owner: control.owner ? str(control.owner, 120) : null,
    severity: severity(control.severity),
    status: status(control.status) ?? "OPEN",
    action: log.action,
    createdAt: log.createdAt.toISOString(),
    createdBy: log.userId,
  };
}

/**
 * Summarize a list of control records for the GET /controls endpoint.
 */
export function controlSummary(records: TenderControlRecord[]): ControlSummary {
  const byType: Partial<Record<ControlType, number>> = {};
  let open = 0;
  let resolved = 0;
  let highRisk = 0;

  for (const r of records) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    if (r.status === "RESOLVED") resolved++;
    else open++;
    if (r.severity === "HIGH") highRisk++;
  }

  return { total: records.length, open, resolved, highRisk, byType };
}

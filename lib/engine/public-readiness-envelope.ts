export type PublicReadinessStatus = "READY" | "PARTIAL" | "BLOCKED";

export type PublicReadinessBlocker = {
  code?: string | null;
  message: string;
  nextAction?: string | null;
  severity?: string | null;
};

export type PublicReadinessWarning = PublicReadinessBlocker;

export type PublicReadinessEnvelope = {
  ok: boolean;
  status: PublicReadinessStatus;
  blockers: PublicReadinessBlocker[];
  warnings: PublicReadinessWarning[];
  primaryBlockerReason: string | null;
  primaryFixAction: string | null;
  requiredDocumentsTotal: number;
  generatedDocumentsTotal: number;
  exportReadyDocumentsTotal: number;
};

function asNonNegativeInteger(value: unknown): number {
  return Math.max(0, Math.trunc(typeof value === "number" && Number.isFinite(value) ? value : 0));
}

const INTERNAL_ERROR_TEXT = /Prisma|SQLSTATE|DATABASE_URL|SESSION_SECRET|stack\s+trace|TypeError|ReferenceError|\bP20\d{2}\b/i;

function sanitizePublicText(value: string): string {
  const text = value.trim().slice(0, 500);
  if (INTERNAL_ERROR_TEXT.test(text)) return "Readiness check could not be completed safely.";
  return text
    .replace(/\bmetadata\s+is\b/gi, "tender details are")
    .replace(/\bmetadata\b/gi, "tender details");
}

function normalizeMessage(value: unknown): string {
  if (typeof value === "string") return sanitizePublicText(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const candidate of [record.message, record.title, record.reason, record.code]) {
      if (typeof candidate === "string" && candidate.trim()) return sanitizePublicText(candidate);
    }
  }
  return "Readiness blocker";
}

function normalizeAction(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const action = record.nextAction ?? record.action ?? record.recommendedAction;
  return typeof action === "string" && action.trim() ? action : null;
}

export function normalizePublicBlocker(value: unknown): PublicReadinessBlocker {
  if (typeof value === "string") return { message: sanitizePublicText(value) };
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    code: typeof record.code === "string" ? record.code : typeof record.category === "string" ? record.category : null,
    message: normalizeMessage(value),
    nextAction: normalizeAction(value),
    severity: typeof record.severity === "string" ? record.severity : null,
  };
}

export function buildPublicReadinessEnvelope(input: {
  ok: boolean;
  status?: PublicReadinessStatus;
  blockers?: unknown[] | null;
  warnings?: unknown[] | null;
  primaryBlockerReason?: string | null;
  primaryFixAction?: string | null;
  requiredDocumentsTotal?: number | null;
  generatedDocumentsTotal?: number | null;
  exportReadyDocumentsTotal?: number | null;
}): PublicReadinessEnvelope {
  const blockers = (input.blockers ?? []).map(normalizePublicBlocker);
  const warnings = (input.warnings ?? []).map(normalizePublicBlocker);
  const requiredDocumentsTotal = asNonNegativeInteger(input.requiredDocumentsTotal);
  const generatedDocumentsTotal = asNonNegativeInteger(input.generatedDocumentsTotal);
  const exportReadyDocumentsTotal = asNonNegativeInteger(input.exportReadyDocumentsTotal);

  if (exportReadyDocumentsTotal > generatedDocumentsTotal) {
    blockers.push({
      code: "READINESS_COUNT_CONTRADICTION",
      message: "Export-ready document count exceeds generated document count.",
      nextAction: "RECHECK_DOCUMENT_READINESS",
      severity: "HIGH",
    });
  }
  if (requiredDocumentsTotal > 0 && exportReadyDocumentsTotal > requiredDocumentsTotal) {
    blockers.push({
      code: "READINESS_COUNT_CONTRADICTION",
      message: "Export-ready document count exceeds required document count.",
      nextAction: "RECONCILE_OUTSIDE_PLAN_DOCS",
      severity: "HIGH",
    });
  }

  const blocked = !input.ok || blockers.length > 0;
  const status: PublicReadinessStatus = input.status === "PARTIAL" && blockers.length === 0
    ? "PARTIAL"
    : blocked
      ? "BLOCKED"
      : "READY";
  const ok = status === "READY";
  const primary = blockers[0] ?? warnings[0] ?? null;
  return {
    ok,
    status,
    blockers,
    warnings,
    primaryBlockerReason: primary?.message ?? input.primaryBlockerReason ?? null,
    primaryFixAction: primary?.nextAction ?? input.primaryFixAction ?? null,
    requiredDocumentsTotal,
    generatedDocumentsTotal,
    exportReadyDocumentsTotal,
  };
}

export function assertPublicReadinessAgreement(payloads: PublicReadinessEnvelope[]): { ok: boolean; contradictions: string[] } {
  const contradictions: string[] = [];
  for (const payload of payloads) {
    if (payload.exportReadyDocumentsTotal > payload.generatedDocumentsTotal) {
      contradictions.push("exportReadyDocumentsTotal exceeds generatedDocumentsTotal");
    }
    if (payload.requiredDocumentsTotal > 0 && payload.exportReadyDocumentsTotal > payload.requiredDocumentsTotal) {
      contradictions.push("exportReadyDocumentsTotal exceeds requiredDocumentsTotal");
    }
    if (!payload.ok && payload.status === "READY") {
      contradictions.push("blocked payload reports READY status");
    }
    if (payload.ok && payload.blockers.length > 0) {
      contradictions.push("ok payload contains blockers");
    }
  }
  const anyBlocked = payloads.some((payload) => !payload.ok || payload.status !== "READY");
  if (anyBlocked) {
    for (const payload of payloads) {
      if (payload.ok || payload.status === "READY") contradictions.push("route reports ready while another route is blocked");
    }
  }
  return { ok: contradictions.length === 0, contradictions: [...new Set(contradictions)] };
}

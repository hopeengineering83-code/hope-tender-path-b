export type PublicReadinessStatus = "READY" | "PARTIAL" | "BLOCKED";

export type PublicReadinessBlocker = {
  code?: string | null;
  message: string;
  nextAction?: string | null;
  severity?: string | null;
  [key: string]: unknown;
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

function normalizeMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.message ?? record.title ?? record.reason ?? record.code ?? "Readiness blocker");
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
  if (typeof value === "string") return { message: value };
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    ...record,
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
  const primary = blockers[0] ?? warnings[0] ?? null;
  const requiredDocumentsTotal = asNonNegativeInteger(input.requiredDocumentsTotal);
  const generatedDocumentsTotal = asNonNegativeInteger(input.generatedDocumentsTotal);
  const exportReadyDocumentsTotal = asNonNegativeInteger(input.exportReadyDocumentsTotal);
  const ok = Boolean(input.ok) && blockers.length === 0;
  return {
    ok,
    status: input.status ?? (ok ? "READY" : "BLOCKED"),
    blockers,
    warnings,
    primaryBlockerReason: input.primaryBlockerReason ?? primary?.message ?? null,
    primaryFixAction: input.primaryFixAction ?? primary?.nextAction ?? null,
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

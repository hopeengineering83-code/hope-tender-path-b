import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { logAction } from "../audit";

export type TenderWorkflowOperation =
  | "UPLOAD_SOURCE"
  | "EXTRACT_SOURCE"
  | "AI_ANALYZE"
  | "BUILD_PLAN"
  | "GENERATE_DRAFT"
  | "GENERATE_SUPPORT_FILES"
  | "REGENERATE_SECTION"
  | "REVIEW_EXPORT"
  | "FINAL_SUBMISSION_CHECK"
  | "BUILD_FINAL_ZIP"
  | "DOWNLOAD_PACKAGE";

export type TenderWorkflowStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";

export type TenderWorkflowResult = {
  ok: boolean;
  operation: TenderWorkflowOperation;
  tenderId: string;
  tenantId: string;
  runId: string;
  idempotencyKey: string;
  status: TenderWorkflowStatus;
  createdDocumentIds?: string[];
  createdFileIds?: string[];
  packageId?: string;
  warnings: string[];
  blockers: string[];
  recoverable: boolean;
  nextAction?: string;
  auditId?: string;
};

type WorkflowRunRow = {
  id: string;
  companyId: string;
  tenderId: string;
  operation: string;
  idempotencyKey: string;
  status: string;
  inputHash: string | null;
  outputHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  warningsJson: unknown;
  resultJson: unknown;
};

export class WorkflowError extends Error {
  constructor(
    public readonly errorCode: WorkflowErrorCode,
    message: string,
    public readonly status = 500,
    public readonly recoverable = true,
    public readonly nextAction?: string,
    public readonly blockers: string[] = [],
  ) { super(message); }
}

export type WorkflowErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "TENANT_MISMATCH"
  | "TENDER_NOT_FOUND"
  | "SOURCE_FILE_MISSING"
  | "SOURCE_UNREADABLE"
  | "OPERATION_IN_PROGRESS"
  | "IDEMPOTENCY_REPLAY"
  | "PROVIDER_FAILURE"
  | "GENERATION_FAILED"
  | "FILE_BYTES_INVALID"
  | "PACKAGE_MANIFEST_INVALID"
  | "FINAL_PACKAGE_STALE"
  | "FINAL_PACKAGE_NOT_READY";

export type WorkflowRouteJson = {
  ok: boolean;
  operation: TenderWorkflowOperation | string;
  runId?: string;
  status?: TenderWorkflowStatus | string;
  warnings: string[];
  blockers: string[];
  errorCode?: WorkflowErrorCode | string;
  nextAction?: string;
  recoverable: boolean;
};

export function workflowRouteResult(result: TenderWorkflowResult, extra: Record<string, unknown> = {}): WorkflowRouteJson & Record<string, unknown> {
  return {
    ok: result.ok,
    operation: result.operation,
    runId: result.runId,
    status: result.status,
    warnings: result.warnings,
    blockers: result.blockers,
    recoverable: result.recoverable,
    nextAction: result.nextAction,
    ...extra,
  };
}

export function workflowRouteError(operation: TenderWorkflowOperation, errorCode: WorkflowErrorCode, message: string, extra: Partial<WorkflowRouteJson> = {}): WorkflowRouteJson & { error: string; errorCode: WorkflowErrorCode } {
  return {
    ok: false,
    operation,
    warnings: extra.warnings ?? [],
    blockers: extra.blockers ?? [message],
    error: message,
    errorCode,
    nextAction: extra.nextAction,
    recoverable: extra.recoverable ?? true,
    status: extra.status ?? "failed",
    runId: extra.runId,
  };
}

export function deriveIdempotencyKey(args: { explicitKey?: string | null; tenantId: string; tenderId: string; operation: TenderWorkflowOperation; requestBody?: unknown; sourceFingerprint?: string | null }): string {
  const explicit = args.explicitKey?.trim();
  if (explicit) return sanitizeIdempotencyKey(explicit);
  return computeStableHash({ tenantId: args.tenantId, tenderId: args.tenderId, operation: args.operation, requestBody: args.requestBody ?? null, sourceFingerprint: args.sourceFingerprint ?? null });
}

export function extractWorkflowIdempotencyKey(req: Request, body?: Record<string, unknown> | null): string | null {
  const header = req.headers.get("idempotency-key") ?? req.headers.get("x-idempotency-key") ?? req.headers.get("x-request-id");
  const bodyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : null;
  return sanitizeIdempotencyKey(header ?? bodyKey ?? "") || null;
}

function sanitizeIdempotencyKey(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9:._-]+/g, "-").slice(0, 180);
}

export function computeStableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

function parseResult(row: WorkflowRunRow): TenderWorkflowResult | null {
  if (!row.resultJson || typeof row.resultJson !== "object") return null;
  const result = row.resultJson as Partial<TenderWorkflowResult>;
  if (!result.runId || !result.operation || !result.tenderId || !result.tenantId) return null;
  return {
    ok: Boolean(result.ok),
    operation: result.operation as TenderWorkflowOperation,
    tenderId: result.tenderId,
    tenantId: result.tenantId,
    runId: result.runId,
    idempotencyKey: result.idempotencyKey ?? row.idempotencyKey,
    status: (result.status ?? row.status.toLowerCase()) as TenderWorkflowStatus,
    createdDocumentIds: result.createdDocumentIds,
    createdFileIds: result.createdFileIds,
    packageId: result.packageId,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    blockers: Array.isArray(result.blockers) ? result.blockers : [],
    recoverable: result.recoverable !== false,
    nextAction: result.nextAction,
    auditId: result.auditId,
  };
}

function normalizeStatus(status: string): TenderWorkflowStatus {
  const lower = status.toLowerCase();
  if (["queued", "running", "succeeded", "failed", "cancelled", "skipped"].includes(lower)) return lower as TenderWorkflowStatus;
  return "failed";
}

export async function runTenderWorkflow<T>(args: {
  prisma: PrismaClient;
  tenantId: string;
  tenderId: string;
  userId: string;
  operation: TenderWorkflowOperation;
  idempotencyKey: string;
  inputHash?: string | null;
  execute: (ctx: { tx: Prisma.TransactionClient; runId: string }) => Promise<Omit<Partial<TenderWorkflowResult>, "operation" | "tenderId" | "tenantId" | "runId" | "idempotencyKey"> & { payload?: T }>;
}): Promise<TenderWorkflowResult & { payload?: T; replayed?: boolean }> {
  const existing = await args.prisma.tenderWorkflowRun.findUnique({
    where: { companyId_tenderId_operation_idempotencyKey: { companyId: args.tenantId, tenderId: args.tenderId, operation: args.operation, idempotencyKey: args.idempotencyKey } },
  }) as WorkflowRunRow | null;

  if (existing) {
    if (existing.status === "RUNNING" || existing.status === "QUEUED") {
      throw new WorkflowError("OPERATION_IN_PROGRESS", `${args.operation} is already running for this tender.`, 409, true, "Wait for the active run to finish or resume it from workflow status.", [existing.id]);
    }
    const replay = parseResult(existing);
    if (replay) return { ...replay, replayed: true };
  }

  const active = await args.prisma.tenderWorkflowRun.findFirst({
    // Tender-level lock: production operations share source/output state, so a
    // second mutation must not start while any other operation is queued/running.
    where: { companyId: args.tenantId, tenderId: args.tenderId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  }) as WorkflowRunRow | null;
  if (active) {
    throw new WorkflowError("OPERATION_IN_PROGRESS", `${active.operation} is already running for this tender.`, 409, true, "Wait for the active run to finish or resume it from workflow status.", [active.id]);
  }

  const runId = randomUUID();
  try {
    await args.prisma.tenderWorkflowRun.create({
      data: {
        id: runId,
        companyId: args.tenantId,
        tenderId: args.tenderId,
        operation: args.operation,
        idempotencyKey: args.idempotencyKey,
        status: "RUNNING",
        phase: "execute",
        inputHash: args.inputHash ?? null,
        startedAt: new Date(),
        warningsJson: [],
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const replay = await args.prisma.tenderWorkflowRun.findUnique({
        where: { companyId_tenderId_operation_idempotencyKey: { companyId: args.tenantId, tenderId: args.tenderId, operation: args.operation, idempotencyKey: args.idempotencyKey } },
      }) as WorkflowRunRow | null;
      if (replay?.status === "RUNNING" || replay?.status === "QUEUED") {
        throw new WorkflowError("OPERATION_IN_PROGRESS", `${args.operation} is already running for this tender.`, 409, true, "Wait for the active run to finish or resume it from workflow status.", [replay.id]);
      }
      const replayResult = replay ? parseResult(replay) : null;
      if (replayResult) return { ...replayResult, replayed: true };
    }
    throw error;
  }

  try {
    const executed = await args.prisma.$transaction(async (tx) => args.execute({ tx, runId }));
    const result: TenderWorkflowResult & { payload?: T } = {
      ok: executed.ok !== false,
      operation: args.operation,
      tenderId: args.tenderId,
      tenantId: args.tenantId,
      runId,
      idempotencyKey: args.idempotencyKey,
      status: executed.status ?? "succeeded",
      createdDocumentIds: executed.createdDocumentIds,
      createdFileIds: executed.createdFileIds,
      packageId: executed.packageId,
      warnings: executed.warnings ?? [],
      blockers: executed.blockers ?? [],
      recoverable: executed.recoverable ?? false,
      nextAction: executed.nextAction,
      payload: executed.payload,
    };
    const outputHash = computeStableHash({ createdDocumentIds: result.createdDocumentIds ?? [], createdFileIds: result.createdFileIds ?? [], packageId: result.packageId ?? null, ok: result.ok, status: result.status });
    await args.prisma.tenderWorkflowRun.update({
      where: { id: runId },
      data: { status: result.status.toUpperCase(), phase: "complete", outputHash, warningsJson: result.warnings as Prisma.InputJsonValue, resultJson: toWorkflowResultJson(result), finishedAt: new Date() },
    });
    await auditWorkflow(args.prisma, args.userId, result, args.inputHash ?? null, outputHash, null);
    return result;
  } catch (error) {
    const wf = error instanceof WorkflowError ? error : new WorkflowError("GENERATION_FAILED", error instanceof Error ? error.message : "Workflow operation failed", 500, true, "Retry the operation after reviewing workflow status.");
    const result: TenderWorkflowResult = {
      ok: false,
      operation: args.operation,
      tenderId: args.tenderId,
      tenantId: args.tenantId,
      runId,
      idempotencyKey: args.idempotencyKey,
      status: "failed",
      warnings: [],
      blockers: (wf.blockers.length ? wf.blockers : [wf.message]).map(safeErrorMessage),
      recoverable: wf.recoverable,
      nextAction: wf.nextAction,
    };
    await args.prisma.tenderWorkflowRun.update({
      where: { id: runId },
      data: { status: "FAILED", phase: "failed", errorCode: wf.errorCode, errorMessage: safeErrorMessage(wf.message), resultJson: toWorkflowResultJson(result), finishedAt: new Date() },
    });
    await auditWorkflow(args.prisma, args.userId, result, args.inputHash ?? null, null, wf.errorCode);
    return result;
  }
}

function toWorkflowResultJson(result: TenderWorkflowResult): Prisma.InputJsonValue {
  return {
    ok: result.ok,
    operation: result.operation,
    tenderId: result.tenderId,
    tenantId: result.tenantId,
    runId: result.runId,
    idempotencyKey: result.idempotencyKey,
    status: result.status,
    createdDocumentIds: result.createdDocumentIds ?? [],
    createdFileIds: result.createdFileIds ?? [],
    packageId: result.packageId ?? null,
    warnings: result.warnings,
    blockers: result.blockers,
    recoverable: result.recoverable,
    nextAction: result.nextAction ?? null,
    auditId: result.auditId ?? null,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export function safeErrorMessage(message: string): string {
  return message.replace(/(sk-[a-z0-9_-]+|AIza[\w-]+|AQ[\w-]+|postgres(?:ql)?:\/\/[^\s)]+)/gi, "[REDACTED]").slice(0, 500);
}

async function auditWorkflow(prisma: PrismaClient, userId: string, result: TenderWorkflowResult, inputHash: string | null, outputHash: string | null, errorCode: string | null) {
  await logAction({
    userId,
    action: "TENDER_WORKFLOW_RUN",
    entityType: "Tender",
    entityId: result.tenderId,
    description: `${result.operation} workflow ${result.status}`,
    metadata: {
      tenantId: result.tenantId,
      tenderId: result.tenderId,
      operation: result.operation,
      runId: result.runId,
      idempotencyKey: result.idempotencyKey,
      status: result.status,
      inputHash,
      outputHash,
      createdDocumentIds: result.createdDocumentIds ?? [],
      packageId: result.packageId ?? null,
      warningsCount: result.warnings.length,
      blockersCount: result.blockers.length,
      errorCode,
      timestamp: new Date().toISOString(),
    },
  }, prisma);
}

export function resultFromRunRow(row: WorkflowRunRow): TenderWorkflowResult {
  return parseResult(row) ?? {
    ok: row.status === "SUCCEEDED",
    operation: row.operation as TenderWorkflowOperation,
    tenderId: row.tenderId,
    tenantId: row.companyId,
    runId: row.id,
    idempotencyKey: row.idempotencyKey,
    status: normalizeStatus(row.status),
    warnings: [],
    blockers: row.errorMessage ? [safeErrorMessage(row.errorMessage)] : [],
    recoverable: row.status === "FAILED",
    nextAction: row.status === "FAILED" ? "Retry the operation with a new idempotency key after reviewing workflow status." : undefined,
  };
}

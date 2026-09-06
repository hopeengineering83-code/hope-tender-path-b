import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  MAX_TENDER_PACKAGE_BYTES,
  MAX_TENDER_PACKAGE_FILES,
  MAX_TENDER_UPLOAD_FILE_BYTES,
  MAX_TENDER_UPLOAD_REQUEST_BYTES,
  MAX_TENDER_UPLOAD_REQUEST_FILES,
} from "./tender-upload-package";

export const TENDER_PACKAGE_INTAKE_OPERATION = "TENDER_PACKAGE_INTAKE";
export const TENDER_PACKAGE_BATCH_OPERATION = "TENDER_PACKAGE_BATCH";

const SESSION_RESULT_KIND = "TENDER_PACKAGE_INTAKE_V1";
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenderPackageManifestFile = {
  name: string;
  size: number;
};

export type TenderPackageIntakeDescriptor = {
  sessionId: string;
  batchIndex: number;
  expectedBatches: number;
  expectedFiles: number;
  manifest: TenderPackageManifestFile[][];
  manifestHash: string;
};

export type TenderPackageSessionResult = {
  kind: typeof SESSION_RESULT_KIND;
  sessionId: string;
  expectedBatches: number;
  expectedFiles: number;
  manifest: TenderPackageManifestFile[][];
  receivedBatchIndexes: number[];
  receivedFiles: number;
  missingBatchIndexes: number[];
  analysisJobId: string | null;
  analysisRevision: string | null;
};

type ParseResult =
  | { ok: true; descriptor: TenderPackageIntakeDescriptor | null }
  | { ok: false; error: string; code: string };

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalManifestJson(manifest: TenderPackageManifestFile[][]): string {
  return JSON.stringify(
    manifest.map((batch) => batch.map((file) => ({ name: file.name, size: file.size }))),
  );
}

function parsePositiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Parse and validate the client package descriptor. The descriptor is not a
 * trust boundary for file safety; upload-security still validates every byte.
 * It is a durable completeness/idempotency contract so a lost browser response
 * cannot create a duplicate tender or silently omit a later batch.
 */
export function parseTenderPackageIntake(
  form: FormData,
  files: readonly File[],
): ParseResult {
  const rawSessionId = form.get("intakeSessionId");
  const rawBatchIndex = form.get("intakeBatchIndex");
  const rawExpectedBatches = form.get("intakeExpectedBatches");
  const rawExpectedFiles = form.get("intakeExpectedFiles");
  const rawManifest = form.get("intakeManifest");
  const anyPresent = [rawSessionId, rawBatchIndex, rawExpectedBatches, rawExpectedFiles, rawManifest]
    .some((value) => value !== null);

  // Ordinary "add source files" uploads remain supported outside a package.
  if (!anyPresent) return { ok: true, descriptor: null };

  if (
    typeof rawSessionId !== "string" ||
    typeof rawManifest !== "string" ||
    !SESSION_ID_PATTERN.test(rawSessionId)
  ) {
    return { ok: false, error: "The tender package session identifier is invalid.", code: "INTAKE_SESSION_INVALID" };
  }
  if (rawManifest.length > 30_000) {
    return { ok: false, error: "The tender package manifest is too large.", code: "INTAKE_MANIFEST_INVALID" };
  }

  const batchIndex = parsePositiveInteger(rawBatchIndex);
  const expectedBatches = parsePositiveInteger(rawExpectedBatches);
  const expectedFiles = parsePositiveInteger(rawExpectedFiles);
  if (
    batchIndex === null ||
    expectedBatches === null ||
    expectedFiles === null ||
    expectedBatches < 1 ||
    expectedBatches > MAX_TENDER_PACKAGE_FILES ||
    expectedFiles < 1 ||
    expectedFiles > MAX_TENDER_PACKAGE_FILES ||
    batchIndex >= expectedBatches
  ) {
    return { ok: false, error: "The tender package batch counters are invalid.", code: "INTAKE_COUNTERS_INVALID" };
  }

  let manifest: TenderPackageManifestFile[][];
  try {
    const parsed = JSON.parse(rawManifest) as unknown;
    if (!Array.isArray(parsed)) throw new Error("not-an-array");
    manifest = parsed.map((rawBatch) => {
      if (!Array.isArray(rawBatch)) throw new Error("batch-not-an-array");
      return rawBatch.map((rawFile) => {
        if (!rawFile || typeof rawFile !== "object" || Array.isArray(rawFile)) throw new Error("file-not-an-object");
        const name = (rawFile as { name?: unknown }).name;
        const size = (rawFile as { size?: unknown }).size;
        if (
          typeof name !== "string" ||
          name.length < 1 ||
          name.length > 255 ||
          typeof size !== "number" ||
          !Number.isSafeInteger(size) ||
          size < 1 ||
          size > MAX_TENDER_UPLOAD_FILE_BYTES
        ) {
          throw new Error("invalid-file");
        }
        return { name, size };
      });
    });
  } catch {
    return { ok: false, error: "The tender package manifest is invalid.", code: "INTAKE_MANIFEST_INVALID" };
  }

  if (
    manifest.length !== expectedBatches ||
    manifest.some((batch) => batch.length < 1 || batch.length > MAX_TENDER_UPLOAD_REQUEST_FILES) ||
    manifest.some((batch) => batch.reduce((total, file) => total + file.size, 0) > MAX_TENDER_UPLOAD_REQUEST_BYTES)
  ) {
    return { ok: false, error: "The tender package manifest does not match the secure batch limits.", code: "INTAKE_MANIFEST_INVALID" };
  }

  const flattened = manifest.flat();
  if (
    flattened.length !== expectedFiles ||
    flattened.reduce((total, file) => total + file.size, 0) > MAX_TENDER_PACKAGE_BYTES
  ) {
    return { ok: false, error: "The tender package manifest does not match the declared package size.", code: "INTAKE_MANIFEST_INVALID" };
  }

  const expectedBatch = manifest[batchIndex];
  if (
    expectedBatch.length !== files.length ||
    expectedBatch.some((expected, index) =>
      expected.name !== files[index]?.name || expected.size !== files[index]?.size)
  ) {
    return {
      ok: false,
      error: "This upload does not match the expected files for the tender package batch.",
      code: "INTAKE_BATCH_MISMATCH",
    };
  }

  return {
    ok: true,
    descriptor: {
      sessionId: rawSessionId,
      batchIndex,
      expectedBatches,
      expectedFiles,
      manifest,
      manifestHash: sha256(canonicalManifestJson(manifest)),
    },
  };
}

/** Byte-bound fingerprint used to distinguish a safe retry from key reuse. */
export async function fingerprintTenderPackageBatch(files: readonly File[]): Promise<string> {
  const members: Array<{ name: string; size: number; sha256: string }> = [];
  for (const file of files) {
    members.push({
      name: file.name,
      size: file.size,
      sha256: sha256(Buffer.from(await file.arrayBuffer())),
    });
  }
  return sha256(JSON.stringify(members));
}

export function packageBatchKey(sessionId: string, batchIndex: number): string {
  return `${sessionId}:${batchIndex}`;
}

export function initialTenderPackageSessionResult(
  descriptor: TenderPackageIntakeDescriptor,
  firstBatchFileCount: number,
): TenderPackageSessionResult {
  const complete = descriptor.expectedBatches === 1;
  return {
    kind: SESSION_RESULT_KIND,
    sessionId: descriptor.sessionId,
    expectedBatches: descriptor.expectedBatches,
    expectedFiles: descriptor.expectedFiles,
    manifest: descriptor.manifest,
    receivedBatchIndexes: [0],
    receivedFiles: firstBatchFileCount,
    missingBatchIndexes: complete
      ? []
      : Array.from({ length: descriptor.expectedBatches - 1 }, (_, index) => index + 1),
    analysisJobId: null,
    analysisRevision: null,
  };
}

export function parseTenderPackageSessionResult(value: unknown): TenderPackageSessionResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Partial<TenderPackageSessionResult>;
  if (
    result.kind !== SESSION_RESULT_KIND ||
    typeof result.sessionId !== "string" ||
    !Number.isInteger(result.expectedBatches) ||
    !Number.isInteger(result.expectedFiles) ||
    !Array.isArray(result.manifest) ||
    !Array.isArray(result.receivedBatchIndexes) ||
    !Array.isArray(result.missingBatchIndexes)
  ) {
    return null;
  }
  return result as TenderPackageSessionResult;
}

export function packageSessionJson(result: TenderPackageSessionResult): Prisma.InputJsonValue {
  return result as unknown as Prisma.InputJsonValue;
}

export type BeginPackageBatchResult =
  | { ok: true; replayed: false; runId: string; session: TenderPackageSessionResult }
  | { ok: true; replayed: true; runId: string; session: TenderPackageSessionResult; createdFileIds: string[] }
  | { ok: false; status: number; code: string; error: string };

/**
 * Acquire one durable package-batch slot. A completed slot can be replayed
 * only with identical bytes. A conflicting reuse fails closed.
 */
export async function beginTenderPackageBatch(args: {
  prisma: PrismaClient;
  companyId: string;
  tenderId: string;
  descriptor: TenderPackageIntakeDescriptor;
  batchFingerprint: string;
}): Promise<BeginPackageBatchResult> {
  const { prisma, companyId, tenderId, descriptor, batchFingerprint } = args;
  const sessionRow = await prisma.tenderWorkflowRun.findUnique({
    where: {
      companyId_tenderId_operation_idempotencyKey: {
        companyId,
        tenderId,
        operation: TENDER_PACKAGE_INTAKE_OPERATION,
        idempotencyKey: descriptor.sessionId,
      },
    },
  });
  const session = parseTenderPackageSessionResult(sessionRow?.resultJson);
  if (!sessionRow || !session || sessionRow.inputHash !== descriptor.manifestHash) {
    return { ok: false, status: 409, code: "INTAKE_SESSION_NOT_FOUND", error: "The tender package session does not match this tender." };
  }
  if (
    session.expectedBatches !== descriptor.expectedBatches ||
    session.expectedFiles !== descriptor.expectedFiles
  ) {
    return { ok: false, status: 409, code: "INTAKE_SESSION_CONFLICT", error: "The tender package counters conflict with the stored session." };
  }

  const idempotencyKey = packageBatchKey(descriptor.sessionId, descriptor.batchIndex);
  const unique = {
    companyId_tenderId_operation_idempotencyKey: {
      companyId,
      tenderId,
      operation: TENDER_PACKAGE_BATCH_OPERATION,
      idempotencyKey,
    },
  };
  const existing = await prisma.tenderWorkflowRun.findUnique({ where: unique });
  if (existing) {
    if (existing.inputHash && existing.inputHash !== batchFingerprint) {
      return { ok: false, status: 409, code: "INTAKE_BATCH_KEY_REUSED", error: "This batch number was already used with different file bytes." };
    }
    const previous = existing.resultJson && typeof existing.resultJson === "object" && !Array.isArray(existing.resultJson)
      ? existing.resultJson as Record<string, unknown>
      : {};
    if (existing.status === "SUCCEEDED") {
      return {
        ok: true,
        replayed: true,
        runId: existing.id,
        session,
        createdFileIds: Array.isArray(previous.createdFileIds)
          ? previous.createdFileIds.filter((id): id is string => typeof id === "string")
          : [],
      };
    }
    if (existing.status === "RUNNING" && existing.startedAt && existing.startedAt.getTime() > Date.now() - 10 * 60_000) {
      return { ok: false, status: 409, code: "INTAKE_BATCH_IN_PROGRESS", error: "This tender package batch is already being processed." };
    }
    const resumed = await prisma.tenderWorkflowRun.update({
      where: { id: existing.id },
      data: {
        status: "RUNNING",
        phase: "store_source_files",
        inputHash: batchFingerprint,
        errorCode: null,
        errorMessage: null,
        startedAt: new Date(),
        finishedAt: null,
      },
      select: { id: true },
    });
    return { ok: true, replayed: false, runId: resumed.id, session };
  }

  try {
    const created = await prisma.tenderWorkflowRun.create({
      data: {
        companyId,
        tenderId,
        operation: TENDER_PACKAGE_BATCH_OPERATION,
        idempotencyKey,
        status: "RUNNING",
        phase: "store_source_files",
        inputHash: batchFingerprint,
        startedAt: new Date(),
        warningsJson: [],
      },
      select: { id: true },
    });
    return { ok: true, replayed: false, runId: created.id, session };
  } catch (error) {
    // Two requests can both observe no row before the unique insert. Re-read
    // the winner through the same conflict/replay checks instead of leaking a
    // raw P2002 as a 500.
    if ((error as { code?: string })?.code === "P2002") {
      return beginTenderPackageBatch(args);
    }
    throw error;
  }
}

export async function failTenderPackageBatch(args: {
  prisma: PrismaClient;
  runId: string;
  createdFileIds: string[];
  errorCode: string;
}): Promise<void> {
  await args.prisma.tenderWorkflowRun.update({
    where: { id: args.runId },
    data: {
      status: "FAILED",
      phase: "source_files_incomplete",
      errorCode: args.errorCode,
      errorMessage: "One or more package files were not stored safely.",
      resultJson: { createdFileIds: args.createdFileIds } as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
}

export async function completeTenderPackageBatch(args: {
  prisma: PrismaClient;
  companyId: string;
  tenderId: string;
  descriptor: TenderPackageIntakeDescriptor;
  runId: string;
  createdFileIds: string[];
}): Promise<{ sessionComplete: boolean; session: TenderPackageSessionResult }> {
  const { prisma, companyId, tenderId, descriptor, runId, createdFileIds } = args;
  await prisma.tenderWorkflowRun.update({
    where: { id: runId },
    data: {
      status: "SUCCEEDED",
      phase: "source_files_stored",
      resultJson: {
        batchIndex: descriptor.batchIndex,
        fileCount: descriptor.manifest[descriptor.batchIndex].length,
        createdFileIds,
      } as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });

  return prisma.$transaction(async (tx) => {
    const sessionRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "TenderWorkflowRun"
      WHERE "companyId" = ${companyId}
        AND "tenderId" = ${tenderId}
        AND "operation" = ${TENDER_PACKAGE_INTAKE_OPERATION}
        AND "idempotencyKey" = ${descriptor.sessionId}
      FOR UPDATE
    `;
    if (sessionRows.length !== 1) throw new Error("INTAKE_SESSION_LOCK_FAILED");

    const sessionRow = await tx.tenderWorkflowRun.findUnique({ where: { id: sessionRows[0].id } });
    const storedSession = parseTenderPackageSessionResult(sessionRow?.resultJson);
    if (!sessionRow || !storedSession || sessionRow.inputHash !== descriptor.manifestHash) {
      throw new Error("INTAKE_SESSION_CHANGED");
    }

    const successfulBatches = await tx.tenderWorkflowRun.findMany({
      where: {
        companyId,
        tenderId,
        operation: TENDER_PACKAGE_BATCH_OPERATION,
        idempotencyKey: { startsWith: `${descriptor.sessionId}:` },
        status: "SUCCEEDED",
      },
      select: { idempotencyKey: true, resultJson: true },
    });
    const received = new Map<number, number>();
    for (const batch of successfulBatches) {
      const suffix = batch.idempotencyKey.slice(descriptor.sessionId.length + 1);
      const index = Number.parseInt(suffix, 10);
      const result = batch.resultJson && typeof batch.resultJson === "object" && !Array.isArray(batch.resultJson)
        ? batch.resultJson as Record<string, unknown>
        : {};
      const fileCount = typeof result.fileCount === "number" ? result.fileCount : 0;
      if (Number.isInteger(index) && index >= 0 && index < descriptor.expectedBatches && fileCount > 0) {
        received.set(index, fileCount);
      }
    }
    const receivedBatchIndexes = [...received.keys()].sort((a, b) => a - b);
    const receivedFiles = [...received.values()].reduce((total, count) => total + count, 0);
    const missingBatchIndexes = Array.from({ length: descriptor.expectedBatches }, (_, index) => index)
      .filter((index) => !received.has(index));
    const sessionComplete =
      missingBatchIndexes.length === 0 &&
      receivedBatchIndexes.length === descriptor.expectedBatches &&
      receivedFiles === descriptor.expectedFiles;
    const updatedSession: TenderPackageSessionResult = {
      ...storedSession,
      receivedBatchIndexes,
      receivedFiles,
      missingBatchIndexes,
    };

    await tx.tenderWorkflowRun.update({
      where: { id: sessionRow.id },
      data: {
        status: sessionComplete ? "SUCCEEDED" : "QUEUED",
        phase: sessionComplete ? "source_package_complete" : "awaiting_batches",
        resultJson: packageSessionJson(updatedSession),
        finishedAt: sessionComplete ? new Date() : null,
      },
    });
    return { sessionComplete, session: updatedSession };
  });
}

export async function recordTenderPackageAnalysisJob(args: {
  prisma: PrismaClient;
  companyId: string;
  tenderId: string;
  sessionId: string;
  jobId: string;
  analysisRevision: string | null;
}): Promise<void> {
  const row = await args.prisma.tenderWorkflowRun.findUnique({
    where: {
      companyId_tenderId_operation_idempotencyKey: {
        companyId: args.companyId,
        tenderId: args.tenderId,
        operation: TENDER_PACKAGE_INTAKE_OPERATION,
        idempotencyKey: args.sessionId,
      },
    },
  });
  const result = parseTenderPackageSessionResult(row?.resultJson);
  if (!row || !result) return;
  await args.prisma.tenderWorkflowRun.update({
    where: { id: row.id },
    data: {
      phase: "analysis_queued",
      resultJson: packageSessionJson({
        ...result,
        analysisJobId: args.jobId,
        analysisRevision: args.analysisRevision,
      }),
    },
  });
}

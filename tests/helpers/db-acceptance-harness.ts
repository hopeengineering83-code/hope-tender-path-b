// DB-backed release acceptance test harness.
//
// Shared seed/cleanup helpers for the final release acceptance test suite.
// Every test in this suite requires RUN_DB_INTEGRATION=true and a real
// PostgreSQL DATABASE_URL. Tests skip cleanly when the env is not set.
//
// Design principles:
//   - Each test creates its own isolated users/company/tender (suffix with Date.now()).
//   - Cleanup runs in after() — no cross-test contamination.
//   - Seeds use the REAL prisma client so the tests exercise the actual schema
//     (constraints, triggers, indexes, partial unique indexes).
//   - No mocking of prisma — every assertion is against the real DB state.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

export const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
export const dbDescribe = RUN_DB ? describe : describe.skip;

let _prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    const { prisma } = require("../../lib/prisma");
    _prisma = prisma as PrismaClient;
  }
  return _prisma;
}

// ─── Suffix helper ────────────────────────────────────────────────────────────
// Every test gets a unique suffix so concurrent test runs don't collide.
export function testSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ─── User/Company seed ────────────────────────────────────────────────────────

export type TestUser = { id: string; email: string; role: string };

export async function seedUser(
  prisma: PrismaClient,
  suffix: string,
  role: "ADMIN" | "PROPOSAL_MANAGER" | "REVIEWER" | "VIEWER" = "PROPOSAL_MANAGER",
): Promise<TestUser> {
  const id = `u-${role.toLowerCase().slice(0, 3)}-${suffix}`;
  const email = `${id}@test.local`;
  await prisma.user.create({
    data: {
      id,
      email,
      name: `Test ${role} ${suffix}`,
      passwordHash: "$2a$10$test",
      role,
    },
  });
  return { id, email, role };
}

export async function seedCompany(
  prisma: PrismaClient,
  userId: string,
  suffix: string,
): Promise<{ id: string }> {
  const company = await prisma.company.create({
    data: {
      userId,
      name: `Test Company ${suffix}`,
      legalName: `Test Company Legal ${suffix}`,
      country: "ET",
      sector: "Engineering",
    },
  });
  return { id: company.id };
}

// ─── Tender seed ──────────────────────────────────────────────────────────────

export type TenderSeedInput = {
  userId: string;
  suffix: string;
  title?: string;
  status?: string;
  stage?: string;
  analysisExtractionStatus?: string;
  analysisSummary?: string;
  notes?: string;
  deadline?: Date;
  submissionMethod?: string;
  submissionEmails?: string;
  exactFileNaming?: string;
  exactFileOrder?: string;
  readinessScore?: number;
};

export async function seedTender(
  prisma: PrismaClient,
  input: TenderSeedInput,
): Promise<{ id: string }> {
  const tender = await prisma.tender.create({
    data: {
      userId: input.userId,
      title: input.title ?? `Test Tender ${input.suffix}`,
      clientName: "Ministry of Test Infrastructure",
      reference: `REF-${input.suffix}`,
      status: input.status ?? "DRAFT",
      stage: input.stage ?? "TENDER_INTAKE",
      analysisExtractionStatus: input.analysisExtractionStatus ?? "FULL_EXTRACTION_AI_ANALYZED",
      analysisSummary: input.analysisSummary ?? "AI analysis completed.",
      notes: input.notes ?? "Analysis source: AI (db acceptance test).",
      deadline: input.deadline ?? new Date(Date.now() + 30 * 86400 * 1000),
      submissionMethod: input.submissionMethod ?? "email",
      submissionEmails: input.submissionEmails ?? "submit@example.com",
      exactFileNaming: input.exactFileNaming ?? "[]",
      exactFileOrder: input.exactFileOrder ?? "[]",
      readinessScore: input.readinessScore ?? 0,
    },
  });
  return { id: tender.id };
}

// ─── TenderFile seed ──────────────────────────────────────────────────────────

export type FileSeedInput = {
  tenderId: string;
  suffix: string;
  extractedText?: string;
  extractionScore?: number;
  totalPages?: number;
  extractedPages?: number;
  deletionStatus?: string;
};

export async function seedTenderFile(
  prisma: PrismaClient,
  input: FileSeedInput,
): Promise<{ id: string }> {
  const file = await prisma.tenderFile.create({
    data: {
      tenderId: input.tenderId,
      fileName: `tender-${input.suffix}.pdf`,
      originalFileName: `Tender Document ${input.suffix}.pdf`,
      mimeType: "application/pdf",
      size: 100000,
      extractedText: input.extractedText ?? "This is a test tender document with sufficient text for extraction quality assessment. It contains submission instructions, deadline information, and technical requirements for a healthcare facility construction project.",
      extractionScore: input.extractionScore ?? 95,
      totalPages: input.totalPages ?? 10,
      extractedPages: input.extractedPages ?? 10,
      deletionStatus: input.deletionStatus ?? "ACTIVE",
    },
  });
  return { id: file.id };
}

// ─── Requirement seed ─────────────────────────────────────────────────────────

export type RequirementSeedInput = {
  tenderId: string;
  title: string;
  description?: string;
  requirementType?: string;
  priority?: string;
  sourceTenderFileId?: string | null;
  sourcePageNumber?: number | null;
  sourceExactQuote?: string | null;
  sourceConfidence?: number;
};

export async function seedRequirement(
  prisma: PrismaClient,
  input: RequirementSeedInput,
): Promise<{ id: string }> {
  const req = await prisma.tenderRequirement.create({
    data: {
      tenderId: input.tenderId,
      title: input.title,
      description: input.description ?? "Test requirement description",
      requirementType: input.requirementType ?? "EXPERT",
      priority: input.priority ?? "MANDATORY",
      sourceTenderFileId: input.sourceTenderFileId ?? null,
      sourcePageNumber: input.sourcePageNumber ?? null,
      sourceExactQuote: input.sourceExactQuote ?? null,
      sourceConfidence: input.sourceConfidence ?? 0,
    },
  });
  return { id: req.id };
}

// ─── ComplianceMatrix seed ────────────────────────────────────────────────────

export type ComplianceSeedInput = {
  tenderId: string;
  requirementId: string;
  supportLevel?: string;
  evidenceType?: string;
  evidenceSource?: string;
  notes?: string;
};

export async function seedComplianceRow(
  prisma: PrismaClient,
  input: ComplianceSeedInput,
): Promise<{ id: string }> {
  const row = await prisma.complianceMatrix.create({
    data: {
      tenderId: input.tenderId,
      requirementId: input.requirementId,
      supportLevel: input.supportLevel ?? "PARTIAL",
      evidenceType: input.evidenceType ?? "EXPERT",
      evidenceSource: input.evidenceSource ?? "Test evidence source",
      notes: input.notes ?? "Test compliance row",
    },
  });
  return { id: row.id };
}

// ─── GeneratedDocument seed ───────────────────────────────────────────────────

export type DocSeedInput = {
  tenderId: string;
  name?: string;
  documentType?: string;
  exactFileName?: string;
  exactOrder?: number;
  generationStatus?: string;
  validationStatus?: string;
  reviewStatus?: string;
  fileContent?: string;
  format?: string;
};

export async function seedGeneratedDocument(
  prisma: PrismaClient,
  input: DocSeedInput,
): Promise<{ id: string }> {
  const doc = await prisma.generatedDocument.create({
    data: {
      tenderId: input.tenderId,
      name: input.name ?? "Technical Proposal",
      documentType: input.documentType ?? "TECHNICAL_PROPOSAL",
      exactFileName: input.exactFileName ?? "Technical Proposal.docx",
      exactOrder: input.exactOrder ?? 1,
      generationStatus: input.generationStatus ?? "GENERATED",
      validationStatus: input.validationStatus ?? "PENDING",
      reviewStatus: input.reviewStatus ?? "PENDING",
      fileContent: input.fileContent ?? "dGVzdCBjb250ZW50", // base64 "test content"
      format: input.format ?? "DOCX",
    },
  });
  return { id: doc.id };
}

// ─── BuildPlan seed ───────────────────────────────────────────────────────────

export type BuildPlanSeedInput = {
  tenderId: string;
  status?: string;
  contentHash?: string;
  revision?: number;
  confirmedRevision?: number | null;
  confirmedContentHash?: string | null;
  itemsJson?: string;
};

export async function seedBuildPlan(
  prisma: PrismaClient,
  input: BuildPlanSeedInput,
): Promise<{ id: string }> {
  const plan = await prisma.buildPlan.create({
    data: {
      tenderId: input.tenderId,
      status: input.status ?? "DRAFT",
      contentHash: input.contentHash ?? "test-hash",
      revision: input.revision ?? 1,
      confirmedRevision: input.confirmedRevision ?? null,
      confirmedContentHash: input.confirmedContentHash ?? null,
      itemsJson: input.itemsJson ?? JSON.stringify([
        { exactFileName: "Technical Proposal.docx", required: true, format: "docx" },
      ]),
    },
  });
  return { id: plan.id };
}

// ─── Cleanup helper ───────────────────────────────────────────────────────────

export async function cleanupTender(prisma: PrismaClient, tenderId: string): Promise<void> {
  // Delete in dependency order to respect FK constraints.
  await prisma.complianceMatrix.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.complianceGap.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.tenderExpertMatch.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.tenderProjectMatch.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.tenderRequirement.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.generatedDocument.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.buildPlan.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.tenderFile.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.tender.deleteMany({ where: { id: tenderId } }).catch(() => {});
}

export async function cleanupUser(prisma: PrismaClient, userId: string): Promise<void> {
  // Delete company first (cascade deletes company assets).
  await prisma.company.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}

// ─── Safe error assertion ─────────────────────────────────────────────────────

/**
 * Assert that a response body does NOT contain raw Prisma/server/path/token errors.
 * This is the "safe public error" check — every blocked-state response must pass it.
 */
export function assertSafePublicError(body: unknown): void {
  const text = JSON.stringify(body);
  // Must NOT contain raw Prisma errors.
  assert.ok(!text.includes("PrismaClient"), `body leaked PrismaClient: ${text.slice(0, 500)}`);
  assert.ok(!text.includes("prisma."), `body leaked prisma. call: ${text.slice(0, 500)}`);
  // Must NOT contain SQL.
  assert.ok(!/SELECT\s+[\w*,\s]+\s+FROM\s+"?\w+"?/i.test(text), `body leaked SQL: ${text.slice(0, 500)}`);
  // Must NOT contain org IDs (org- followed by 24+ alphanumeric chars).
  assert.ok(!/org-[a-z0-9]{24}/i.test(text), `body leaked org ID: ${text.slice(0, 500)}`);
  // Must NOT contain API keys (sk- or key- followed by 20+ chars).
  assert.ok(!/sk-[a-zA-Z0-9]{20}/.test(text), `body leaked API key: ${text.slice(0, 500)}`);
  // Must NOT contain file paths.
  assert.ok(!/\/(home|usr|var|etc|tmp)\//.test(text), `body leaked file path: ${text.slice(0, 500)}`);
  // Must NOT contain "metadata" in user-facing fields.
  assert.ok(!/>.*[Mm]etadata.*</.test(text), `body contains user-facing 'metadata' wording: ${text.slice(0, 500)}`);
}

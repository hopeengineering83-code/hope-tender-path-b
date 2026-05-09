import { PrismaClient } from "@prisma/client";
import { checkEnv } from "./env-check";

// Validate env vars before anything else. Crashes loudly on bad config.
checkEnv();

const g = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaReady: Promise<void> | undefined;
};

export const prisma = g.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  g.prisma = prisma;
}

// ─── column existence helper (PostgreSQL) ────────────────────────────────────

async function columnExists(client: PrismaClient, table: string, column: string): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return rows.length > 0;
}

async function ensureColumn(client: PrismaClient, table: string, column: string, definition: string): Promise<void> {
  if (!(await columnExists(client, table, column))) {
    await client.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
  }
}

// ─── bootstrap ───────────────────────────────────────────────────────────────

async function bootstrap(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PROPOSAL_MANAGER',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Role_code_key" ON "Role"("code")`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
  )`);
  await client.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Session_token_key" ON "Session"("token")`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "description" TEXT,
    "website" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "country" TEXT,
    "serviceLines" TEXT NOT NULL DEFAULT '[]',
    "sectors" TEXT NOT NULL DEFAULT '[]',
    "profileSummary" TEXT,
    "knowledgeMode" TEXT NOT NULL DEFAULT 'PROFILE_FIRST',
    "setupCompletedAt" TIMESTAMPTZ,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
  )`);
  await client.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Company_userId_key" ON "Company"("userId")`);

  // Round-10: institutional metadata fields used by the proposal generator
  // (D.4 Declaration, A.1/A.2 Company sections, Submitted-by/to block).
  // ALTER TABLE IF NOT EXISTS COLUMN — safe to run repeatedly on existing
  // databases. Each column is added independently so partial migrations
  // succeed.
  for (const [col, type] of [
    ["gmName", "TEXT"],
    ["gmTitle", "TEXT"],
    ["gmLicense", "TEXT"],
    ["foundingYear", "INTEGER"],
    ["headcount", "INTEGER"],
    ["licenseGrade", "TEXT"],
    ["registrationNumber", "TEXT"],
    ["tin", "TEXT"],
    ["vat", "TEXT"],
  ] as const) {
    await client.$executeRawUnsafe(`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "${col}" ${type}`);
  }

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "aiStrictMode" BOOLEAN NOT NULL DEFAULT true,
    "allowBrandingDefault" BOOLEAN NOT NULL DEFAULT true,
    "allowSignatureDefault" BOOLEAN NOT NULL DEFAULT true,
    "allowStampDefault" BOOLEAN NOT NULL DEFAULT true,
    "exportFormat" TEXT NOT NULL DEFAULT 'DOCX',
    "pageNumbering" BOOLEAN NOT NULL DEFAULT true,
    "includeTableOfContents" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE
  )`);
  await client.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AppSettings_companyId_key" ON "AppSettings"("companyId")`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CompanyDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL DEFAULT '',
    "fileContent" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "extractedText" TEXT,
    "aiExtractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "aiExtractedAt" TIMESTAMPTZ,
    "aiExtractionError" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CompanyAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL DEFAULT '',
    "fileContent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Expert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "yearsExperience" INTEGER,
    "disciplines" TEXT NOT NULL DEFAULT '[]',
    "sectors" TEXT NOT NULL DEFAULT '[]',
    "certifications" TEXT NOT NULL DEFAULT '[]',
    "profile" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "trustLevel" TEXT NOT NULL DEFAULT 'REGEX_DRAFT',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMPTZ,
    "reviewNotes" TEXT,
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("sourceDocumentId") REFERENCES "CompanyDocument"("id") ON DELETE SET NULL
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientName" TEXT,
    "country" TEXT,
    "sector" TEXT,
    "serviceAreas" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "contractValue" DOUBLE PRECISION,
    "currency" TEXT,
    "startDate" TIMESTAMPTZ,
    "endDate" TIMESTAMPTZ,
    "trustLevel" TEXT NOT NULL DEFAULT 'REGEX_DRAFT',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMPTZ,
    "reviewNotes" TEXT,
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("sourceDocumentId") REFERENCES "CompanyDocument"("id") ON DELETE SET NULL
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProjectEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "description" TEXT,
    "fileName" TEXT,
    "storagePath" TEXT,
    "extractedText" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LegalRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authority" TEXT,
    "referenceNumber" TEXT,
    "issueDate" TIMESTAMPTZ,
    "expiryDate" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "FinancialRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "recordType" TEXT NOT NULL,
    "currency" TEXT DEFAULT 'USD',
    "amount" DOUBLE PRECISION,
    "notes" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CompanyComplianceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "complianceType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "evidenceSummary" TEXT,
    "referenceNumber" TEXT,
    "expiryDate" TIMESTAMPTZ,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Tender" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "clientName" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "country" TEXT,
    "budget" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "deadline" TIMESTAMPTZ,
    "submissionMethod" TEXT,
    "submissionAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "stage" TEXT NOT NULL DEFAULT 'TENDER_INTAKE',
    "intakeSummary" TEXT,
    "analysisSummary" TEXT,
    "evaluationMethodology" TEXT,
    "pageLimit" INTEGER,
    "exactFileOrder" TEXT NOT NULL DEFAULT '[]',
    "exactFileNaming" TEXT NOT NULL DEFAULT '[]',
    "readinessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL DEFAULT '',
    "fileContent" TEXT,
    "classification" TEXT,
    "extractedText" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requirementType" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "sectionReference" TEXT,
    "requiredQuantity" INTEGER,
    "pageLimit" INTEGER,
    "exactFileName" TEXT,
    "exactOrder" INTEGER,
    "restrictions" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ComplianceMatrix" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "requirementId" TEXT,
    "evidenceType" TEXT NOT NULL,
    "evidenceSource" TEXT NOT NULL,
    "evidenceReference" TEXT,
    "supportLevel" TEXT NOT NULL DEFAULT 'PARTIAL',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE,
    FOREIGN KEY ("requirementId") REFERENCES "TenderRequirement"("id") ON DELETE SET NULL
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderExpertMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE,
    FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderProjectMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE,
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ComplianceGap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "requirementId" TEXT,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mitigationPlan" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "GeneratedDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'DOCX',
    "storagePath" TEXT,
    "exactFileName" TEXT,
    "exactOrder" INTEGER,
    "contentSummary" TEXT,
    "fileContent" TEXT,
    "validationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "generationStatus" TEXT NOT NULL DEFAULT 'PLANNED',
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNotes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMPTZ,
    "reviewedExpertCount" INTEGER DEFAULT 0,
    "draftExpertCount" INTEGER DEFAULT 0,
    "reviewedProjectCount" INTEGER DEFAULT 0,
    "draftProjectCount" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ExportPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARING',
    "fileList" TEXT NOT NULL DEFAULT '[]',
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "description" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL
  )`);

  // ── additive column migrations (run BEFORE indexes so they always execute) ──
  await ensureColumn(client, "User", "name", "TEXT");
  await ensureColumn(client, "Expert", "trustLevel", "TEXT NOT NULL DEFAULT 'REGEX_DRAFT'");
  await ensureColumn(client, "Expert", "reviewedBy", "TEXT");
  await ensureColumn(client, "Expert", "reviewedAt", "TIMESTAMPTZ");
  await ensureColumn(client, "Expert", "reviewNotes", "TEXT");
  await ensureColumn(client, "Expert", "sourceDocumentId", "TEXT");
  await ensureColumn(client, "Project", "trustLevel", "TEXT NOT NULL DEFAULT 'REGEX_DRAFT'");
  await ensureColumn(client, "Project", "reviewedBy", "TEXT");
  await ensureColumn(client, "Project", "reviewedAt", "TIMESTAMPTZ");
  await ensureColumn(client, "Project", "reviewNotes", "TEXT");
  await ensureColumn(client, "Project", "sourceDocumentId", "TEXT");
  await ensureColumn(client, "CompanyDocument", "aiExtractionStatus", "TEXT NOT NULL DEFAULT 'PENDING'");
  await ensureColumn(client, "CompanyDocument", "aiExtractedAt", "TIMESTAMPTZ");
  await ensureColumn(client, "CompanyDocument", "aiExtractionError", "TEXT");
  await ensureColumn(client, "GeneratedDocument", "reviewedExpertCount", "INTEGER DEFAULT 0");
  await ensureColumn(client, "GeneratedDocument", "draftExpertCount", "INTEGER DEFAULT 0");
  await ensureColumn(client, "GeneratedDocument", "reviewedProjectCount", "INTEGER DEFAULT 0");
  await ensureColumn(client, "GeneratedDocument", "draftProjectCount", "INTEGER DEFAULT 0");
  // Company profile fields
  await ensureColumn(client, "Company", "legalName", "TEXT");
  await ensureColumn(client, "Company", "website", "TEXT");
  await ensureColumn(client, "Company", "address", "TEXT");
  await ensureColumn(client, "Company", "phone", "TEXT");
  await ensureColumn(client, "Company", "email", "TEXT");
  await ensureColumn(client, "Company", "country", "TEXT");
  await ensureColumn(client, "Company", "profileSummary", "TEXT");
  await ensureColumn(client, "Company", "setupCompletedAt", "TIMESTAMPTZ");
  await ensureColumn(client, "Company", "serviceLines", "TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn(client, "Company", "sectors", "TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn(client, "Company", "knowledgeMode", "TEXT NOT NULL DEFAULT 'PROFILE_FIRST'");
  // Expert contact fields
  await ensureColumn(client, "Expert", "email", "TEXT");
  await ensureColumn(client, "Expert", "phone", "TEXT");
  await ensureColumn(client, "Expert", "isActive", "BOOLEAN NOT NULL DEFAULT true");
  // Project timeline fields
  await ensureColumn(client, "Project", "startDate", "TIMESTAMPTZ");
  await ensureColumn(client, "Project", "endDate", "TIMESTAMPTZ");
  // Bid outcome tracking
  await ensureColumn(client, "Tender", "bidOutcome", "TEXT");
  await ensureColumn(client, "Tender", "bidOutcomeNote", "TEXT");
  await ensureColumn(client, "Tender", "bidOutcomeAt", "TIMESTAMPTZ");
  // Soft-delete for Expert + Project
  await ensureColumn(client, "Expert", "deletedAt", "TIMESTAMPTZ");
  await ensureColumn(client, "Expert", "deletedBy", "TEXT");
  await ensureColumn(client, "Project", "deletedAt", "TIMESTAMPTZ");
  await ensureColumn(client, "Project", "deletedBy", "TEXT");
  // Notification table
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
  )`);

  // Proposal version history — stores the last N markdown + DOCX snapshots
  // for each tender so users can compare and roll back to any prior version.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProposalVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "markdown" TEXT NOT NULL,
    "fileContent" TEXT,
    "benchmarkScore" INTEGER,
    "qualityScore" INTEGER,
    "winProbabilityScore" INTEGER,
    "mode" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE
  )`);

  // ─── 12-perspective scoring breakdown (G3) ─────────────────────────────
  // Stores per-dimension scores for each TenderExpertMatch / TenderProjectMatch
  // so the engine match path AND the AI rematch path write into ONE table
  // and downstream consumers (readiness, bid/no-bid, evaluator simulator,
  // proposal generator) all read identical scoring objects.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MatchScoreBreakdown" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dimensionCode" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "rationale" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ENGINE_MATCH',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // ─── Evaluator objections (G4) ─────────────────────────────────────────
  // Structured red-team objections the evaluator simulator raises against
  // each proposal version. HIGH severity + OPEN status blocks export.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "EvaluatorObjection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "proposalVersion" INTEGER NOT NULL DEFAULT 1,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sectionRef" TEXT,
    "recommendedAction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMPTZ,
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // ─── Section-level evidence map (G5) ───────────────────────────────────
  // Each generated proposal section is recorded with which requirements
  // it covers, which evidence IDs it cites, the text hash, and reviewer
  // status. Powers weak-section + missing-criterion-depth detectors and
  // ensures section regeneration preserves evidence references.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SectionEvidenceMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "proposalVersion" INTEGER NOT NULL DEFAULT 1,
    "sectionId" TEXT NOT NULL,
    "sectionTitle" TEXT NOT NULL,
    "requirementIds" TEXT NOT NULL DEFAULT '',
    "evidenceIds" TEXT NOT NULL DEFAULT '',
    "expertIds" TEXT NOT NULL DEFAULT '',
    "projectIds" TEXT NOT NULL DEFAULT '',
    "textHash" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "reviewerStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerNote" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // ─── AI job queue (G6) ─────────────────────────────────────────────────
  // Long-running AI workflows (proposal generation, large rematch,
  // evaluator simulation, deep Copilot analysis) are enqueued and
  // resumable across requests so they no longer time out at 60s.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AiJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT,
    "userId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "input" TEXT NOT NULL DEFAULT '{}',
    "output" TEXT,
    "errorMessage" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ,
    "finishedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AiJobStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "stepName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "startedAt" TIMESTAMPTZ,
    "finishedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE CASCADE
  )`);

  // ─── Pricing engine (G8) ───────────────────────────────────────────────
  // PricingWorkbook (one per tender) + CostLine rows. Replaces ad-hoc
  // commercial assumptions with a real pricing workbook the export gate
  // can validate (no price leakage, separate envelopes, etc.).
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PricingWorkbook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL UNIQUE,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "validityDays" INTEGER NOT NULL DEFAULT 90,
    "vatPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "withholdingPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contingencyPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scenario" TEXT NOT NULL DEFAULT 'BALANCED',
    "noPriceLeakage" BOOLEAN NOT NULL DEFAULT TRUE,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CostLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workbookId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'DAY',
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expertId" TEXT,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("workbookId") REFERENCES "PricingWorkbook"("id") ON DELETE CASCADE
  )`);

  // ─── G9: page-level requirement source coordinates ─────────────────────
  await ensureColumn(client, "TenderRequirement", "sourceTenderFileId", "TEXT");
  await ensureColumn(client, "TenderRequirement", "sourcePageNumber", "INTEGER");
  await ensureColumn(client, "TenderRequirement", "sourceSectionHeading", "TEXT");
  await ensureColumn(client, "TenderRequirement", "sourceExactQuote", "TEXT");
  await ensureColumn(client, "TenderRequirement", "sourceConfidence", "DOUBLE PRECISION NOT NULL DEFAULT 0");


  // ── indexes (each wrapped so one failure never blocks the rest) ──────────
  const idxStatements = [
    `CREATE INDEX IF NOT EXISTS "CompanyDocument_companyId_idx" ON "CompanyDocument"("companyId")`,
    `CREATE INDEX IF NOT EXISTS "CompanyAsset_companyId_idx" ON "CompanyAsset"("companyId")`,
    `CREATE INDEX IF NOT EXISTS "Expert_companyId_idx" ON "Expert"("companyId")`,
    `CREATE INDEX IF NOT EXISTS "Expert_trustLevel_idx" ON "Expert"("trustLevel")`,
    `CREATE INDEX IF NOT EXISTS "Project_companyId_idx" ON "Project"("companyId")`,
    `CREATE INDEX IF NOT EXISTS "Project_trustLevel_idx" ON "Project"("trustLevel")`,
    `CREATE INDEX IF NOT EXISTS "TenderExpertMatch_tenderId_idx" ON "TenderExpertMatch"("tenderId")`,
    `CREATE INDEX IF NOT EXISTS "TenderProjectMatch_tenderId_idx" ON "TenderProjectMatch"("tenderId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "TenderExpertMatch_tenderId_expertId_key" ON "TenderExpertMatch"("tenderId", "expertId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "TenderProjectMatch_tenderId_projectId_key" ON "TenderProjectMatch"("tenderId", "projectId")`,
    `CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt")`,
    `CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "Expert_deletedAt_idx" ON "Expert"("deletedAt")`,
    `CREATE INDEX IF NOT EXISTS "Project_deletedAt_idx" ON "Project"("deletedAt")`,
    `CREATE INDEX IF NOT EXISTS "ProposalVersion_tenderId_idx" ON "ProposalVersion"("tenderId")`,
    `CREATE INDEX IF NOT EXISTS "ProposalVersion_tenderId_version_idx" ON "ProposalVersion"("tenderId", "version")`,
    // G3 — MatchScoreBreakdown
    `CREATE UNIQUE INDEX IF NOT EXISTS "MatchScoreBreakdown_unique_dim" ON "MatchScoreBreakdown"("tenderId", "entityType", "entityId", "dimensionCode")`,
    `CREATE INDEX IF NOT EXISTS "MatchScoreBreakdown_tenderId_entityType_idx" ON "MatchScoreBreakdown"("tenderId", "entityType")`,
    `CREATE INDEX IF NOT EXISTS "MatchScoreBreakdown_tenderId_entityId_idx" ON "MatchScoreBreakdown"("tenderId", "entityId")`,
    // G4 — EvaluatorObjection
    `CREATE INDEX IF NOT EXISTS "EvaluatorObjection_tenderId_status_idx" ON "EvaluatorObjection"("tenderId", "status")`,
    `CREATE INDEX IF NOT EXISTS "EvaluatorObjection_tenderId_severity_status_idx" ON "EvaluatorObjection"("tenderId", "severity", "status")`,
    // G5 — SectionEvidenceMap
    `CREATE UNIQUE INDEX IF NOT EXISTS "SectionEvidenceMap_unique_section" ON "SectionEvidenceMap"("tenderId", "proposalVersion", "sectionId")`,
    `CREATE INDEX IF NOT EXISTS "SectionEvidenceMap_tenderId_idx" ON "SectionEvidenceMap"("tenderId")`,
    // G6 — AiJob / AiJobStep
    `CREATE INDEX IF NOT EXISTS "AiJob_userId_status_idx" ON "AiJob"("userId", "status")`,
    `CREATE INDEX IF NOT EXISTS "AiJob_tenderId_jobType_idx" ON "AiJob"("tenderId", "jobType")`,
    `CREATE INDEX IF NOT EXISTS "AiJob_status_createdAt_idx" ON "AiJob"("status", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "AiJobStep_jobId_stepIndex_idx" ON "AiJobStep"("jobId", "stepIndex")`,
    // G8 — PricingWorkbook / CostLine
    `CREATE INDEX IF NOT EXISTS "PricingWorkbook_tenderId_idx" ON "PricingWorkbook"("tenderId")`,
    `CREATE INDEX IF NOT EXISTS "CostLine_workbookId_idx" ON "CostLine"("workbookId")`,
    // G9 — TenderRequirement source coords
    `CREATE INDEX IF NOT EXISTS "TenderRequirement_tenderId_idx" ON "TenderRequirement"("tenderId")`,
    `CREATE INDEX IF NOT EXISTS "TenderRequirement_sourceTenderFileId_idx" ON "TenderRequirement"("sourceTenderFileId")`,
  ];
  for (const sql of idxStatements) {
    try { await client.$executeRawUnsafe(sql); } catch (e) {
      console.warn("[bootstrap] index skipped:", e instanceof Error ? e.message : e);
    }
  }

  // ── seed roles ────────────────────────────────────────────────────────────
  const roleCount = await client.role.count();
  if (roleCount === 0) {
    await client.role.createMany({
      data: [
        { id: "role-admin", code: "ADMIN", name: "Admin", description: "Full access" },
        { id: "role-proposal-manager", code: "PROPOSAL_MANAGER", name: "Proposal Manager", description: "Tender drafting and generation" },
        { id: "role-reviewer", code: "REVIEWER", name: "Reviewer", description: "Review and approval" },
        { id: "role-viewer", code: "VIEWER", name: "Viewer", description: "Read only" },
      ],
    });
  }

  // ── seed admin user ───────────────────────────────────────────────────────
  const adminCount = await client.user.count({ where: { email: "admin@hope.local" } });
  if (adminCount === 0) {
    const { default: bcrypt } = await import("bcryptjs");
    const passwordHash = await bcrypt.hash("Admin123!", 10);
    const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
    const COMPANY_ID = "00000000-0000-0000-0000-000000000002";

    await client.user.create({
      data: { id: ADMIN_ID, email: "admin@hope.local", name: "Admin", passwordHash, role: "ADMIN" },
    });
    await client.company.create({
      data: {
        id: COMPANY_ID,
        name: "Hope Urban Planning Architectural and Engineering Consultancy",
        description: "AI-powered tender proposal generation workspace",
        userId: ADMIN_ID,
      },
    });
  }
}

function ensureBootstrapped(): Promise<void> {
  if (!g.prismaReady) {
    g.prismaReady = bootstrap(prisma).catch((err: unknown) => {
      console.error("[bootstrap] failed:", err);
      g.prismaReady = undefined; // allow retry on next request
      throw err;
    });
  }
  return g.prismaReady;
}

// PromiseLike wrapper — re-evaluates g.prismaReady on every await so a
// failed cold-start bootstrap can be retried on the next request instead
// of caching the rejected promise for the lifetime of the Lambda container.
export const prismaReady: PromiseLike<void> = {
  then<T1, T2>(
    onfulfilled?: ((value: void) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return ensureBootstrapped().then(onfulfilled, onrejected);
  },
};

import { logger } from "./observability";
import { PrismaClient } from "@prisma/client";
import { checkEnv } from "./env-check";
import { resolveBootstrapAdminPolicy, BOOTSTRAP_ADMIN_EMAIL } from "./bootstrap-admin-policy";

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

// ─── runtime schema bootstrap policy ─────────────────────────────────────────
//
// Gap 6 — production deployments should NOT execute CREATE TABLE / ALTER TABLE
// / CREATE INDEX statements at request-handling time. Schema is owned by the
// migration toolchain in production. Set ENABLE_RUNTIME_SCHEMA_BOOTSTRAP=true
// to explicitly opt in (useful for an initial onboarding before migrations are
// wired up).
//
// In development the runtime bootstrap stays available so first-time
// `npm run dev` flows still work without a migration step.
function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function isRuntimeSchemaBootstrapEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return envFlag("ENABLE_RUNTIME_SCHEMA_BOOTSTRAP");
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

async function verifyConnectivity(client: PrismaClient): Promise<void> {
  // Lightweight probe: a SELECT 1 round-trip with retry for Neon cold-start.
  // Neon free-tier databases auto-pause after inactivity and typically take
  // 5-15 seconds to wake. Five attempts at 3s intervals (≤15s total) covers
  // the full wake-up window. Normal requests (DB already warm) return on
  // the first attempt with no delay.
  const MAX_ATTEMPTS = 5;
  const BACKOFF_MS = 3000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await client.$queryRawUnsafe(`SELECT 1`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = /can't reach|connection refused|ECONNREFUSED|ETIMEDOUT|connect timeout|unable to connect|network socket/i.test(msg);
      if (isTransient && attempt < MAX_ATTEMPTS) {
        logger.warn(`[prisma] DB connectivity attempt ${attempt}/${MAX_ATTEMPTS} failed (transient) — retrying in ${BACKOFF_MS / 1000}s…`);
        await new Promise((r) => setTimeout(r, BACKOFF_MS));
        continue;
      }
      throw err;
    }
  }
}

const CORE_TABLES = ['User', 'Company', 'Tender', 'TenderFile', 'GeneratedDocument', 'Expert', 'Project'];

async function verifySchemaPresent(client: PrismaClient): Promise<void> {
  // Confirms that User and Tender (proxy for full schema) exist. When either
  // is missing this throws with a message that tells the operator to run
  // their migration tool.
  const rows = await client.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('User', 'Tender')`,
  );
  const found = new Set(rows.map((r) => r.table_name));
  const missing = ['User', 'Tender'].filter((t) => !found.has(t));
  if (missing.length > 0) {
    throw new Error(
      `Database schema is missing table(s): ${missing.join(', ')}. Run "prisma migrate deploy" (or set ENABLE_RUNTIME_SCHEMA_BOOTSTRAP=true to allow runtime schema bootstrap, which is NOT recommended for production). Core tables expected: ${CORE_TABLES.join(', ')}.`,
    );
  }
}

async function bootstrap(client: PrismaClient): Promise<void> {
  if (!isRuntimeSchemaBootstrapEnabled()) {
    // Gap 6 — production path: never mutate schema or seed bootstrap users.
    // We only verify connectivity and that the schema exists so the first
    // request after a cold start fails fast with a clear message instead
    // of timing out on a missing-table SQL error.
    await verifyConnectivity(client);
    await verifySchemaPresent(client);
    return;
  }

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
  // ─── PR XX-METADATA — rich tender detail columns ────────────────────
  // Populated by inferTenderMetadata() in lib/engine/tender-metadata.ts
  // on upload-first. Empty when manual intake is used or pattern missed.
  await ensureColumn(client, "Tender", "clientContactName", "TEXT");
  await ensureColumn(client, "Tender", "clientContactTitle", "TEXT");
  await ensureColumn(client, "Tender", "clientContactEmail", "TEXT");
  await ensureColumn(client, "Tender", "clientContactPhone", "TEXT");
  await ensureColumn(client, "Tender", "clientAddress", "TEXT");
  await ensureColumn(client, "Tender", "submissionEmails", "TEXT");
  await ensureColumn(client, "Tender", "validityDays", "INTEGER");
  await ensureColumn(client, "Tender", "bidBondAmount", "DOUBLE PRECISION");
  await ensureColumn(client, "Tender", "bidBondCurrency", "TEXT");
  await ensureColumn(client, "Tender", "preBidMeetingDate", "TIMESTAMPTZ");
  await ensureColumn(client, "Tender", "preBidMeetingLocation", "TEXT");
  await ensureColumn(client, "Tender", "mandatorySiteVisit", "BOOLEAN NOT NULL DEFAULT FALSE");
  await ensureColumn(client, "Tender", "numberOfCopiesRequired", "INTEGER");
  await ensureColumn(client, "Tender", "technicalWeight", "INTEGER");
  await ensureColumn(client, "Tender", "financialWeight", "INTEGER");
  // Extended client/procuring-entity extraction (migration 20260604*)
  await ensureColumn(client, "Tender", "procuringEntityName", "TEXT");
  await ensureColumn(client, "Tender", "legalClientName", "TEXT");
  await ensureColumn(client, "Tender", "donorAgency", "TEXT");
  await ensureColumn(client, "Tender", "implementingAgency", "TEXT");
  await ensureColumn(client, "Tender", "metadataContaminated", "BOOLEAN NOT NULL DEFAULT FALSE");
  await ensureColumn(client, "Tender", "clientNameSourcePage", "INTEGER");
  await ensureColumn(client, "Tender", "clientNameSourceQuote", "TEXT");
  await ensureColumn(client, "Tender", "submissionEmailSourcePage", "INTEGER");
  await ensureColumn(client, "Tender", "contactDetailsSourceJson", "TEXT");
  await ensureColumn(client, "Tender", "submissionMethodSourcePage", "INTEGER");
  await ensureColumn(client, "Tender", "submissionMethodSourceQuote", "TEXT");
  await ensureColumn(client, "Tender", "submissionAddressSourcePage", "INTEGER");
  await ensureColumn(client, "Tender", "submissionAddressSourceQuote", "TEXT");
  // Source file IDs for metadata grounding (migration 20260629300000)
  await ensureColumn(client, "Tender", "clientNameSourceFileId", "TEXT");
  await ensureColumn(client, "Tender", "submissionMethodSourceFileId", "TEXT");
  await ensureColumn(client, "Tender", "submissionAddressSourceFileId", "TEXT");
  await ensureColumn(client, "Tender", "submissionEmailSourceFileId", "TEXT");
  await ensureColumn(client, "Tender", "evaluationCriteriaSourceJson", "TEXT");
  await ensureColumn(client, "Tender", "analysisExtractionStatus", "TEXT");
  // Extended client fields — Gap A (CLAUDE.md items 8-20)
  await ensureColumn(client, "Tender", "clientCity", "TEXT");
  await ensureColumn(client, "Tender", "clientWebsite", "TEXT");
  await ensureColumn(client, "Tender", "submissionEmailSubject", "TEXT");
  await ensureColumn(client, "Tender", "submissionEmailSourceQuote", "TEXT");
  await ensureColumn(client, "Tender", "deadlineSourceQuote", "TEXT");
  await ensureColumn(client, "Tender", "deadlineSourcePage", "INTEGER");
  await ensureColumn(client, "Tender", "deadlineSourceFileId", "TEXT");
  await ensureColumn(client, "Tender", "titleSourceQuote", "TEXT");
  await ensureColumn(client, "Tender", "titleSourcePage", "INTEGER");
  await ensureColumn(client, "Tender", "titleSourceFileId", "TEXT");
  await ensureColumn(client, "Tender", "preBidChannel", "TEXT");
  await ensureColumn(client, "Tender", "clientRepresentative", "TEXT");
  // Soft-delete for Expert + Project
  await ensureColumn(client, "Expert", "deletedAt", "TIMESTAMPTZ");
  await ensureColumn(client, "Expert", "deletedBy", "TEXT");
  await ensureColumn(client, "Project", "deletedAt", "TIMESTAMPTZ");
  await ensureColumn(client, "Project", "deletedBy", "TEXT");

  // ── Schema-drift repair: DocumentReview / DocumentComment ─────────────────
  // Ensure correct column names exist. The schema uses documentId, action, notes
  // from initial creation; no data migration from old names is needed.
  await ensureColumn(client, "DocumentReview", "documentId", "TEXT");
  await ensureColumn(client, "DocumentReview", "action", "TEXT");
  await ensureColumn(client, "DocumentReview", "notes", "TEXT");
  await ensureColumn(client, "DocumentReview", "priorStatus", "TEXT");
  await ensureColumn(client, "DocumentReview", "newStatus", "TEXT");
  await ensureColumn(client, "DocumentComment", "documentId", "TEXT");
  await ensureColumn(client, "DocumentComment", "visibility", "TEXT NOT NULL DEFAULT 'INTERNAL'");
  await ensureColumn(client, "DocumentComment", "resolvedAt", "TIMESTAMPTZ");
  await ensureColumn(client, "DocumentComment", "resolvedBy", "TEXT");
  await ensureColumn(client, "DocumentComment", "parentId", "TEXT");

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

  // SectionEvidenceMap columns added after initial bootstrap
  await ensureColumn(client, "SectionEvidenceMap", "status", "TEXT");
  await ensureColumn(client, "SectionEvidenceMap", "content", "TEXT");
  await ensureColumn(client, "SectionEvidenceMap", "aiProvider", "TEXT");
  await ensureColumn(client, "SectionEvidenceMap", "lastGeneratedAt", "TIMESTAMPTZ");
  await ensureColumn(client, "SectionEvidenceMap", "generationAttemptId", "TEXT");

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
  // Versioning/staging columns from migration 20260612000000_add_ai_job_versioning.
  // ADD COLUMN IF NOT EXISTS is idempotent; mirrors migration SQL so fresh
  // bootstrap databases and ENABLE_RUNTIME_SCHEMA_BOOTSTRAP=true deployments
  // get the same schema as a migrated database.
  await client.$executeRawUnsafe(`ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "runId" TEXT`);
  await client.$executeRawUnsafe(`ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "analysisInputHash" TEXT`);
  await client.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS "AiJob_analysisVersion_seq"`);
  await client.$executeRawUnsafe(`ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "analysisVersion" BIGINT NOT NULL DEFAULT 0`);
  await client.$executeRawUnsafe(`ALTER TABLE "AiJob" ALTER COLUMN "analysisVersion" TYPE BIGINT USING "analysisVersion"::BIGINT`);
  await client.$executeRawUnsafe(`ALTER TABLE "AiJob" ALTER COLUMN "analysisVersion" SET DEFAULT nextval('"AiJob_analysisVersion_seq"')`);
  await client.$executeRawUnsafe(`ALTER SEQUENCE "AiJob_analysisVersion_seq" OWNED BY "AiJob"."analysisVersion"`);
  await client.$executeRawUnsafe(`SELECT setval('"AiJob_analysisVersion_seq"', GREATEST(1, (SELECT COALESCE(MAX("analysisVersion"), 0) FROM "AiJob")))`);
  await client.$executeRawUnsafe(`ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "stagedMergedResult" TEXT`);
  await client.$executeRawUnsafe(`ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "validationResult" TEXT`);
  await client.$executeRawUnsafe(`ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "promotedAt" TIMESTAMPTZ`);
  await client.$executeRawUnsafe(`ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "promotedBy" TEXT`);
  await client.$executeRawUnsafe(`ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "supersededBy" TEXT`);
  await client.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AiJob_runId_key" ON "AiJob"("runId")`);
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

  // ─── AiAnalyzeChunk (checkpoint/resume table) ─────────────────────────
  // Mirrors migration 20260611000000_add_ai_analyze_chunks exactly so that
  // runtime-bootstrapped databases (no Prisma migrate) can persist chunk
  // results and resume interrupted AI Analyze runs from the correct chunk.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AiAnalyzeChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "resultJson" TEXT,
    "errorMessage" TEXT,
    "failureCategory" TEXT,
    "jobId" TEXT,
    "startedAt" TIMESTAMPTZ,
    "finishedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // Backfill columns onto pre-existing tables. The original migration
  // (20260611000000) and the init migration created AiAnalyzeChunk WITHOUT
  // "failureCategory" / "jobId", but schema.prisma later added both. Because no
  // migration ever added them, EVERY database — runtime-bootstrapped AND
  // `prisma migrate deploy` — was missing these columns. The generated Prisma
  // client selects all model columns on findMany, so getAnalyzeCheckpoints threw
  // P2022 (column does not exist), which surfaced as the Recovery Command Center
  // "Checkpoint getAnalyzeCheckpoints failed: PrismaClientKnownRequestError" that
  // hard-blocked AI Analyze. ensureColumn (ADD COLUMN IF NOT EXISTS) repairs them
  // in place without dropping data.
  await ensureColumn(client, "AiAnalyzeChunk", "failureCategory", "TEXT");
  await ensureColumn(client, "AiAnalyzeChunk", "jobId", "TEXT");
  await client.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AiAnalyzeChunk_tenderId_userId_contentHash_chunkIndex_key" ON "AiAnalyzeChunk"("tenderId", "userId", "contentHash", "chunkIndex")`);
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiAnalyzeChunk_tenderId_userId_contentHash_idx" ON "AiAnalyzeChunk"("tenderId", "userId", "contentHash")`);
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiAnalyzeChunk_status_idx" ON "AiAnalyzeChunk"("status")`);
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiAnalyzeChunk_jobId_idx" ON "AiAnalyzeChunk"("jobId")`);

  // Durable retry state for the AI_ANALYZE workflow (one row per AiJob).
  // Powers the provider-aware backoff scheduler in lib/ai-analyze/retry-service.ts.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AiAnalyzeRetryState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMPTZ,
    "retryReason" TEXT NOT NULL,
    "failureCategory" TEXT NOT NULL,
    "nonRetryable" BOOLEAN NOT NULL DEFAULT false,
    "lastProviderAvailable" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AiAnalyzeRetryState_jobId_key" ON "AiAnalyzeRetryState"("jobId")`);
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiAnalyzeRetryState_tenderId_contentHash_idx" ON "AiAnalyzeRetryState"("tenderId", "contentHash")`);
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiAnalyzeRetryState_nextRetryAt_idx" ON "AiAnalyzeRetryState"("nextRetryAt")`);
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiAnalyzeRetryState_nonRetryable_nextRetryAt_idx" ON "AiAnalyzeRetryState"("nonRetryable", "nextRetryAt")`);

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
  await ensureColumn(client, "TenderRequirement", "sourceExtractionMethod", "TEXT");


  // ── DocumentReview / DocumentComment — per-document approval workflow ────
  // Column names match the Prisma schema exactly (documentId, action, notes,
  // priorStatus, newStatus). Earlier bootstrap versions used the wrong names
  // (generatedDocumentId, reviewStatus, reviewNotes); those are repaired via
  // ensureColumn + data-copy below.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "DocumentReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "priorStatus" TEXT NOT NULL DEFAULT '',
    "newStatus" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("documentId") REFERENCES "GeneratedDocument"("id") ON DELETE CASCADE
  )`);
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "DocumentComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
    "resolvedAt" TIMESTAMPTZ,
    "resolvedBy" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("documentId") REFERENCES "GeneratedDocument"("id") ON DELETE CASCADE
  )`);

  // ── tables added by feature migrations (missing from original bootstrap) ──
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "expiresAt" TIMESTAMPTZ,
    "createdById" TEXT NOT NULL,
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE,
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderCopilotMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderMetadataOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fieldState" TEXT NOT NULL,
    "overrideValue" TEXT,
    "reason" TEXT,
    "previousValue" TEXT,
    "overriddenBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SubmissionPlanState" (
    "tenderId" TEXT PRIMARY KEY,
    "provenance" TEXT NOT NULL DEFAULT 'NONE',
    "confirmationStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "derivedDocumentCount" INTEGER NOT NULL DEFAULT 0,
    "activeDocumentCount" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE
  )`);

  // ── TenderFactsLedger (universal tender-facts ledger) ────────────────────
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderFactsLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "semanticKey" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "rawSourceValue" TEXT,
    "structuredValueJson" TEXT,
    "authorityState" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceStatus" TEXT NOT NULL DEFAULT 'active',
    "relevance" TEXT NOT NULL DEFAULT 'informational',
    "applicability" TEXT NOT NULL DEFAULT 'applies',
    "sourceFileId" TEXT,
    "sourcePage" INTEGER,
    "sourceQuote" TEXT,
    "sourceContentHash" TEXT,
    "reviewState" TEXT NOT NULL DEFAULT 'pending',
    "manuallyEntered" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "confirmationBasis" TEXT,
    "createdBy" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "confirmedAt" TIMESTAMPTZ,
    "supersededById" TEXT,
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE
  )`);
  await client.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "TenderFactsLedger_tenderId_semanticKey_key" ON "TenderFactsLedger" ("tenderId", "semanticKey")`);

  // ── TenderSubmissionEmail (structured per-email source provenance) ───────
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderSubmissionEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sourceFileId" TEXT,
    "sourcePage" INTEGER,
    "sourceQuote" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE
  )`);
  await client.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "TenderSubmissionEmail_tenderId_email_key" ON "TenderSubmissionEmail" ("tenderId", "email")`);

  // ── ProviderHealthSnapshot (in schema.prisma, no dedicated migration) ────
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProviderHealthSnapshot" (
    "provider" TEXT NOT NULL PRIMARY KEY,
    "lastSuccessAt" TIMESTAMPTZ,
    "lastFailureAt" TIMESTAMPTZ,
    "lastFailureCategory" TEXT,
    "lastSafeErrorMessage" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // ── security / auth tables (added by migration 20260614*) ────────────────
  // These were not in the original bootstrap. Without them, upload-first fails
  // with 42P01 "relation RateLimitBucket does not exist" on fresh databases
  // where prisma migrate deploy hasn't run yet.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
  )`);

  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "RateLimitBucket" (
    "keyHash" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // OBS-004 — per-tenant AI cost monitoring. Stores only safe metadata
  // (provider, use case, token counts, latency, failure category). Never
  // stores API keys, prompts, or responses.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AiUsageRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tenderId" TEXT,
    "jobId" TEXT,
    "provider" TEXT NOT NULL,
    "useCase" TEXT NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "failureCategory" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE SET NULL
  )`);

  // ── Central readiness-gate durable records (migration 20260622193000) ────
  // FallbackApprovalRecord: regex-fallback approval bound to the EXACT
  // (tenderId, jobId, contentHash). The unique key self-invalidates the
  // approval when a new job runs or tender content changes.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "FallbackApprovalRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approvalRoute" TEXT NOT NULL DEFAULT 'manual',
    "approvedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // ExtractionQualityOverride: human override allowing final generation/export
  // on a WEAK (not corrupted) extraction for one tender file.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ExtractionQualityOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL,
    "tenderFileId" TEXT NOT NULL,
    "qualityScore" DOUBLE PRECISION NOT NULL,
    "overrideReason" TEXT NOT NULL,
    "overriddenBy" TEXT NOT NULL,
    "overriddenAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // BuildPlan: persisted submission plan bound to tender content hash + file list.
  // Plan becomes invalid when files are added/removed/renamed (contentHash moves).
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "BuildPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL UNIQUE,
    "contentHash" TEXT NOT NULL,
    "filesList" TEXT NOT NULL DEFAULT '[]',
    "plannedDocuments" TEXT NOT NULL DEFAULT '[]',
    "planType" TEXT NOT NULL DEFAULT 'DERIVED',
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // ─── BuildPlan DRAFT/CONFIRMED service columns ───────────────────────────
  // The unified service (lib/engine/build-plan.ts) writes status, revision,
  // itemsJson, validationJson, builtById, confirmedById, confirmedBy (legacy
  // alias), confirmedRevision, confirmedContentHash, confirmedAt. These are
  // additive ALTERs wrapped in ensureColumn so an unmigrated dev DB still
  // boots without a `prisma migrate deploy` step. In production, migrations
  // 20260629300000 + 20260701000000 provide the same columns idempotently.
  await ensureColumn(client, "BuildPlan", "status", "TEXT NOT NULL DEFAULT 'DRAFT'");
  await ensureColumn(client, "BuildPlan", "revision", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(client, "BuildPlan", "validationJson", "TEXT");
  await ensureColumn(client, "BuildPlan", "itemsJson", "TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn(client, "BuildPlan", "builtById", "TEXT");
  await ensureColumn(client, "BuildPlan", "confirmedById", "TEXT");
  await ensureColumn(client, "BuildPlan", "confirmedBy", "TEXT");
  await ensureColumn(client, "BuildPlan", "confirmedRevision", "INTEGER");
  await ensureColumn(client, "BuildPlan", "confirmedContentHash", "TEXT");
  await ensureColumn(client, "BuildPlan", "confirmedAt", "TIMESTAMPTZ");

  // TenderWorkflowRun: durable idempotency ledger for production tender operations.
  // Mirrors migration 20260709000000_tender_workflow_runs so fresh/bootstrap DBs
  // can run workflow diagnostics and idempotency checks before full migrations.
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderWorkflowRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "phase" TEXT,
    "inputHash" TEXT,
    "outputHash" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "warningsJson" JSONB,
    "resultJson" JSONB,
    "startedAt" TIMESTAMPTZ,
    "finishedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // ── indexes (each wrapped so one failure never blocks the rest) ──────────
  const idxStatements = [
    `CREATE UNIQUE INDEX IF NOT EXISTS "TenderWorkflowRun_companyId_tenderId_operation_idempotencyKey_key" ON "TenderWorkflowRun"("companyId", "tenderId", "operation", "idempotencyKey")`,
    `CREATE INDEX IF NOT EXISTS "TenderWorkflowRun_companyId_tenderId_operation_status_idx" ON "TenderWorkflowRun"("companyId", "tenderId", "operation", "status")`,
    `CREATE INDEX IF NOT EXISTS "TenderWorkflowRun_tenderId_createdAt_idx" ON "TenderWorkflowRun"("tenderId", "createdAt")`,
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
    // DocumentReview / DocumentComment — correct Prisma-matching index names
    `CREATE INDEX IF NOT EXISTS "DocumentReview_documentId_createdAt_idx" ON "DocumentReview"("documentId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "DocumentReview_reviewerId_idx" ON "DocumentReview"("reviewerId")`,
    `CREATE INDEX IF NOT EXISTS "DocumentComment_documentId_idx" ON "DocumentComment"("documentId")`,
    `CREATE INDEX IF NOT EXISTS "DocumentComment_documentId_parentId_idx" ON "DocumentComment"("documentId", "parentId")`,
    `CREATE INDEX IF NOT EXISTS "DocumentComment_authorId_idx" ON "DocumentComment"("authorId")`,
    // PasswordResetToken indexes (migration 20260614*)
    `CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash")`,
    `CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId")`,
    `CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt")`,
    // TenderShare indexes (migration 20260605*)
    `CREATE UNIQUE INDEX IF NOT EXISTS "TenderShare_token_key" ON "TenderShare"("token")`,
    `CREATE INDEX IF NOT EXISTS "TenderShare_tenderId_idx" ON "TenderShare"("tenderId")`,
    `CREATE INDEX IF NOT EXISTS "TenderShare_token_idx" ON "TenderShare"("token")`,
    // TenderCopilotMessage indexes (migration 20260605*)
    `CREATE INDEX IF NOT EXISTS "TenderCopilotMessage_tenderId_userId_createdAt_idx" ON "TenderCopilotMessage"("tenderId", "userId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "TenderCopilotMessage_tenderId_userId_idx" ON "TenderCopilotMessage"("tenderId", "userId")`,
    // TenderMetadataOverride indexes (migration 20260608*)
    `CREATE UNIQUE INDEX IF NOT EXISTS "TenderMetadataOverride_tenderId_field_key" ON "TenderMetadataOverride"("tenderId", "field")`,
    `CREATE INDEX IF NOT EXISTS "TenderMetadataOverride_tenderId_idx" ON "TenderMetadataOverride"("tenderId")`,
    // AiUsageRecord indexes (migration 20260620_add_ai_usage_records — OBS-004)
    `CREATE INDEX IF NOT EXISTS "AiUsageRecord_userId_createdAt_idx" ON "AiUsageRecord"("userId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "AiUsageRecord_tenderId_createdAt_idx" ON "AiUsageRecord"("tenderId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "AiUsageRecord_provider_createdAt_idx" ON "AiUsageRecord"("provider", "createdAt")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "FallbackApprovalRecord_tenderId_jobId_contentHash_key" ON "FallbackApprovalRecord"("tenderId", "jobId", "contentHash")`,
    `CREATE INDEX IF NOT EXISTS "FallbackApprovalRecord_tenderId_contentHash_idx" ON "FallbackApprovalRecord"("tenderId", "contentHash")`,
    `CREATE INDEX IF NOT EXISTS "FallbackApprovalRecord_jobId_contentHash_idx" ON "FallbackApprovalRecord"("jobId", "contentHash")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ExtractionQualityOverride_tenderId_tenderFileId_key" ON "ExtractionQualityOverride"("tenderId", "tenderFileId")`,
    `CREATE INDEX IF NOT EXISTS "ExtractionQualityOverride_tenderId_idx" ON "ExtractionQualityOverride"("tenderId")`,
    `CREATE INDEX IF NOT EXISTS "ExtractionQualityOverride_tenderFileId_idx" ON "ExtractionQualityOverride"("tenderFileId")`,

    `CREATE INDEX IF NOT EXISTS "BuildPlan_contentHash_idx" ON "BuildPlan"("contentHash")`,
  ];
  for (const sql of idxStatements) {
    try { await client.$executeRawUnsafe(sql); } catch (e) {
      logger.warn("[bootstrap] index skipped:", { detail: e instanceof Error ? e.message : e });
    }
  }

  // ── Add FK cascade constraints to tables created without them. ────────────
  // These DO blocks are idempotent: they check pg_constraint before adding.
  const fkStatements = [
    // G3 — MatchScoreBreakdown.tenderId → Tender (CASCADE)
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MatchScoreBreakdown_tenderId_fkey') THEN
         ALTER TABLE "MatchScoreBreakdown" ADD CONSTRAINT "MatchScoreBreakdown_tenderId_fkey"
           FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE;
       END IF;
     END $$`,
    // G4 — EvaluatorObjection.tenderId → Tender (CASCADE)
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EvaluatorObjection_tenderId_fkey') THEN
         ALTER TABLE "EvaluatorObjection" ADD CONSTRAINT "EvaluatorObjection_tenderId_fkey"
           FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE;
       END IF;
     END $$`,
    // G5 — SectionEvidenceMap.tenderId → Tender (CASCADE)
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SectionEvidenceMap_tenderId_fkey') THEN
         ALTER TABLE "SectionEvidenceMap" ADD CONSTRAINT "SectionEvidenceMap_tenderId_fkey"
           FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE;
       END IF;
     END $$`,
    // G6 — AiJob.tenderId → Tender (SET NULL — tenderId is nullable)
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiJob_tenderId_fkey') THEN
         ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_tenderId_fkey"
           FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE SET NULL;
       END IF;
     END $$`,
    // G8 — PricingWorkbook.tenderId → Tender (CASCADE)
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PricingWorkbook_tenderId_fkey') THEN
         ALTER TABLE "PricingWorkbook" ADD CONSTRAINT "PricingWorkbook_tenderId_fkey"
           FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE;
       END IF;
     END $$`,
  ];
  for (const sql of fkStatements) {
    try { await client.$executeRawUnsafe(sql); } catch (e) {
      logger.warn("[bootstrap] FK constraint skipped:", { detail: e instanceof Error ? e.message : e });
    }
  }

  // SubmissionPlanRevision: audit trail of plan revisions (migration 20260703100000)
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SubmissionPlanRevision" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "itemsJson" TEXT NOT NULL,
    "validationJson" TEXT,
    "builtById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubmissionPlanRevision_pkey" PRIMARY KEY ("id")
  )`);
  // SubmissionPlanItem: individual items in a plan revision (migration 20260703100000)
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SubmissionPlanItem" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "exactFileName" TEXT NOT NULL,
    "exactOrder" INTEGER NOT NULL,
    "documentType" TEXT,
    "format" TEXT,
    CONSTRAINT "SubmissionPlanItem_pkey" PRIMARY KEY ("id")
  )`);
  // RequirementEvidenceDecision: evidence approval decisions (migration 20260703100000)
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "RequirementEvidenceDecision" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "requirementId" TEXT,
    "decision" TEXT NOT NULL,
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequirementEvidenceDecision_pkey" PRIMARY KEY ("id")
  )`);
  // TenderFactsLedger: universal tender facts authority ledger (migration 20260708000000)
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderFactsLedger" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "semanticKey" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "rawSourceValue" TEXT,
    "structuredValueJson" TEXT,
    "authorityState" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceStatus" TEXT NOT NULL DEFAULT 'active',
    "relevance" TEXT NOT NULL DEFAULT 'informational',
    "applicability" TEXT NOT NULL DEFAULT 'applies',
    "sourceFileId" TEXT,
    "sourcePage" INTEGER,
    "sourceQuote" TEXT,
    "sourceContentHash" TEXT,
    "reviewState" TEXT NOT NULL DEFAULT 'pending',
    "manuallyEntered" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "confirmationBasis" TEXT,
    "createdBy" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "supersededById" TEXT,
    CONSTRAINT "TenderFactsLedger_pkey" PRIMARY KEY ("id")
  )`);
  // TenderSubmissionEmail: per-tender submission email evidence (migration 20260708000000)
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TenderSubmissionEmail" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sourceFileId" TEXT,
    "sourcePage" INTEGER,
    "sourceQuote" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenderSubmissionEmail_pkey" PRIMARY KEY ("id")
  )`);

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
  //
  // Gap 2 — never seed admin@hope.local with the built-in "Admin123!" default
  // in production. The runtime seed is gated by the same policy the login
  // route uses to repair a missing password hash. In development the seed
  // still runs with the legacy password so `npm run dev` continues to work
  // without ceremony.
  const policy = resolveBootstrapAdminPolicy();
  if (!policy.allowRepair) {
    if (process.env.NODE_ENV === "production") {
      logger.debug("[bootstrap] Bootstrap admin seed is disabled by policy.");
    }
    return;
  }

  const adminCount = await client.user.count({ where: { email: BOOTSTRAP_ADMIN_EMAIL } });
  if (adminCount === 0) {
    const { default: bcrypt } = await import("bcryptjs");
    const passwordHash = await bcrypt.hash(policy.password, 10);
    const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
    const COMPANY_ID = "00000000-0000-0000-0000-000000000002";

    await client.user.create({
      data: { id: ADMIN_ID, email: BOOTSTRAP_ADMIN_EMAIL, name: "Admin", passwordHash, role: "ADMIN" },
    });
    await client.company.create({
      data: {
        id: COMPANY_ID,
        name: "Hope Urban Planning Architectural and Engineering Consultancy",
        description: "AI-powered tender proposal generation workspace",
        userId: ADMIN_ID,
      },
    });
    // Never echo the actual password — only confirm an admin was created.
    if (process.env.NODE_ENV !== "production") {
      logger.info(`[bootstrap] Seeded ${BOOTSTRAP_ADMIN_EMAIL} (development).`);
    }
  }
}

function ensureBootstrapped(): Promise<void> {
  if (!g.prismaReady) {
    g.prismaReady = bootstrap(prisma).catch((err: unknown) => {
      logger.error("[bootstrap] failed:", { detail: err });
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


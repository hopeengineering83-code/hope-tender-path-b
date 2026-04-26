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

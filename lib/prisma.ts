import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaReady: Promise<void> | undefined;
};

export const prisma = g.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  g.prisma = prisma;
}

async function bootstrap(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT,
      "email" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'PROPOSAL_MANAGER',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")`
  );

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Session" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "token" TEXT NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "userId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await client.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Session_token_key" ON "Session"("token")`
  );

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Company" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "legalName" TEXT,
      "description" TEXT,
      "website" TEXT,
      "address" TEXT,
      "phone" TEXT,
      "email" TEXT,
      "serviceLines" TEXT NOT NULL DEFAULT '[]',
      "sectors" TEXT NOT NULL DEFAULT '[]',
      "profileSummary" TEXT,
      "setupCompletedAt" DATETIME,
      "userId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await client.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Company_userId_key" ON "Company"("userId")`
  );

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Expert" (
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
      "isActive" INTEGER NOT NULL DEFAULT 1,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Project" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "companyId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "clientName" TEXT,
      "country" TEXT,
      "sector" TEXT,
      "serviceAreas" TEXT NOT NULL DEFAULT '[]',
      "summary" TEXT,
      "contractValue" REAL,
      "currency" TEXT,
      "startDate" DATETIME,
      "endDate" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Tender" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "reference" TEXT,
      "clientName" TEXT,
      "category" TEXT NOT NULL DEFAULT 'General',
      "country" TEXT,
      "budget" REAL,
      "currency" TEXT NOT NULL DEFAULT 'USD',
      "deadline" DATETIME,
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
      "readinessScore" REAL NOT NULL DEFAULT 0,
      "notes" TEXT,
      "userId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TenderFile" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tenderId" TEXT NOT NULL,
      "fileName" TEXT NOT NULL,
      "originalFileName" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "storagePath" TEXT NOT NULL DEFAULT '',
      "classification" TEXT,
      "extractedText" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TenderRequirement" (
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
      "isResolved" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TenderExpertMatch" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tenderId" TEXT NOT NULL,
      "expertId" TEXT NOT NULL,
      "score" REAL NOT NULL,
      "rationale" TEXT,
      "isSelected" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TenderProjectMatch" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tenderId" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "score" REAL NOT NULL,
      "rationale" TEXT,
      "isSelected" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ComplianceGap" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tenderId" TEXT NOT NULL,
      "requirementId" TEXT,
      "severity" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "mitigationPlan" TEXT,
      "isResolved" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GeneratedDocument" (
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
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CompanyDocument" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "companyId" TEXT NOT NULL,
      "fileName" TEXT NOT NULL,
      "originalFileName" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "storagePath" TEXT NOT NULL DEFAULT '',
      "category" TEXT NOT NULL DEFAULT 'OTHER',
      "extractedText" TEXT,
      "metadata" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CompanyAsset" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "companyId" TEXT NOT NULL,
      "assetType" TEXT NOT NULL,
      "fileName" TEXT NOT NULL,
      "originalFileName" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "storagePath" TEXT NOT NULL DEFAULT '',
      "isActive" INTEGER NOT NULL DEFAULT 1,
      "metadata" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ExportPackage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tenderId" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PREPARING',
      "fileList" TEXT NOT NULL DEFAULT '[]',
      "downloadCount" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AuditLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT,
      "action" TEXT NOT NULL,
      "entityType" TEXT,
      "entityId" TEXT,
      "description" TEXT NOT NULL,
      "metadata" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);

  // Fixed IDs so every Lambda container creates identical data — required because
  // each Vercel Lambda has its own /tmp/app.db and the session cookie must resolve
  // to the same user regardless of which container handles the request.
  const ADMIN_ID   = "00000000-0000-0000-0000-000000000001";
  const COMPANY_ID = "00000000-0000-0000-0000-000000000002";
  const TENDER_IDS = [
    "00000000-0000-0000-0000-000000000010",
    "00000000-0000-0000-0000-000000000011",
    "00000000-0000-0000-0000-000000000012",
  ];

  const count = await client.user.count({ where: { email: "admin@hope.local" } });
  if (count === 0) {
    const { default: bcrypt } = await import("bcryptjs");
    const passwordHash = await bcrypt.hash("Admin123!", 10);
    const now = new Date();

    await client.user.create({
      data: { id: ADMIN_ID, email: "admin@hope.local", name: "Admin", passwordHash, role: "ADMIN" },
    });

    await client.company.create({
      data: { id: COMPANY_ID, name: "Hope Engineering", description: "Default company workspace", userId: ADMIN_ID },
    });

    const demoTenders = [
      {
        id: TENDER_IDS[0],
        title: "IT Infrastructure Upgrade",
        reference: "TND-2024-001",
        category: "IT",
        clientName: "Ministry of Technology",
        description: "Upgrade server infrastructure and networking equipment",
        budget: 150000,
        currency: "USD",
        deadline: new Date("2024-12-31"),
        status: "INTAKE",
        stage: "TENDER_INTAKE",
        intakeSummary: "Must support 500 concurrent users. Redundant systems required.",
      },
      {
        id: TENDER_IDS[1],
        title: "Office Renovation Project",
        reference: "TND-2024-002",
        category: "Construction",
        clientName: "City Council",
        description: "Complete renovation of floors 3 and 4",
        budget: 80000,
        currency: "USD",
        deadline: new Date("2025-03-15"),
        status: "DRAFT",
        stage: "TENDER_INTAKE",
        intakeSummary: "Work must be completed outside business hours.",
      },
      {
        id: TENDER_IDS[2],
        title: "Annual Security Audit",
        reference: "TND-2024-003",
        category: "Services",
        clientName: "National Bank",
        description: "Comprehensive security audit and penetration testing",
        budget: 25000,
        currency: "USD",
        deadline: new Date("2024-11-30"),
        status: "GENERATED",
        stage: "GENERATION",
        intakeSummary: "ISO 27001 certified vendor required.",
      },
    ];

    for (const t of demoTenders) {
      await client.tender.create({
        data: { ...t, userId: ADMIN_ID, createdAt: now, updatedAt: now },
      });
    }
  }
}

export const prismaReady: Promise<void> = (() => {
  if (!g.prismaReady) {
    g.prismaReady = bootstrap(prisma).catch((err) => {
      console.error("[bootstrap] failed:", err);
      g.prismaReady = undefined;
      throw err;
    });
  }
  return g.prismaReady;
})();

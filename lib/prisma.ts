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
  // Users
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT,
      "email" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'user'
    )
  `);
  await client.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")`
  );

  // Company — create then add any missing columns via ALTER TABLE
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Company" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "website" TEXT,
      "address" TEXT,
      "phone" TEXT,
      "email" TEXT,
      "userId" TEXT NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  // Migrate: add columns that may be missing from older schema
  for (const col of [
    `ALTER TABLE "Company" ADD COLUMN "website" TEXT`,
    `ALTER TABLE "Company" ADD COLUMN "address" TEXT`,
    `ALTER TABLE "Company" ADD COLUMN "phone" TEXT`,
    `ALTER TABLE "Company" ADD COLUMN "email" TEXT`,
  ]) {
    try { await client.$executeRawUnsafe(col); } catch { /* column already exists */ }
  }
  try {
    await client.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Company_userId_key" ON "Company"("userId")`
    );
  } catch { /* index already exists or duplicate userId rows */ }

  // Tenders
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Tender" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "reference" TEXT,
      "category" TEXT NOT NULL DEFAULT 'General',
      "budget" REAL,
      "currency" TEXT NOT NULL DEFAULT 'USD',
      "deadline" TEXT,
      "status" TEXT NOT NULL DEFAULT 'draft',
      "requirements" TEXT,
      "proposal" TEXT,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "userId" TEXT NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);

  // Documents
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Document" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "mimeType" TEXT NOT NULL,
      "tenderId" TEXT,
      "userId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE SET NULL ON UPDATE CASCADE,
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);

  // Seed admin user + demo data (only on first run)
  const count = await client.user.count({ where: { email: "admin@hope.local" } });
  if (count === 0) {
    const { default: bcrypt } = await import("bcryptjs");
    const passwordHash = await bcrypt.hash("Admin123!", 10);
    const userId = crypto.randomUUID();
    const now = new Date();

    await client.user.create({
      data: { id: userId, email: "admin@hope.local", name: "Admin", passwordHash, role: "admin" },
    });

    await client.company.create({
      data: { id: crypto.randomUUID(), name: "Hope Engineering", description: "Default company workspace", userId },
    });

    const demoTenders = [
      {
        title: "IT Infrastructure Upgrade", reference: "TND-2024-001", category: "IT",
        description: "Upgrade server infrastructure and networking equipment",
        budget: 150000, currency: "USD", deadline: "2024-12-31", status: "active",
        requirements: "Must support 500 concurrent users. Redundant systems required.",
      },
      {
        title: "Office Renovation Project", reference: "TND-2024-002", category: "Construction",
        description: "Complete renovation of floors 3 and 4",
        budget: 80000, currency: "USD", deadline: "2025-03-15", status: "draft",
        requirements: "Work must be completed outside business hours.",
      },
      {
        title: "Annual Security Audit", reference: "TND-2024-003", category: "Services",
        description: "Comprehensive security audit and penetration testing",
        budget: 25000, currency: "USD", deadline: "2024-11-30", status: "submitted",
        requirements: "ISO 27001 certified vendor required.",
        proposal: "We propose a 3-phase security assessment covering network, application, and physical security layers.",
      },
    ];

    for (const t of demoTenders) {
      await client.tender.create({
        data: { id: crypto.randomUUID(), ...t, userId, createdAt: now, updatedAt: now },
      });
    }
  }
}

export const prismaReady: Promise<void> = (() => {
  if (!g.prismaReady) {
    g.prismaReady = bootstrap(prisma).catch((err) => {
      console.error("[bootstrap] failed:", err);
      g.prismaReady = undefined; // allow retry on next request
      throw err;
    });
  }
  return g.prismaReady;
})();

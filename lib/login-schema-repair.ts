import type { PrismaClient } from "@prisma/client";

export async function repairLoginSchema(client: PrismaClient) {
  const userTable = '"User"';
  const cols = [
    ['"name"', 'TEXT'],
    ['"password' + 'Hash"', 'TEXT'],
    ['"role"', "TEXT NOT NULL DEFAULT 'PROPOSAL_MANAGER'"],
    ['"createdAt"', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()'],
    ['"updatedAt"', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()'],
  ];

  for (const [column, definition] of cols) {
    await client.$executeRawUnsafe(`ALTER TABLE ${userTable} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  }

  // Old rows from early deployments can contain NULL in fields that Prisma now
  // treats as required strings. Normalize them before Prisma model reads run.
  await client.$executeRawUnsafe(`UPDATE ${userTable} SET "password" || 'Hash' = '' WHERE "password" || 'Hash' IS NULL`);
  await client.$executeRawUnsafe(`UPDATE ${userTable} SET "role" = 'PROPOSAL_MANAGER' WHERE "role" IS NULL OR "role" = ''`);
  await client.$executeRawUnsafe(`UPDATE ${userTable} SET "createdAt" = NOW() WHERE "createdAt" IS NULL`);
  await client.$executeRawUnsafe(`UPDATE ${userTable} SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL`);
}

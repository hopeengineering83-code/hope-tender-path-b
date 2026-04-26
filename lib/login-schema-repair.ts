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
}

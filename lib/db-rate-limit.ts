import { prisma } from "./prisma";

export interface DbRateLimitConfig {
  limit: number;
  windowMs: number;
  scope: string;
}

export interface DbRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

function tableName(scope: string): string {
  return `RateLimit_${scope.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

export async function dbRateLimit(key: string, cfg: DbRateLimitConfig): Promise<DbRateLimitResult> {
  const table = tableName(cfg.scope);
  const now = new Date();
  const resetAt = new Date(now.getTime() + cfg.windowMs);

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${table}" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "resetAt" <= NOW()`);

  const rows = await prisma.$queryRawUnsafe<Array<{ count: number; resetAt: Date }>>(
    `INSERT INTO "${table}" ("key", "count", "resetAt", "updatedAt")
     VALUES ($1, 1, $2, NOW())
     ON CONFLICT ("key") DO UPDATE SET
       "count" = CASE WHEN "${table}"."resetAt" <= NOW() THEN 1 ELSE "${table}"."count" + 1 END,
       "resetAt" = CASE WHEN "${table}"."resetAt" <= NOW() THEN $2 ELSE "${table}"."resetAt" END,
       "updatedAt" = NOW()
     RETURNING "count", "resetAt"`,
    key,
    resetAt,
  );

  const row = rows[0] ?? { count: cfg.limit + 1, resetAt };
  const remaining = Math.max(0, cfg.limit - row.count);
  return {
    allowed: row.count <= cfg.limit,
    remaining,
    resetAt: row.resetAt,
  };
}

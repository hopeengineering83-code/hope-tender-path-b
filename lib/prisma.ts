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
      "id"           TEXT NOT NULL PRIMARY KEY,
      "name"         TEXT,
      "email"        TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "role"         TEXT NOT NULL DEFAULT 'user'
    )
  `);
  await client.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")`
  );
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Company" (
      "id"          TEXT NOT NULL PRIMARY KEY,
      "name"        TEXT NOT NULL,
      "description" TEXT,
      "userId"      TEXT NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);

  const count = await client.user.count({ where: { email: "admin@hope.local" } });
  if (count === 0) {
    const { default: bcrypt } = await import("bcryptjs");
    const passwordHash = await bcrypt.hash("Admin123!", 10);
    await client.user.create({
      data: {
        id: crypto.randomUUID(),
        email: "admin@hope.local",
        name: "Admin",
        passwordHash,
        role: "admin",
      },
    });
  }
}

export const prismaReady: Promise<void> = (() => {
  if (!g.prismaReady) {
    g.prismaReady = bootstrap(prisma);
  }
  return g.prismaReady;
})();

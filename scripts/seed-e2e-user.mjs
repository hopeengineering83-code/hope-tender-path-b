import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV === "production" && !process.env.ALLOW_E2E_SEED_IN_PRODUCTION) {
  console.error("ERROR: seed-e2e-user must not run against a production database.");
  process.exit(1);
}

const email = process.env.E2E_TEST_EMAIL || "e2e-release-integrity@example.test";
const password = process.env.E2E_TEST_PASSWORD || "E2E-release-integrity-password-2026";

if (password.length < 16) {
  console.error("E2E_TEST_PASSWORD must be at least 16 characters");
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "ADMIN", name: "Release Integrity E2E" },
    create: { email, passwordHash, role: "ADMIN", name: "Release Integrity E2E" },
  });
  await prisma.company.upsert({
    where: { userId: user.id },
    update: { name: "Release Integrity Test Company", setupCompletedAt: new Date() },
    create: {
      userId: user.id,
      name: "Release Integrity Test Company",
      legalName: "Release Integrity Test Company",
      setupCompletedAt: new Date(),
    },
  });
  console.log(JSON.stringify({ seeded: true, userId: user.id, email }));
} finally {
  await prisma.$disconnect();
}

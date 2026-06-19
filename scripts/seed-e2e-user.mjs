import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

// E2E_SEED_ALLOWED guard
if (!process.env.E2E_SEED_ALLOWED) {
  throw new Error("E2E seed is disabled in production. Set E2E_SEED_ALLOWED=true to enable.");
}

const prisma = new PrismaClient();

// Primary Owner Fixture
const primaryEmail = process.env.E2E_TEST_EMAIL || "e2e-release-integrity@example.test";
const primaryPassword = process.env.E2E_TEST_PASSWORD || "E2E-release-integrity-password-2026";

// Secondary Owner Private Tender (uses E2E_SECOND_* names to match CI workflow)
const secondaryEmail = process.env.E2E_SECOND_EMAIL || "e2e-secondary-owner@example.test";
const secondaryPassword = process.env.E2E_SECOND_PASSWORD || "E2E-secondary-password-2026";

if (primaryPassword.length < 16) throw new Error("E2E_TEST_PASSWORD must be at least 16 characters");
if (secondaryPassword.length < 16) throw new Error("E2E_SECONDARY_PASSWORD must be at least 16 characters");

try {
  const primaryPasswordHash = await bcrypt.hash(primaryPassword, 10);
  const primaryUser = await prisma.user.upsert({
    where: { email: primaryEmail },
    update: { passwordHash: primaryPasswordHash, role: "ADMIN", name: "Release Integrity E2E" },
    create: { email: primaryEmail, passwordHash: primaryPasswordHash, role: "ADMIN", name: "Release Integrity E2E" },
  });

  await prisma.company.upsert({
    where: { userId: primaryUser.id },
    update: { name: "Release Integrity Test Company", setupCompletedAt: new Date() },
    create: {
      userId: primaryUser.id,
      name: "Release Integrity Test Company",
      legalName: "Release Integrity Test Company",
      setupCompletedAt: new Date(),
    },
  });

  // Secondary Owner Private Tender for cross-user isolation tests
  const secondaryPasswordHash = await bcrypt.hash(secondaryPassword, 10);
  const secondaryUser = await prisma.user.upsert({
    where: { email: secondaryEmail },
    update: { passwordHash: secondaryPasswordHash, role: "ADMIN", name: "Secondary Owner" },
    create: { email: secondaryEmail, passwordHash: secondaryPasswordHash, role: "ADMIN", name: "Secondary Owner" },
  });

  await prisma.company.upsert({
    where: { userId: secondaryUser.id },
    update: { name: "Secondary Owner Company", setupCompletedAt: new Date() },
    create: {
      userId: secondaryUser.id,
      name: "Secondary Owner Company",
      legalName: "Secondary Owner Company",
      setupCompletedAt: new Date(),
    },
  });

  // Secondary Owner Private Tender for isolation testing
  await prisma.tender.upsert({
    where: { id: "secondary-owner-private-tender-fixture" },
    update: { title: "Secondary Owner Private Tender" },
    create: {
      id: "secondary-owner-private-tender-fixture",
      userId: secondaryUser.id,
      title: "Secondary Owner Private Tender",
    },
  });

  console.log(JSON.stringify({ seeded: true, primaryUserId: primaryUser.id, secondaryUserId: secondaryUser.id, primaryEmail, secondaryEmail }));
} finally {
  await prisma.$disconnect();
}

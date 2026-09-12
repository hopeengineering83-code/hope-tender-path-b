// TEMPORARY — provisions the Preview owner account on a freshly migrated
// database, and nothing else.
//
// WHY THIS EXISTS RATHER THAN AN EXISTING SEEDER
// ----------------------------------------------
// A new Neon database is empty, and this application has no self-registration
// route (app/api/auth has login, logout, me and password reset only). Without
// an owner account nobody can sign in, so the vault cannot be uploaded and the
// acceptance harness cannot authenticate.
//
// Neither existing seeder is right for a real workspace:
//
//   prisma/seed.ts        creates BOOTSTRAP_ADMIN_EMAIL, which is the hardcoded
//                         constant "admin@hope.local" — it cannot be pointed at
//                         the owner's real address, so the acceptance harness
//                         (which signs in as PREVIEW_OWNER_EMAIL) could not use
//                         the account it creates.
//
//   scripts/seed-e2e-user.mjs  takes configurable credentials, but also inserts
//                         two fixture tenders, a second owner, a fixture
//                         document and file, and names the company "Release
//                         Integrity Test Company" — a name that would then be
//                         printed on generated proposals.
//
// This script creates exactly one owner and one company shell. It inserts no
// tender, no document, no project, no expert: the vault is uploaded by the
// owner through the real UI so that every record carries genuine source
// provenance.
//
// Idempotent: re-running it updates the password hash and leaves everything
// else alone, so it is safe to run twice.

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const email = (process.env.OWNER_EMAIL || "").trim();
const password = process.env.OWNER_PASSWORD || "";
const companyName = (process.env.OWNER_COMPANY_NAME || "").trim();

if (!email) throw new Error("OWNER_EMAIL is required.");
if (password.length < 16) {
  // Matches the minimum the bootstrap policy enforces, so this path cannot be
  // used to plant a weaker credential than the app would otherwise accept.
  throw new Error("OWNER_PASSWORD must be at least 16 characters.");
}
if (!companyName) throw new Error("OWNER_COMPANY_NAME is required.");

const prisma = new PrismaClient();

try {
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "ADMIN" },
    create: { email, passwordHash, role: "ADMIN", name: "Owner" },
  });

  const company = await prisma.company.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      name: companyName,
      legalName: companyName,
      setupCompletedAt: new Date(),
    },
  });

  // Counts prove the database is migrated and genuinely empty of evidence, so
  // the owner's uploads start from a known baseline rather than a guess.
  const [projects, experts, tenders, users] = await Promise.all([
    prisma.project.count(),
    prisma.expert.count(),
    prisma.tender.count(),
    prisma.user.count(),
  ]);

  console.log("Owner provisioned.");
  console.log(`  user id:     ${user.id}`);
  console.log(`  role:        ${user.role}`);
  console.log(`  company id:  ${company.id}`);
  console.log(`  company:     ${company.name}`);
  console.log("Vault baseline on this database:");
  console.log(`  users:    ${users}`);
  console.log(`  projects: ${projects}`);
  console.log(`  experts:  ${experts}`);
  console.log(`  tenders:  ${tenders}`);
} finally {
  await prisma.$disconnect();
}

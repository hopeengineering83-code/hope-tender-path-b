import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const PRIMARY_TENDER_ID = "11111111-1111-4111-8111-111111111111";
const SECONDARY_TENDER_ID = "22222222-2222-4222-8222-222222222222";

if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
  throw new Error("E2E seed is disabled in production");
}
if (process.env.E2E_SEED_ALLOWED !== "true") {
  throw new Error("Set E2E_SEED_ALLOWED=true only for an isolated test database");
}

const primaryEmail = String(process.env.E2E_TEST_EMAIL ?? "").trim().toLowerCase();
const primaryPassword = String(process.env.E2E_TEST_PASSWORD ?? "");
const secondaryEmail = String(process.env.E2E_SECOND_EMAIL ?? "").trim().toLowerCase();
const secondaryPassword = String(process.env.E2E_SECOND_PASSWORD ?? "");

for (const [name, value] of [
  ["E2E_TEST_EMAIL", primaryEmail],
  ["E2E_TEST_PASSWORD", primaryPassword],
  ["E2E_SECOND_EMAIL", secondaryEmail],
  ["E2E_SECOND_PASSWORD", secondaryPassword],
]) {
  if (!value) throw new Error(`${name} is required`);
}
if (primaryPassword.length < 16 || secondaryPassword.length < 16) {
  throw new Error("E2E passwords must contain at least 16 characters");
}
if (primaryEmail === secondaryEmail) throw new Error("E2E users must have different email addresses");

const prisma = new PrismaClient();

async function upsertFixtureUser({ email, password, name, companyName, role = "ADMIN" }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, role },
    create: { email, name, passwordHash, role },
    select: { id: true },
  });
  await prisma.company.upsert({
    where: { userId: user.id },
    update: { name: companyName, legalName: companyName, setupCompletedAt: new Date() },
    create: { userId: user.id, name: companyName, legalName: companyName, setupCompletedAt: new Date() },
  });
  return user;
}

try {
  const primary = await upsertFixtureUser({
    email: primaryEmail,
    password: primaryPassword,
    name: "E2E Primary User",
    companyName: "E2E Primary Company",
  });
  const secondary = await upsertFixtureUser({
    email: secondaryEmail,
    password: secondaryPassword,
    name: "E2E Secondary User",
    companyName: "E2E Secondary Company",
  });

  await prisma.tender.upsert({
    where: { id: PRIMARY_TENDER_ID },
    update: { title: "Primary Owner Fixture", userId: primary.id, status: "DRAFT", stage: "TENDER_INTAKE" },
    create: { id: PRIMARY_TENDER_ID, title: "Primary Owner Fixture", userId: primary.id },
  });
  await prisma.tender.upsert({
    where: { id: SECONDARY_TENDER_ID },
    update: { title: "Secondary Owner Private Tender", userId: secondary.id, status: "DRAFT", stage: "TENDER_INTAKE" },
    create: { id: SECONDARY_TENDER_ID, title: "Secondary Owner Private Tender", userId: secondary.id },
  });

  console.log(JSON.stringify({
    seeded: true,
    primaryTenderId: PRIMARY_TENDER_ID,
    secondaryTenderId: SECONDARY_TENDER_ID,
  }));
} finally {
  await prisma.$disconnect();
}

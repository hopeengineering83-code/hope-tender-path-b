import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_E2E_SEED_IN_PRODUCTION !== "true") {
  throw new Error("E2E seed is disabled in production");
}

const required = ["E2E_TEST_EMAIL", "E2E_TEST_PASSWORD", "E2E_SECOND_EMAIL", "E2E_SECOND_PASSWORD"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const ownerEmail = process.env.E2E_TEST_EMAIL;
const ownerPassword = process.env.E2E_TEST_PASSWORD;
const secondEmail = process.env.E2E_SECOND_EMAIL;
const secondPassword = process.env.E2E_SECOND_PASSWORD;

if (ownerPassword.length < 16 || secondPassword.length < 16) {
  throw new Error("E2E passwords must be at least 16 characters");
}

const isolationTenderId = "11111111-1111-4111-8111-111111111111";
const isolationFileId = "22222222-2222-4222-8222-222222222222";
const isolationDocumentId = "33333333-3333-4333-8333-333333333333";
const prisma = new PrismaClient();

async function seedUser(email, password, role, name, companyName) {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role, name },
    create: { email, passwordHash, role, name },
  });
  await prisma.company.upsert({
    where: { userId: user.id },
    update: { name: companyName, legalName: companyName, setupCompletedAt: new Date() },
    create: { userId: user.id, name: companyName, legalName: companyName, setupCompletedAt: new Date() },
  });
  return user;
}

try {
  const owner = await seedUser(ownerEmail, ownerPassword, "ADMIN", "E2E Owner", "E2E Owner Company");
  const secondUser = await seedUser(secondEmail, secondPassword, "PROPOSAL_MANAGER", "E2E Second User", "E2E Second Company");

  await prisma.tender.upsert({
    where: { id: isolationTenderId },
    update: { title: "E2E Owner Isolation Tender", reference: "E2E-ISOLATION-OWNER", userId: owner.id },
    create: { id: isolationTenderId, title: "E2E Owner Isolation Tender", reference: "E2E-ISOLATION-OWNER", userId: owner.id },
  });

  await prisma.tenderFile.upsert({
    where: { id: isolationFileId },
    update: { tenderId: isolationTenderId, fileName: "owner-source.txt", originalFileName: "owner-source.txt", mimeType: "text/plain", size: 34, extractedText: "Owner-only tender source evidence.", extractionMethod: "text", extractionScore: 100 },
    create: { id: isolationFileId, tenderId: isolationTenderId, fileName: "owner-source.txt", originalFileName: "owner-source.txt", mimeType: "text/plain", size: 34, extractedText: "Owner-only tender source evidence.", extractionMethod: "text", extractionScore: 100 },
  });

  await prisma.generatedDocument.upsert({
    where: { id: isolationDocumentId },
    update: { tenderId: isolationTenderId, name: "E2E Owner Technical Proposal", documentType: "TECHNICAL_PROPOSAL", generationStatus: "GENERATED", validationStatus: "VALID" },
    create: { id: isolationDocumentId, tenderId: isolationTenderId, name: "E2E Owner Technical Proposal", documentType: "TECHNICAL_PROPOSAL", generationStatus: "GENERATED", validationStatus: "VALID" },
  });

  console.log(JSON.stringify({ seeded: true, ownerUserId: owner.id, secondUserId: secondUser.id, isolationTenderId, isolationFileId, isolationDocumentId }));
} finally {
  await prisma.$disconnect();
}

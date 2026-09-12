import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
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

const PRIMARY_TENDER_ID = "11111111-1111-4111-8111-111111111111";
const SECONDARY_TENDER_ID = "22222222-2222-4222-8222-222222222222";
const SECONDARY_DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const SECONDARY_FILE_ID = "44444444-4444-4444-8444-444444444444";

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

  await prisma.tender.upsert({
    where: { id: PRIMARY_TENDER_ID },
    update: { title: "Primary Owner Fixture", userId: primaryUser.id },
    create: {
      id: PRIMARY_TENDER_ID,
      userId: primaryUser.id,
      title: "Primary Owner Fixture",
    },
  });

  await prisma.tender.upsert({
    where: { id: SECONDARY_TENDER_ID },
    update: { title: "Secondary Owner Private Tender", userId: secondaryUser.id },
    create: {
      id: SECONDARY_TENDER_ID,
      userId: secondaryUser.id,
      title: "Secondary Owner Private Tender",
    },
  });
  const baselineTenders = [
    { id: "45a2d090-af4c-4815-9736-c8b5bbbdf89d", title: "Baseline Draft Tender", status: "DRAFT", stage: "INTAKE" },
    { id: "2362d615-c78b-4b01-b420-515c8679d0c2", title: "Baseline Compliance Tender", status: "COMPLIANCE_REVIEW", stage: "COMPLIANCE" },
    { id: "5cf8ae9b-af8a-4b8d-bcd0-dfaf75b6037c", title: "Baseline Approved Tender", status: "APPROVED", stage: "APPROVAL" },
  ];
  for (const fixture of baselineTenders) {
    await prisma.tender.upsert({
      where: { id: fixture.id },
      update: { userId: primaryUser.id, title: fixture.title, status: fixture.status, stage: fixture.stage },
      create: { id: fixture.id, userId: primaryUser.id, title: fixture.title, status: fixture.status, stage: fixture.stage },
    });
  }


  // Real secondary-tenant rows let the browser suite prove supplied-ID
  // isolation instead of merely exercising random/nonexistent identifiers.
  await prisma.generatedDocument.upsert({
    where: { id: SECONDARY_DOCUMENT_ID },
    update: {
      tenderId: SECONDARY_TENDER_ID,
      name: "Secondary Private Document",
      documentType: "TECHNICAL_PROPOSAL",
      format: "DOCX",
      exactFileName: "Secondary-Private-Document.docx",
      generationStatus: "PLANNED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      fileContent: null,
      storagePath: null,
    },
    create: {
      id: SECONDARY_DOCUMENT_ID,
      tenderId: SECONDARY_TENDER_ID,
      name: "Secondary Private Document",
      documentType: "TECHNICAL_PROPOSAL",
      format: "DOCX",
      exactFileName: "Secondary-Private-Document.docx",
      generationStatus: "PLANNED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
    },
  });

  const privateBytes = Buffer.from("secondary-private-source-fixture", "utf8");
  const privateSha256 = createHash("sha256").update(privateBytes).digest("hex");
  await prisma.tenderFile.upsert({
    where: { id: SECONDARY_FILE_ID },
    update: {
      tenderId: SECONDARY_TENDER_ID,
      fileName: "secondary-private-source.txt",
      originalFileName: "secondary-private-source.txt",
      mimeType: "text/plain",
      size: privateBytes.length,
      fileContent: privateBytes.toString("base64"),
      storagePath: "",
      classification: "SOURCE",
      extractedText: privateBytes.toString("utf8"),
      deletionStatus: "ACTIVE",
      sha256: privateSha256,
      byteSize: privateBytes.length,
      contentSha256: privateSha256,
      contentByteLength: privateBytes.length,
      contentMimeType: "text/plain",
      detectedFormat: "TEXT",
      integrityStatus: "VERIFIED",
      integrityVerifiedAt: new Date(),
      integrityFailureCode: null,
      deletedAt: null,
    },
    create: {
      id: SECONDARY_FILE_ID,
      tenderId: SECONDARY_TENDER_ID,
      fileName: "secondary-private-source.txt",
      originalFileName: "secondary-private-source.txt",
      mimeType: "text/plain",
      size: privateBytes.length,
      fileContent: privateBytes.toString("base64"),
      classification: "SOURCE",
      extractedText: privateBytes.toString("utf8"),
      sha256: privateSha256,
      byteSize: privateBytes.length,
      contentSha256: privateSha256,
      contentByteLength: privateBytes.length,
      contentMimeType: "text/plain",
      detectedFormat: "TEXT",
      integrityStatus: "VERIFIED",
      integrityVerifiedAt: new Date(),
    },
  });

  console.log(JSON.stringify({
    seeded: true,
    primaryUserId: primaryUser.id,
    secondaryUserId: secondaryUser.id,
    primaryEmail,
    secondaryEmail,
    secondaryDocumentId: SECONDARY_DOCUMENT_ID,
    secondaryFileId: SECONDARY_FILE_ID,
  }));
} finally {
  await prisma.$disconnect();
}

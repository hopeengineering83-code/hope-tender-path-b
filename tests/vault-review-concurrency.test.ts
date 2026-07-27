import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

const ROUTES = [
  "app/api/company/legal-records/[id]/route.ts",
  "app/api/company/financial-records/[id]/route.ts",
  "app/api/company/compliance-records/[id]/route.ts",
] as const;

describe("vault review routes use revision-bound optimistic concurrency", () => {
  for (const route of ROUTES) {
    it(`${route} binds the write to the record and source revision`, () => {
      const source = readFileSync(resolve(route), "utf8");
      assert.match(source, /updatedAt:\s*record\.updatedAt/);
      assert.match(source, /sourceDocumentId:\s*record\.sourceDocumentId/);
      assert.match(source, /sourceDocument:\s*\{\s*is:\s*\{/s);
      assert.match(source, /extractedText:\s*ownedSource!\.extractedText/);
      assert.match(source, /contentSha256:\s*ownedSource!\.contentSha256/);
      assert.match(source, /contentByteLength:\s*ownedSource!\.contentByteLength/);
      assert.match(source, /integrityStatus:\s*ownedSource!\.integrityStatus/);
      assert.match(source, /metadata:\s*ownedSource!\.metadata/);
    });
  }
});

dbDescribe("vault review write predicates reject stale record and source revisions", () => {
  it("rejects stale legal, financial and compliance review writes", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        email: `vault-review-concurrency-${suffix}@example.test`,
        passwordHash: "$2a$10$synthetic-only",
        role: "ADMIN",
        name: "Vault review concurrency test",
      },
    });

    try {
      const company = await prisma.company.create({
        data: { userId: user.id, name: `Concurrency ${suffix}` },
      });
      const sourceDocument = await prisma.companyDocument.create({
        data: {
          companyId: company.id,
          fileName: "source.pdf",
          originalFileName: "source.pdf",
          mimeType: "application/pdf",
          size: 128,
          storagePath: `tests/${suffix}/source.pdf`,
          extractedText: "Legal financial and compliance evidence ".repeat(8),
          contentSha256: "a".repeat(64),
          contentByteLength: 128,
          contentMimeType: "application/pdf",
          detectedFormat: "PDF",
          integrityStatus: "VERIFIED",
          metadata: JSON.stringify({ extractionRevision: 1 }),
        },
      });

      const legal = await prisma.legalRecord.create({
        data: {
          companyId: company.id,
          recordType: "LICENSE",
          title: "Consultancy license",
          sourceDocumentId: sourceDocument.id,
        },
        include: { sourceDocument: true },
      });
      const financial = await prisma.financialRecord.create({
        data: {
          companyId: company.id,
          fiscalYear: 2025,
          recordType: "AUDITED_STATEMENT",
          sourceDocumentId: sourceDocument.id,
        },
        include: { sourceDocument: true },
      });
      const compliance = await prisma.companyComplianceRecord.create({
        data: {
          companyId: company.id,
          complianceType: "TAX_CLEARANCE",
          title: "Tax clearance",
          sourceDocumentId: sourceDocument.id,
        },
        include: { sourceDocument: true },
      });

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      await prisma.companyDocument.update({
        where: { id: sourceDocument.id },
        data: {
          extractedText: "Changed source evidence ".repeat(10),
          metadata: JSON.stringify({ extractionRevision: 2 }),
        },
      });

      const sourceGuard = {
        id: sourceDocument.id,
        companyId: company.id,
        extractedText: sourceDocument.extractedText,
        contentSha256: sourceDocument.contentSha256,
        contentByteLength: sourceDocument.contentByteLength,
        integrityStatus: sourceDocument.integrityStatus,
        metadata: sourceDocument.metadata,
      };

      const staleLegalSource = await prisma.legalRecord.updateMany({
        where: {
          id: legal.id,
          companyId: company.id,
          updatedAt: legal.updatedAt,
          sourceDocumentId: legal.sourceDocumentId,
          sourceDocument: { is: sourceGuard },
        },
        data: { trustLevel: "REVIEWED" },
      });
      const staleFinancialSource = await prisma.financialRecord.updateMany({
        where: {
          id: financial.id,
          companyId: company.id,
          updatedAt: financial.updatedAt,
          sourceDocumentId: financial.sourceDocumentId,
          sourceDocument: { is: sourceGuard },
        },
        data: { trustLevel: "REVIEWED" },
      });
      const staleComplianceSource = await prisma.companyComplianceRecord.updateMany({
        where: {
          id: compliance.id,
          companyId: company.id,
          updatedAt: compliance.updatedAt,
          sourceDocumentId: compliance.sourceDocumentId,
          sourceDocument: { is: sourceGuard },
        },
        data: { trustLevel: "REVIEWED" },
      });

      assert.equal(staleLegalSource.count, 0);
      assert.equal(staleFinancialSource.count, 0);
      assert.equal(staleComplianceSource.count, 0);

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      await Promise.all([
        prisma.legalRecord.update({ where: { id: legal.id }, data: { title: "Changed license" } }),
        prisma.financialRecord.update({ where: { id: financial.id }, data: { notes: "Changed financial record" } }),
        prisma.companyComplianceRecord.update({ where: { id: compliance.id }, data: { title: "Changed clearance" } }),
      ]);

      const staleLegalRecord = await prisma.legalRecord.updateMany({
        where: { id: legal.id, companyId: company.id, updatedAt: legal.updatedAt },
        data: { trustLevel: "REVIEWED" },
      });
      const staleFinancialRecord = await prisma.financialRecord.updateMany({
        where: { id: financial.id, companyId: company.id, updatedAt: financial.updatedAt },
        data: { trustLevel: "REVIEWED" },
      });
      const staleComplianceRecord = await prisma.companyComplianceRecord.updateMany({
        where: { id: compliance.id, companyId: company.id, updatedAt: compliance.updatedAt },
        data: { trustLevel: "REVIEWED" },
      });

      assert.equal(staleLegalRecord.count, 0);
      assert.equal(staleFinancialRecord.count, 0);
      assert.equal(staleComplianceRecord.count, 0);
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      await prisma.$disconnect();
    }
  });
});

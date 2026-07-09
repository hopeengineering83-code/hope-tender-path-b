import { test } from "node:test";
import assert from "node:assert";
import { PrismaClient } from "@prisma/client";
import {
  TenderEvidenceSelector,
  getTenderEvidenceSelection,
  getTenderEvidenceSelectionById,
  isTenderEvidenceForbidden,
} from "../lib/engine/tender-evidence-selector";

// ─── PrismaClient lifecycle helper ──────────────────────────────────────────
//
// REVIEW-BLOCKER FIX #4:
// Every PrismaClient created in tests MUST be disconnected to avoid
// connection leaks. This helper creates a PrismaClient and registers a
// test-level cleanup hook that calls `$disconnect()` after all tests in
// the scope complete.
//
// Usage:
//   const { prisma } = withPrismaCleanup(t);
//   // ... test code ...
//   // $disconnect() is called automatically by t.after()

function withPrismaCleanup(t: import("node:test").TestContext): { prisma: PrismaClient } {
  const prisma = new PrismaClient();
  t.after(async () => {
    await prisma.$disconnect();
  });
  return { prisma };
}

// ─── 1. Pure-logic tests (findBestExpert / findBestProject) ─────────────────
//
// These tests verify the scoring logic without hitting the database.
// The PrismaClient is created only to construct the TenderEvidenceSelector
// (which stores it as a private field) — no DB calls are made.

test("TenderEvidenceSelector logic - finding best expert", async (t) => {
  const { prisma } = withPrismaCleanup(t);
  const selector = (new TenderEvidenceSelector(prisma)) as any;

  const experts = [
    { id: "1", fullName: "John Doe", title: "Civil Engineer", profile: "Expert in bridges", disciplines: "['Civil']", sectors: "['Infrastructure']", yearsExperience: 5, isActive: true },
    { id: "2", fullName: "Jane Smith", title: "Architect", profile: "Expert in hospitals", disciplines: "['Architecture']", sectors: "['Healthcare']", yearsExperience: 15, isActive: true }
  ];

  const best = selector.findBestExpert("Hospital architecture design", experts, "Healthcare sector tender");
  assert.strictEqual(best.fullName, "Jane Smith");
  assert.ok(best.relevanceScore > 0.3);
});

test("TenderEvidenceSelector logic - finding best project", async (t) => {
  const { prisma } = withPrismaCleanup(t);
  const selector = (new TenderEvidenceSelector(prisma)) as any;

  const projects = [
    { id: "1", name: "Bridge over Nile", summary: "Large infrastructure project", sector: "Infrastructure", serviceAreas: "['Construction']", contractValue: 2000000, endDate: new Date(), evidences: [] },
    { id: "2", name: "City Hospital", summary: "Healthcare facility design", sector: "Healthcare", serviceAreas: "['Design']", contractValue: 500000, endDate: new Date(), evidences: [] }
  ];

  const best = selector.findBestProject("Large scale infrastructure construction", projects, "Infrastructure project in Egypt");
  assert.strictEqual(best.projectName, "Bridge over Nile");
  assert.ok(best.relevanceScore > 0.3);
});

// ─── 2. findBestCompliance score-0 rejection (review-blocker fix #3) ────────

test("findBestCompliance returns null when all candidates have score 0", async (t) => {
  const { prisma } = withPrismaCleanup(t);
  const selector = (new TenderEvidenceSelector(prisma)) as any;

  // Irrelevant compliance records — none match the query keywords
  const records = [
    { id: "c1", title: "ISO 9001 Quality Certificate", complianceType: "QUALITY", status: "ACTIVE" },
    { id: "c2", title: "ISO 14001 Environmental Certificate", complianceType: "ENVIRONMENTAL", status: "ACTIVE" },
  ];

  // Query about something completely unrelated
  const result = selector.findBestCompliance("Cybersecurity penetration test report", records);
  assert.strictEqual(result, null, "must return null when no candidate has a positive score");
});

test("findBestCompliance returns the matching record when score > 0", async (t) => {
  const { prisma } = withPrismaCleanup(t);
  const selector = (new TenderEvidenceSelector(prisma)) as any;

  const records = [
    { id: "c1", title: "ISO 9001 Quality Certificate", complianceType: "QUALITY", status: "ACTIVE" },
    { id: "c2", title: "ISO 27001 Information Security Certificate", complianceType: "SECURITY", status: "ACTIVE" },
  ];

  // Query matches "security" in the title/complianceType of c2
  const result = selector.findBestCompliance("Information Security Certificate", records);
  assert.ok(result, "must return a match when a candidate has score > 0");
  assert.strictEqual(result.recordId, "c2");
});

test("findBestCompliance does not return irrelevant records for vague queries", async (t) => {
  const { prisma } = withPrismaCleanup(t);
  const selector = (new TenderEvidenceSelector(prisma)) as any;

  const records = [
    { id: "c1", title: "Business Licence", complianceType: "LICENCE", status: "ACTIVE" },
    { id: "c2", title: "Tax Clearance Certificate", complianceType: "TAX", status: "ACTIVE" },
  ];

  // Vague query that doesn't match any title or type
  const result = selector.findBestCompliance("Construction methodology", records);
  assert.strictEqual(result, null, "must not return irrelevant records");
});

// ─── 3. Authorization tests (review-blocker fix #1) ─────────────────────────
//
// These tests verify that selectEvidence() rejects requests when:
//   - userId is empty
//   - company doesn't exist
//   - company belongs to a different user
//   - tender doesn't exist
//   - tender belongs to a different user
//
// The tests use a mock PrismaClient that returns canned responses —
// no real DB connection is needed.

type MockPrisma = {
  company: { findUnique: (args: any) => Promise<any> };
  tender: { findUnique: (args: any) => Promise<any> };
  expert: { findMany: () => Promise<any[]> };
  project: { findMany: () => Promise<any[]> };
  legalRecord: { findMany: () => Promise<any[]> };
  financialRecord: { findMany: () => Promise<any[]> };
  companyComplianceRecord: { findMany: () => Promise<any[]> };
  companyAsset: { findMany: () => Promise<any[]> };
  $disconnect: () => Promise<void>;
};

function makeMockPrisma(overrides: Partial<MockPrisma> = {}): MockPrisma {
  return {
    company: { findUnique: async () => null },
    tender: { findUnique: async () => null },
    expert: { findMany: async () => [] },
    project: { findMany: async () => [] },
    legalRecord: { findMany: async () => [] },
    financialRecord: { findMany: async () => [] },
    companyComplianceRecord: { findMany: async () => [] },
    companyAsset: { findMany: async () => [] },
    $disconnect: async () => {},
    ...overrides,
  };
}

test("selectEvidence rejects when userId is empty", async (t) => {
  const mock = makeMockPrisma();
  const selector = new TenderEvidenceSelector(mock as any);
  const result = await selector.selectEvidence("tender-1", "company-1", "");
  assert.ok(isTenderEvidenceForbidden(result), "must return forbidden result");
  assert.strictEqual((result as any).code, "USER_NOT_AUTHENTICATED");
});

test("selectEvidence rejects when company not found", async (t) => {
  const mock = makeMockPrisma({
    company: { findUnique: async () => null },
  });
  const selector = new TenderEvidenceSelector(mock as any);
  const result = await selector.selectEvidence("tender-1", "missing-company", "user-1");
  assert.ok(isTenderEvidenceForbidden(result));
  assert.strictEqual((result as any).code, "COMPANY_NOT_FOUND");
});

test("selectEvidence rejects when company belongs to a different user (cross-tenant)", async (t) => {
  const mock = makeMockPrisma({
    company: { findUnique: async () => ({ id: "company-1", userId: "user-2", name: "Other Co" }) },
  });
  const selector = new TenderEvidenceSelector(mock as any);
  const result = await selector.selectEvidence("tender-1", "company-1", "user-1");
  assert.ok(isTenderEvidenceForbidden(result));
  assert.strictEqual((result as any).code, "COMPANY_NOT_OWNED_BY_USER");
});

test("selectEvidence rejects when tender not found", async (t) => {
  const mock = makeMockPrisma({
    company: { findUnique: async () => ({ id: "company-1", userId: "user-1", name: "My Co" }) },
    tender: { findUnique: async () => null },
  });
  const selector = new TenderEvidenceSelector(mock as any);
  const result = await selector.selectEvidence("missing-tender", "company-1", "user-1");
  assert.ok(isTenderEvidenceForbidden(result));
  assert.strictEqual((result as any).code, "TENDER_NOT_FOUND");
});

test("selectEvidence rejects when tender belongs to a different user (cross-tenant)", async (t) => {
  const mock = makeMockPrisma({
    company: { findUnique: async () => ({ id: "company-1", userId: "user-1", name: "My Co" }) },
    tender: { findUnique: async () => ({ id: "tender-1", userId: "user-2", title: "Other Tender", requirements: [] }) },
  });
  const selector = new TenderEvidenceSelector(mock as any);
  const result = await selector.selectEvidence("tender-1", "company-1", "user-1");
  assert.ok(isTenderEvidenceForbidden(result));
  assert.strictEqual((result as any).code, "TENDER_NOT_OWNED_BY_USER");
});

test("selectEvidence succeeds when user owns both company and tender", async (t) => {
  const mock = makeMockPrisma({
    company: { findUnique: async () => ({ id: "company-1", userId: "user-1", name: "My Co" }) },
    tender: { findUnique: async () => ({ id: "tender-1", userId: "user-1", title: "My Tender", description: null, category: "General", country: null, requirements: [] }) },
  });
  const selector = new TenderEvidenceSelector(mock as any);
  const result = await selector.selectEvidence("tender-1", "company-1", "user-1");
  assert.ok(!isTenderEvidenceForbidden(result), "must NOT return forbidden when user owns both");
  assert.ok(result !== null);
  assert.strictEqual((result as any).tenderId, "tender-1");
  assert.strictEqual((result as any).companyId, "company-1");
});

// ─── 4. getTenderEvidenceSelectionById cross-tenant denial (fix #2) ─────────

test("getTenderEvidenceSelectionById returns null when user has no company", async (t) => {
  const mock = makeMockPrisma({
    company: { findUnique: async () => null },
  });
  // getTenderEvidenceSelectionById uses prisma.company.findFirst({ where: { userId } })
  const mockWithFindFirst = {
    ...mock,
    company: { findFirst: async () => null, findUnique: mock.company.findUnique },
  };
  const result = await getTenderEvidenceSelectionById(mockWithFindFirst as any, "tender-1", "user-1");
  assert.strictEqual(result, null, "must return null when user has no company");
});

test("getTenderEvidenceSelectionById rejects when tender belongs to different user", async (t) => {
  const mock = {
    company: {
      findFirst: async () => ({ id: "company-1", userId: "user-1", name: "My Co" }),
      findUnique: async () => ({ id: "company-1", userId: "user-1", name: "My Co" }),
    },
    tender: {
      findUnique: async () => ({ id: "tender-1", userId: "user-2", title: "Other User's Tender", requirements: [] }),
    },
    expert: { findMany: async () => [] },
    project: { findMany: async () => [] },
    legalRecord: { findMany: async () => [] },
    financialRecord: { findMany: async () => [] },
    companyComplianceRecord: { findMany: async () => [] },
    companyAsset: { findMany: async () => [] },
    $disconnect: async () => {},
  };
  const result = await getTenderEvidenceSelectionById(mock as any, "tender-1", "user-1");
  assert.ok(isTenderEvidenceForbidden(result), "must reject cross-tenant access");
  assert.strictEqual((result as any).code, "TENDER_NOT_OWNED_BY_USER");
});

test("getTenderEvidenceSelectionById rejects when userId is empty", async () => {
  const mock = makeMockPrisma();
  const result = await getTenderEvidenceSelectionById(mock as any, "tender-1", "");
  assert.ok(isTenderEvidenceForbidden(result));
  assert.strictEqual((result as any).code, "USER_NOT_AUTHENTICATED");
});

test("getTenderEvidenceSelectionById succeeds when user owns tender", async (t) => {
  const mock = {
    company: {
      findFirst: async () => ({ id: "company-1", userId: "user-1", name: "My Co" }),
      findUnique: async () => ({ id: "company-1", userId: "user-1", name: "My Co" }),
    },
    tender: {
      findUnique: async () => ({ id: "tender-1", userId: "user-1", title: "My Tender", description: null, category: "General", country: null, requirements: [] }),
    },
    expert: { findMany: async () => [] },
    project: { findMany: async () => [] },
    legalRecord: { findMany: async () => [] },
    financialRecord: { findMany: async () => [] },
    companyComplianceRecord: { findMany: async () => [] },
    companyAsset: { findMany: async () => [] },
    $disconnect: async () => {},
  };
  const result = await getTenderEvidenceSelectionById(mock as any, "tender-1", "user-1");
  assert.ok(!isTenderEvidenceForbidden(result), "must NOT reject when user owns tender");
  assert.ok(result !== null);
  assert.strictEqual((result as any).tenderId, "tender-1");
});

// ─── 5. getTenderEvidenceSelection wrapper test ─────────────────────────────

test("getTenderEvidenceSelection passes userId to selector and returns forbidden on auth failure", async () => {
  const mock = makeMockPrisma({
    company: { findUnique: async () => ({ id: "company-1", userId: "user-2", name: "Other Co" }) },
  });
  const result = await getTenderEvidenceSelection(mock as any, "tender-1", "company-1", "user-1");
  assert.ok(isTenderEvidenceForbidden(result));
  assert.strictEqual((result as any).code, "COMPANY_NOT_OWNED_BY_USER");
});

// ─── 6. isTenderEvidenceForbidden helper test ───────────────────────────────

test("isTenderEvidenceForbidden identifies forbidden results", () => {
  assert.ok(isTenderEvidenceForbidden({ forbidden: true, reason: "test", code: "TENDER_NOT_FOUND" }));
  assert.ok(!isTenderEvidenceForbidden(null));
  assert.ok(!isTenderEvidenceForbidden({ tenderId: "x", companyId: "y" } as any));
});

// The live vault reported "4 documents / 4 extracted" beside "0 verified
// experts (28 total)", "0 verified projects (112 total)" and "0 verified
// support". Every automatic reconciliation path was already in place and the
// zero-bureaucracy suite passed, because that suite seeds byte-verified
// documents.
//
// The missing precondition is byte integrity. CompanyDocument.integrityStatus
// defaults to "UNKNOWN" and the source remapper accepts VERIFIED documents
// only, so a vault whose documents were persisted before integrity was
// computed has no eligible evidence source at all. Extraction still shows
// green — extraction and byte integrity are independent — so the page looks
// healthy while nothing can possibly bind.
//
// These tests pin the whole shape of that bug: reproduce it, prove the
// automatic reconciliation heals it with no human action, and prove the heal
// is honest — bytes that cannot be proven stay blocked rather than being
// waved through.

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN = process.env.RUN_DB_INTEGRATION === "true";

const EXPERTS = 28;
const PROJECTS = 112;

const expertNames = Array.from({ length: EXPERTS }, (_, i) => `Dawit Bekele ${String(i + 1).padStart(2, "0")}`);
const projectNames = Array.from({ length: PROJECTS }, (_, i) => `Rural Water Supply Scheme Phase ${i + 1}`);

// Real CV bundles print the surname first and carry honorifics/postnominals;
// the structured record holds the normalised name. Both must bind.
const cvText = `CURRICULUM VITAE BUNDLE\n\n${expertNames
  .map((name) => {
    const parts = name.split(" ");
    const given = parts[0];
    const surname = parts[1];
    const suffix = parts[2];
    return `Name of Key Expert: ${surname.toUpperCase()}, ${given} ${suffix} (MSc)\nPosition: Senior Water Resources Engineer\nDiscipline: Water Supply and Sanitation`;
  })
  .join("\n\n")}`;

const projectsText = `PROJECT REFERENCES\n\n${projectNames
  .map((name, i) => `Project Name: ${name}\nClient: Regional Water Bureau\nRole: Lead Consultant\nYear: ${2010 + (i % 15)}`)
  .join("\n\n")}`;

let userId: string | null = null;
let companyId: string | null = null;

async function db() {
  const { prisma } = await import("../lib/prisma");
  return prisma;
}

/** Seeds the live vault's shape: extracted documents, integrity never computed. */
async function seedLegacyVault(documents: Array<{ name: string; text: string; category: string; withBytes: boolean }>) {
  const prisma = await db();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      email: `legacy-vault-${stamp}@test.local`,
      name: "legacy vault",
      passwordHash: "unused",
      role: "PROPOSAL_MANAGER",
    },
  });
  userId = user.id;
  const company = await prisma.company.create({
    data: { userId: user.id, name: `Legacy Vault Consultancy ${stamp}` },
  });
  companyId = company.id;

  for (const doc of documents) {
    await prisma.companyDocument.create({
      data: {
        companyId: company.id,
        fileName: doc.name,
        originalFileName: doc.name,
        category: doc.category,
        mimeType: "text/plain",
        size: Buffer.byteLength(doc.text),
        extractedText: doc.text,
        // The whole point: bytes may or may not be present, and integrity was
        // never established either way.
        fileContent: doc.withBytes ? Buffer.from(doc.text, "utf8").toString("base64") : null,
        integrityStatus: "UNKNOWN",
      },
    });
  }

  for (const fullName of expertNames) {
    await prisma.expert.create({ data: { companyId: company.id, fullName, trustLevel: "AI_DRAFT" } });
  }
  for (const name of projectNames) {
    await prisma.project.create({ data: { companyId: company.id, name, trustLevel: "AI_DRAFT" } });
  }
  return company.id;
}

async function cleanup() {
  if (!userId) return;
  const prisma = await db();
  const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
  if (company) {
    await prisma.expert.deleteMany({ where: { companyId: company.id } });
    await prisma.project.deleteMany({ where: { companyId: company.id } });
    await prisma.companyDocument.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
  await prisma.user.delete({ where: { id: userId } });
  userId = null;
  companyId = null;
}

async function verifiedCounts() {
  const prisma = await db();
  const [experts, projects, documents] = await Promise.all([
    prisma.expert.count({ where: { companyId: companyId!, trustLevel: "SOURCE_VERIFIED" } }),
    prisma.project.count({ where: { companyId: companyId!, trustLevel: "SOURCE_VERIFIED" } }),
    prisma.companyDocument.count({ where: { companyId: companyId!, integrityStatus: "VERIFIED" } }),
  ]);
  return { experts, projects, documents };
}

describe("Company Vault — documents extracted but never byte-verified", { skip: !RUN }, () => {
  after(cleanup);

  it("reconciles a legacy vault to source-verified with no human action", async () => {
    await seedLegacyVault([
      { name: "detailed-cvs.txt", text: cvText, category: "EXPERT_CV", withBytes: true },
      { name: "company-projects.txt", text: projectsText, category: "PROJECT_REFERENCE", withBytes: true },
    ]);

    const before = await verifiedCounts();
    assert.equal(before.documents, 0, "precondition: no document has established byte integrity");
    assert.equal(before.experts, 0, "precondition: the live symptom — 0 verified experts");
    assert.equal(before.projects, 0, "precondition: the live symptom — 0 verified projects");

    const { prepareCompanyVaultForEngine } = await import("../lib/engine/prepare-company-vault");
    const preflight = await prepareCompanyVaultForEngine(userId!);
    assert.ok(preflight, "the Engine preflight must resolve the owned vault");

    const after = await verifiedCounts();
    assert.equal(after.documents, 2, "both documents must establish byte integrity from their stored bytes");
    assert.equal(
      after.projects,
      PROJECTS,
      `every project named in the owned reference document must source-verify, got ${after.projects}/${PROJECTS}`,
    );
    assert.ok(
      after.experts > 0,
      `experts named in the owned CV bundle must source-verify, got ${after.experts}/${EXPERTS}`,
    );

    // Zero bureaucracy: nothing was promoted by a person.
    const prisma = await db();
    const humanReviewed = await prisma.expert.count({
      where: { companyId: companyId!, OR: [{ trustLevel: "REVIEWED" }, { reviewedBy: { not: null } }] },
    });
    assert.equal(humanReviewed, 0, "no human review may be manufactured to reach SOURCE_VERIFIED");
  });

  it("leaves a document blocked when its bytes cannot be proven", async () => {
    await cleanup();
    await seedLegacyVault([
      // Extracted text present, bytes gone: nothing to verify against.
      { name: "detailed-cvs.txt", text: cvText, category: "EXPERT_CV", withBytes: false },
      { name: "company-projects.txt", text: projectsText, category: "PROJECT_REFERENCE", withBytes: true },
    ]);

    const { prepareCompanyVaultForEngine } = await import("../lib/engine/prepare-company-vault");
    await prepareCompanyVaultForEngine(userId!);

    const prisma = await db();
    const cv = await prisma.companyDocument.findFirstOrThrow({
      where: { companyId: companyId!, originalFileName: "detailed-cvs.txt" },
      select: { integrityStatus: true, contentSha256: true },
    });
    assert.notEqual(cv.integrityStatus, "VERIFIED", "a document with no recoverable bytes must stay blocked");
    assert.equal(cv.contentSha256, null, "no hash may be invented for bytes that are not there");

    const after = await verifiedCounts();
    assert.equal(after.documents, 1, "only the document with real bytes may become VERIFIED");
    assert.equal(
      after.experts,
      0,
      "experts sourced only from the unprovable CV must stay blocked, not be waved through",
    );
    assert.equal(after.projects, PROJECTS, "the provable reference document must still reconcile its projects");
  });
});

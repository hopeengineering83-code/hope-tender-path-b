// The live vault: 28 experts, 114 projects, 6 staged source descriptors,
// DOCUMENTS 0, everything 0 source-verified, and a blocker telling the owner to
// "Upload the original files: Expert CVS.pdf, Projects Reference.pdf".
//
// The app had already read those files. A Legacy Data Import parses the source
// and stores its text on PlanBStaging.rawText, then creates the Expert and
// Project rows — but never creates a CompanyDocument. Every downstream consumer
// (the source remapper, automatic verification, and the import's own declared-
// source resolution) looks only at CompanyDocument, so the imported evidence was
// invisible and the owner was asked to re-supply what the app already held.
//
// Asking for it back is not a verification requirement, it is bureaucracy: the
// mandate is to generate proposals from the company evidence already supplied.
// These tests pin that staged import text becomes real owned evidence, that
// verification stays exactly as strict against it, and that a staging row with
// no usable text is still refused rather than turned into a fabricated source.

import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN = process.env.RUN_DB_INTEGRATION === "true";

const EXPERTS = 28;
const PROJECTS = 114;

const expertNames = Array.from({ length: EXPERTS }, (_, i) => `Dawit Bekele ${String(i + 1).padStart(2, "0")}`);
const projectNames = Array.from({ length: PROJECTS }, (_, i) => `Rural Water Supply Scheme Phase ${i + 1}`);

const cvText = `CURRICULUM VITAE BUNDLE\n\n${expertNames
  .map((name) => {
    const [given, surname, suffix] = name.split(" ");
    return `Name of Key Expert: ${surname.toUpperCase()}, ${given} ${suffix} (MSc)\nPosition: Senior Water Resources Engineer`;
  })
  .join("\n\n")}`;

const projectsText = `PROJECT REFERENCES\n\n${projectNames
  .map((name) => `Project Name: ${name}\nClient: Regional Water Bureau`)
  .join("\n\n")}`;

let userId: string | null = null;
let companyId: string | null = null;

async function db() {
  const { prisma } = await import("../lib/prisma");
  return prisma;
}

/** Seeds the live shape: staged legacy sources, zero CompanyDocuments. */
async function seedLegacyImport(staging: Array<{ name: string; text: string | null; category: string }>) {
  const prisma = await db();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      email: `legacy-import-${stamp}@test.local`,
      name: "legacy import",
      passwordHash: "unused",
      role: "PROPOSAL_MANAGER",
    },
  });
  userId = user.id;
  const company = await prisma.company.create({
    data: { userId: user.id, name: `Legacy Import Consultancy ${stamp}` },
  });
  companyId = company.id;

  for (const row of staging) {
    await prisma.planBStaging.create({
      data: {
        companyId: company.id,
        originalFileName: row.name,
        sourceCategory: row.category,
        normalizedCategory: row.category,
        rawText: row.text,
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
    await prisma.planBStaging.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
  await prisma.user.delete({ where: { id: userId } });
  userId = null;
  companyId = null;
}

describe("Company Vault — Legacy Data Import sources are usable evidence", { skip: !RUN }, () => {
  after(cleanup);

  it("verifies imported records against the import's own text, with no upload and no approval", async () => {
    await seedLegacyImport([
      { name: "Expert CVS.pdf", text: cvText, category: "EXPERT_CV" },
      { name: "Projects Reference.pdf", text: projectsText, category: "PROJECT_REFERENCE" },
    ]);

    const prisma = await db();
    assert.equal(
      await prisma.companyDocument.count({ where: { companyId: companyId! } }),
      0,
      "precondition: the live symptom — records imported, DOCUMENTS 0",
    );

    const { prepareCompanyVaultForEngine } = await import("../lib/engine/prepare-company-vault");
    const preflight = await prepareCompanyVaultForEngine(userId!);
    assert.ok(preflight, "the Engine preflight must resolve the owned vault");

    const documents = await prisma.companyDocument.findMany({
      where: { companyId: companyId! },
      select: { originalFileName: true, integrityStatus: true, contentSha256: true, extractedText: true },
    });
    assert.equal(documents.length, 2, "both staged sources must become owned vault documents");
    for (const doc of documents) {
      assert.equal(doc.integrityStatus, "VERIFIED", `${doc.originalFileName} must carry real byte integrity`);
      assert.ok(doc.contentSha256, "the stored bytes must be hashed");
      assert.ok((doc.extractedText ?? "").length > 0, "the imported text must be persisted as the document's text");
    }
    assert.deepEqual(
      documents.map((d) => d.originalFileName).sort(),
      ["Expert CVS.pdf.txt", "Projects Reference.pdf.txt"],
      "stored sources are named for what they hold — extracted text, not the original binary",
    );

    const verifiedProjects = await prisma.project.count({
      where: { companyId: companyId!, trustLevel: "SOURCE_VERIFIED" },
    });
    const verifiedExperts = await prisma.expert.count({
      where: { companyId: companyId!, trustLevel: "SOURCE_VERIFIED" },
    });
    assert.equal(
      verifiedProjects,
      PROJECTS,
      `every project named in the imported reference text must source-verify, got ${verifiedProjects}/${PROJECTS}`,
    );
    assert.ok(
      verifiedExperts > 0,
      `experts named in the imported CV text must source-verify, got ${verifiedExperts}/${EXPERTS}`,
    );

    // Zero bureaucracy: nothing was promoted by a person.
    const humanReviewed = await prisma.expert.count({
      where: { companyId: companyId!, OR: [{ trustLevel: "REVIEWED" }, { reviewedBy: { not: null } }] },
    });
    assert.equal(humanReviewed, 0, "no human review may be manufactured to reach SOURCE_VERIFIED");
  });

  it("is idempotent — re-running creates no duplicate documents", async () => {
    const prisma = await db();
    const before = await prisma.companyDocument.count({ where: { companyId: companyId! } });
    const { prepareCompanyVaultForEngine } = await import("../lib/engine/prepare-company-vault");
    await prepareCompanyVaultForEngine(userId!);
    const after = await prisma.companyDocument.count({ where: { companyId: companyId! } });
    assert.equal(after, before, "re-running reconciliation must not duplicate materialized sources");
  });

  it("refuses to invent a source from a staging row with no text", async () => {
    await cleanup();
    await seedLegacyImport([
      { name: "Expert CVS.pdf", text: null, category: "EXPERT_CV" },
      { name: "Projects Reference.pdf", text: projectsText, category: "PROJECT_REFERENCE" },
    ]);

    const { prepareCompanyVaultForEngine } = await import("../lib/engine/prepare-company-vault");
    await prepareCompanyVaultForEngine(userId!);

    const prisma = await db();
    const documents = await prisma.companyDocument.findMany({
      where: { companyId: companyId! },
      select: { originalFileName: true },
    });
    assert.deepEqual(
      documents.map((d) => d.originalFileName),
      ["Projects Reference.pdf.txt"],
      "a staging row carrying no text must not become a document — there is nothing to verify against",
    );
    assert.equal(
      await prisma.expert.count({ where: { companyId: companyId!, trustLevel: "SOURCE_VERIFIED" } }),
      0,
      "experts whose only source has no text must stay blocked, not be waved through",
    );
    assert.equal(
      await prisma.project.count({ where: { companyId: companyId!, trustLevel: "SOURCE_VERIFIED" } }),
      PROJECTS,
      "the source that does carry text must still verify its records",
    );
  });
});

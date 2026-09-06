/**
 * A three-document package is not a six-document package.
 *
 * Reproduced live on a tender with three GENERATED documents and three
 * SUPERSEDED earlier revisions of the same three. Asked at the same instant:
 *
 *   export-readiness      generatedDocumentsTotal: 6
 *   workflow-status       generatedDocumentsTotal: 6
 *   generation-readiness  generatedDocumentsTotal: 6
 *   readiness-score       generatedDocumentsTotal: 3
 *   lifecycle             generatedDocumentsTotal: 3
 *   authority-review      generatedDocumentsTotal: 3
 *   Export Hub card       "3 / 3 docs generated"
 *   the ZIP itself        three entries
 *
 * The three routes reading 6 all take it from
 * getFinalPackageReadinessModel's documents.generated, whose query had no
 * generationStatus filter. Every other surface has always excluded superseded
 * rows.
 *
 * The count is owner-facing: canonical-workflow-decision renders it as
 * "<generated>/<required> required documents generated", so this could read
 * "6/3".
 *
 * The same set feeds the ZIP manifest's last-resort per-key lookup, which
 * falls back to any document matching a planned key. With history included, a
 * superseded revision could be named as a planned file's source document when
 * no live row matched.
 *
 * Requires RUN_DB_INTEGRATION=true. Skips cleanly otherwise.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("final package counts exclude superseded revisions", () => {
  const { PrismaClient } = require("@prisma/client");
  const { randomUUID, createHash } = require("node:crypto");
  const { getFinalPackageReadinessModel } = require("../lib/engine/final-package-readiness-model");

  const prisma = new PrismaClient();
  let userId = "";
  let tenderId = "";

  const FILES = [
    { name: "Expression of Interest", file: "01-Expression-Of-Interest.docx", order: 1, type: "EXPRESSION_OF_INTEREST" },
    { name: "Company Profile", file: "02-Company-Profile.docx", order: 2, type: "COMPANY_PROFILE" },
    { name: "Capability Statement", file: "03-Capability-Statement.docx", order: 3, type: "CAPABILITY_STATEMENT" },
  ];

  before(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Package Owner",
        email: `package-owner+${Date.now()}@example.test`,
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    userId = user.id;
    await prisma.company.create({ data: { userId, name: "Package Works" } });
    const tender = await prisma.tender.create({
      data: { id: randomUUID(), userId, title: "Package RFP", status: "ACTIVE" },
    });
    tenderId = tender.id;

    for (const spec of FILES) {
      // The superseded earlier revision, written first so it also sorts first
      // by createdAt within the same exactOrder.
      const oldBytes = Buffer.from(`old revision of ${spec.file}`.repeat(4));
      await prisma.generatedDocument.create({
        data: {
          tenderId,
          name: spec.name,
          exactFileName: spec.file,
          exactOrder: spec.order,
          documentType: spec.type,
          format: "DOCX",
          generationStatus: "SUPERSEDED",
          validationStatus: "SUPERSEDED",
          reviewStatus: "SUPERSEDED",
          fileContent: oldBytes.toString("base64"),
          contentSha256: createHash("sha256").update(oldBytes).digest("hex"),
          contentByteLength: oldBytes.byteLength,
          integrityStatus: "VERIFIED",
        },
      });

      const bytes = Buffer.from(`current revision of ${spec.file}`.repeat(4));
      await prisma.generatedDocument.create({
        data: {
          tenderId,
          name: spec.name,
          exactFileName: spec.file,
          exactOrder: spec.order,
          documentType: spec.type,
          format: "DOCX",
          generationStatus: "GENERATED",
          validationStatus: "PASSED",
          reviewStatus: "APPROVED",
          fileContent: bytes.toString("base64"),
          contentSha256: createHash("sha256").update(bytes).digest("hex"),
          contentByteLength: bytes.byteLength,
          integrityStatus: "VERIFIED",
        },
      });
    }
  });

  after(async () => {
    if (tenderId) await prisma.generatedDocument.deleteMany({ where: { tenderId } }).catch(() => {});
    if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
    if (userId) await prisma.company.deleteMany({ where: { userId } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

  it("counts the documents the package has, not every row ever written", async () => {
    const model = await getFinalPackageReadinessModel(prisma, tenderId, userId);
    assert.equal(
      model.documents.generated.length,
      3,
      `six rows exist and three are superseded; got ${model.documents.generated.length}`,
    );
  });

  it("keeps no superseded revision in the generated set", async () => {
    const model = await getFinalPackageReadinessModel(prisma, tenderId, userId);
    for (const document of model.documents.generated) {
      assert.notEqual(
        (document.generationStatus ?? "").toUpperCase(),
        "SUPERSEDED",
        `${document.finalFileName} is a historical revision, not part of this package`,
      );
    }
  });

  it("keeps superseded ids out of every set the model publishes", async () => {
    // The invariant behind the count, asserted directly so it holds whether or
    // not this tender has a confirmed Build Plan: no historical revision may
    // appear anywhere the model describes the current package, including as a
    // planned file's source document in the ZIP manifest.
    const model = await getFinalPackageReadinessModel(prisma, tenderId, userId);
    const supersededIds = new Set(
      (await prisma.generatedDocument.findMany({
        where: { tenderId, generationStatus: "SUPERSEDED" },
        select: { id: true },
      })).map((row: { id: string }) => row.id),
    );
    assert.equal(supersededIds.size, 3, "premise: the fixture really does hold three superseded rows");

    const sets: Array<[string, Array<{ id?: string | null }>]> = [
      ["generated", model.documents.generated],
      ["valid", model.documents.valid],
      ["approved", model.documents.approved],
      ["exportReady", model.documents.exportReady],
      ["extraGeneratedOutsidePlan", model.documents.extraGeneratedOutsidePlan],
    ];
    for (const [label, documents] of sets) {
      for (const document of documents) {
        assert.ok(
          !document.id || !supersededIds.has(document.id),
          `documents.${label} must not contain a superseded revision`,
        );
      }
    }

    const manifestFiles: Array<{ sourceDocumentId?: string | null; finalFileName?: string }> =
      Array.isArray(model.manifest) ? model.manifest : model.manifest?.files ?? [];
    for (const file of manifestFiles) {
      if (!file.sourceDocumentId) continue;
      assert.ok(
        !supersededIds.has(file.sourceDocumentId),
        `${file.finalFileName ?? "a manifest entry"} must not be sourced from a superseded revision`,
      );
    }
  });

  it("leaves the export-ready set unchanged", async () => {
    // The counts that were already correct must stay correct: superseded rows
    // never passed validation or review, so excluding them removes nothing
    // from the export set.
    const model = await getFinalPackageReadinessModel(prisma, tenderId, userId);
    assert.equal(model.documents.valid.length, 3);
    assert.equal(model.documents.approved.length, 3);
    assert.ok(
      model.documents.exportReady.length <= model.documents.generated.length,
      "export-ready can never exceed generated",
    );
  });
});

// Real-bytes final-ZIP acceptance test.
//
// WHY THIS FILE EXISTS
// --------------------
// The suite around it could not tell a working product from a broken one. The
// "golden tender" acceptance suite declares ten tender fixtures and then only
// asserts that its OWN string literals are non-empty; the rest of its cases are
// readFileSync + `src.includes("SOME_CONSTANT")` greps over source files, which
// pass as long as an identifier is still spelled the same way. The e2e specs
// that touch the pipeline are gated behind env flags that are unset in a normal
// run, and the one that does exercise generation asserts it is REFUSED. Nothing
// anywhere produced a byte.
//
// So every gate below could be — and was — broken at once while the suite stayed
// green: the analysis hash invalidated itself the moment analysis succeeded,
// requirement quotes were stored with a trailing ellipsis that made them
// unfindable in their own source file, plan items and documents were matched on
// a key the two sides computed differently, "PASSED" was missing from the
// validation-status lists, $queryRaw was called unbound and threw before its
// own .catch(), and byte-integrity was judged from columns that were never
// selected.
//
// This test asserts the only thing that cannot be faked: that a real archive
// comes out, with real entries, holding real bytes. It fails when no ZIP is
// produced. It talks to a real PostgreSQL database and calls the same
// finalizeTenderZip the download route calls — no mock prisma, because a mock
// prisma cannot satisfy the release gate and a test built on one can only ever
// assert that the gate said no (which is exactly what tests/zip-finalization.ts
// asserts today, and calls correct).
//
// Run: RUN_DB_INTEGRATION=true DATABASE_URL=postgresql://... npm test

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { Document, Packer, Paragraph } from "docx";
import { prisma, prismaReady } from "../lib/prisma";
import { finalizeTenderZip } from "../lib/engine/workflow/zip-finalizer";
import {
  buildTenderAnalysisContent,
  computeAnalysisContentHash,
} from "../lib/engine/tender-analysis-content";
import { computeTenderBuildPlanHash } from "../lib/engine/build-plan";
import { buildSubmissionPlan, plannedSubmissionTargetFiles } from "../lib/engine/submission-plan";
import { verifiedIntegrityDataFromBase64 } from "../lib/engine/persisted-byte-integrity";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error(
    "FATAL: RUN_DB_INTEGRATION=true and a live DATABASE_URL are required — this test exists precisely because gate behaviour cannot be verified without a real database.",
  );
  process.exit(1);
}

const PLAN_FILES = [
  { exactFileName: "01-Technical-Proposal.docx", documentType: "TECHNICAL_PROPOSAL", exactOrder: 1 },
  { exactFileName: "02-Company-Profile.docx", documentType: "COMPANY_PROFILE", exactOrder: 2 },
];

const SOURCE_TEXT = `[Page 1]
Ministry of Water and Energy
Reference: ZIPTEST/RFP/2026/0001
Procuring Entity: Ministry of Water and Energy
Submission Deadline: 30 November 2026 at 14:00 local time.
Submission Method: Email
Submission Email: procurement@example.test

[Page 2]
SECTION II — SUBMISSION INSTRUCTIONS
Files must be named and ordered exactly as follows:
1. 01-Technical-Proposal.docx
2. 02-Company-Profile.docx

[Page 3]
SECTION III — MANDATORY ELIGIBILITY REQUIREMENTS
The Consultant shall submit a company profile describing its organisation,
staffing and relevant experience.
The Consultant shall present a technical approach and methodology for the
scope of services.
`;

/** A real, openable DOCX — the ZIP finalizer validates the file signature. */
async function realDocxBase64(heading: string): Promise<string> {
  const doc = new Document({
    sections: [{ children: [new Paragraph(heading), new Paragraph(`Prepared for ${heading}.`)] }],
  });
  return (await Packer.toBuffer(doc)).toString("base64");
}

let userId = "";
let tenderId = "";

before(async () => {
  await prismaReady;

  const user = await prisma.user.create({
    data: {
      name: "Final ZIP Bytes",
      email: `final-zip-bytes+${Date.now()}@example.test`,
      passwordHash: "not-used-by-this-test",
      role: "ADMIN",
      company: { create: { name: "Hope Urban Planning Architectural and Engineering Consultancy" } },
    },
  });
  userId = user.id;

  const tender = await prisma.tender.create({
    data: {
      userId,
      title: "Consultancy Services for Rural Water Supply Schemes",
      reference: "ZIPTEST/RFP/2026/0001",
      clientName: "Ministry of Water and Energy",
      procuringEntityName: "Ministry of Water and Energy",
      deadline: new Date("2026-11-30T14:00:00.000Z"),
      submissionMethod: "Email",
      submissionEmails: "procurement@example.test",
      exactFileNaming: JSON.stringify(PLAN_FILES.map((f) => f.exactFileName)),
      exactFileOrder: JSON.stringify(PLAN_FILES.map((f) => f.exactFileName)),
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
    },
  });
  tenderId = tender.id;

  const file = await prisma.tenderFile.create({
    data: {
      tenderId,
      originalFileName: "ZIPTEST-RFP-2026-0001.txt",
      fileName: "ZIPTEST-RFP-2026-0001.txt",
      mimeType: "text/plain",
      size: SOURCE_TEXT.length,
      extractedText: SOURCE_TEXT,
      extractionScore: 100,
      totalPages: 3,
      extractedPages: 3,
      deletionStatus: "ACTIVE",
    },
  });

  // Source evidence for the critical fields, grounded in the file above.
  await prisma.tender.update({
    where: { id: tenderId },
    data: {
      titleSourceFileId: file.id,
      titleSourcePage: 1,
      titleSourceQuote: "Reference: ZIPTEST/RFP/2026/0001",
      referenceSourceFileId: file.id,
      referenceSourcePage: 1,
      referenceSourceQuote: "Reference: ZIPTEST/RFP/2026/0001",
      clientNameSourceFileId: file.id,
      clientNameSourcePage: 1,
      clientNameSourceQuote: "Procuring Entity: Ministry of Water and Energy",
      deadlineSourceFileId: file.id,
      deadlineSourcePage: 1,
      deadlineSourceQuote: "Submission Deadline: 30 November 2026 at 14:00 local time.",
      submissionMethodSourceFileId: file.id,
      submissionMethodSourcePage: 1,
      submissionMethodSourceQuote: "Submission Method: Email",
      submissionEmailSourceFileId: file.id,
      submissionEmailSourcePage: 1,
      submissionEmailSourceQuote: "Submission Email: procurement@example.test",
    },
  });

  // Mandatory requirements, each with a VERBATIM quote from the source file.
  const requirementSeeds = [
    {
      title: "Company profile",
      quote:
        "The Consultant shall submit a company profile describing its organisation,\nstaffing and relevant experience.",
      exactFileName: "02-Company-Profile.docx",
      exactOrder: 2,
    },
    {
      title: "Technical approach and methodology",
      quote:
        "The Consultant shall present a technical approach and methodology for the\nscope of services.",
      exactFileName: "01-Technical-Proposal.docx",
      exactOrder: 1,
    },
  ];
  for (const seed of requirementSeeds) {
    assert.ok(
      SOURCE_TEXT.includes(seed.quote),
      `test fixture is wrong: quote for "${seed.title}" is not verbatim in the source text`,
    );
    await prisma.tenderRequirement.create({
      data: {
        tenderId,
        title: seed.title,
        description: seed.title,
        requirementType: "TECHNICAL",
        priority: "MANDATORY",
        exactFileName: seed.exactFileName,
        exactOrder: seed.exactOrder,
        sourceTenderFileId: file.id,
        sourcePageNumber: 3,
        sourceExactQuote: seed.quote,
        sourceConfidence: 0.9,
      },
    });
  }

  // A SUCCEEDED analysis bound to the CURRENT content hash. Computed with the
  // shared helper, so if the hash inputs ever drift again this test fails here
  // rather than silently exercising a stale-analysis path.
  const activeFiles = await prisma.tenderFile.findMany({
    where: { tenderId, deletionStatus: "ACTIVE" },
    select: { id: true, originalFileName: true, extractedText: true, classification: true, createdAt: true },
  });
  const company = await prisma.company.findUnique({
    where: { userId },
    select: { documents: { select: { originalFileName: true, category: true, extractedText: true } } },
  });
  const currentTender = await prisma.tender.findUniqueOrThrow({
    where: { id: tenderId },
    select: { title: true, description: true, intakeSummary: true },
  });
  const contentHash = computeAnalysisContentHash(
    buildTenderAnalysisContent({ ...currentTender, files: activeFiles }, company ?? undefined),
  );

  const job = await prisma.aiJob.create({
    data: {
      tenderId,
      userId,
      jobType: "AI_ANALYZE",
      status: "SUCCEEDED",
      analysisInputHash: contentHash,
      startedAt: new Date(),
      finishedAt: new Date(),
      promotedAt: new Date(),
    },
  });
  await prisma.aiAnalyzeChunk.create({
    data: {
      tenderId,
      userId,
      contentHash,
      chunkIndex: 0,
      totalChunks: 1,
      status: "SUCCEEDED",
      provider: "test",
      jobId: job.id,
    },
  });

  // Documents: real DOCX bytes, validated, approved, with integrity recorded.
  for (const planFile of PLAN_FILES) {
    const fileContent = await realDocxBase64(planFile.exactFileName);
    await prisma.generatedDocument.create({
      data: {
        tenderId,
        name: planFile.exactFileName.replace(/\.docx$/i, ""),
        documentType: planFile.documentType,
        format: "DOCX",
        exactFileName: planFile.exactFileName,
        exactOrder: planFile.exactOrder,
        fileContent,
        ...verifiedIntegrityDataFromBase64({
          fileContent,
          filename: planFile.exactFileName,
          claimedMimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        generationStatus: "GENERATED",
        // "PASSED" on purpose: it is what POST /validate writes on success, and
        // gates that hardcoded ["VALIDATED","APPROVED","READY_FOR_EXPORT"]
        // silently treated a validated document as unvalidated.
        validationStatus: "PASSED",
        reviewStatus: "APPROVED",
      },
    });
  }

  // A CONFIRMED build plan bound to the live plan hash.
  //
  // Items are derived from the app's OWN submission plan rather than hand
  // written: validateBuildPlanItemsAtRuntime compares each confirmed item
  // against plannedSubmissionTargetFiles(buildSubmissionPlan(tender)) and
  // rejects anything outside that scope, so a hand-rolled documentType silently
  // fails the gate. Building from the same source is also what the Build Plan
  // route does, which keeps this fixture honest.
  const tenderForPlan = await prisma.tender.findUniqueOrThrow({
    where: { id: tenderId },
    include: { files: true, requirements: true },
  });
  const items = plannedSubmissionTargetFiles(buildSubmissionPlan(tenderForPlan as never));
  assert.ok(items.length > 0, "the tender produced no required submission files — fixture is wrong");
  assert.deepEqual(
    items.map((item) => item.exactFileName).sort(),
    PLAN_FILES.map((f) => f.exactFileName).sort(),
    "the submission plan does not name the files this test expects",
  );

  const planHash = await computeTenderBuildPlanHash(prisma, tenderId, userId, items as never);
  assert.ok(planHash, "computeTenderBuildPlanHash returned no hash — the plan cannot be confirmed");
  await prisma.buildPlan.create({
    data: {
      id: randomUUID(),
      tenderId,
      status: "CONFIRMED",
      revision: 1,
      confirmedRevision: 1,
      contentHash: planHash,
      confirmedContentHash: planHash,
      itemsJson: JSON.stringify(items),
      confirmedAt: new Date(),
    },
  });
});

after(async () => {
  if (tenderId) await prisma.tender.deleteMany({ where: { id: tenderId } }).catch(() => {});
  if (userId) await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
});

describe("final ZIP — real bytes, real database", () => {
  it("produces a downloadable archive whose entries match the confirmed plan", async () => {
    const result = await finalizeTenderZip(prisma, tenderId, userId);

    // The failure that matters. A blocked release is reported with its code so
    // the next person sees WHICH gate refused, not just "no ZIP".
    assert.ok(
      result.ok,
      `NO ZIP PRODUCED — finalizeTenderZip refused with code=${result.code ?? "(none)"}: ${result.error ?? "(no message)"}`,
    );

    const buffer = result.buffer;
    assert.ok(buffer && buffer.length > 0, "NO ZIP PRODUCED — result.ok was true but no bytes came back");
    assert.equal(
      buffer.subarray(0, 2).toString("latin1"),
      "PK",
      "the returned bytes are not a ZIP archive (missing PK signature)",
    );

    // Reopen the archive: entries must be the confirmed plan's files, in order,
    // each carrying real bytes.
    const reopened = await JSZip.loadAsync(buffer);
    const entryNames = Object.keys(reopened.files).filter((name) => !reopened.files[name].dir);
    assert.deepEqual(
      entryNames.sort(),
      PLAN_FILES.map((f) => f.exactFileName).sort(),
      "ZIP entries do not match the confirmed build plan's required files",
    );
    assert.deepEqual(
      result.fileList,
      PLAN_FILES.map((f) => f.exactFileName),
      "ZIP file order does not follow the plan's exact order",
    );

    for (const name of entryNames) {
      const bytes = await reopened.file(name)!.async("nodebuffer");
      assert.ok(bytes.length > 0, `${name} is present in the ZIP but empty`);
      assert.equal(
        bytes.subarray(0, 2).toString("latin1"),
        "PK",
        `${name} is not a valid DOCX (Office packages are ZIPs and must start with PK)`,
      );
      const inner = await JSZip.loadAsync(bytes);
      assert.ok(
        inner.file("word/document.xml"),
        `${name} has no word/document.xml — it is not an openable Word document`,
      );
    }
  });

  it("refuses to package a document whose stored bytes fail integrity verification", async () => {
    // Guards the opposite direction: the fixes that made the ZIP possible must
    // not have made it lenient. Corrupting the persisted hash must block.
    const doc = await prisma.generatedDocument.findFirstOrThrow({
      where: { tenderId, exactFileName: PLAN_FILES[0].exactFileName },
      select: { id: true, contentSha256: true },
    });
    await prisma.generatedDocument.update({
      where: { id: doc.id },
      data: { contentSha256: "0".repeat(64) },
    });
    try {
      const result = await finalizeTenderZip(prisma, tenderId, userId);
      assert.equal(result.ok, false, "a document with a mismatched content hash was packaged anyway");
    } finally {
      await prisma.generatedDocument.update({
        where: { id: doc.id },
        data: { contentSha256: doc.contentSha256 },
      });
    }
  });
});

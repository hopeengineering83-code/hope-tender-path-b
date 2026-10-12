// A tender-page poll must not download stored files.
//
// 2026-10-08: the Preview's Neon database stopped answering two days after it
// was provisioned — its monthly transfer allowance was gone. Measured through a
// byte-counting proxy, one /workflow-center poll moved ~18.6 MB out of Postgres
// for an ordinary tender: workflow-state included every tender file and every
// generated document (superseded ones too) with their stored bodies, and the
// analysis-state resolver included every tender file's body to read one JSON
// column — twice, because the decision loaded its own copy of the snapshot. The
// page polls that route every few seconds, so one open tab was gigabytes an
// hour.
//
// This seeds a tender with realistically sized bodies, runs exactly what one
// poll runs, and counts the bytes Prisma returns.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { executeTenderDeletion } from "../lib/tender/delete-tender";
import { getTenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import { getCanonicalTenderWorkflowState } from "../lib/engine/workflow/workflow-state";
import { getCanonicalTenderWorkflowDecision } from "../lib/engine/canonical-workflow-decision";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

const b64 = (bytes: number, magic = "") => (Buffer.concat([Buffer.from(magic), randomBytes(Math.floor(bytes * 0.75))])).toString("base64");

let userId = "";
let tenderId = "";
let docxBody = "";
const seededBytes = { value: 0 };

describe("a tender-page poll does not download stored files — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    userId = (await prisma.user.create({ data: { email: `poll-egress-${nonce}@example.test`, name: "Poll", passwordHash: "h", company: { create: { name: "Firm" } } } })).id;
    const fileBody = b64(1_500_000, "%PDF-1.7\n");
    tenderId = (await prisma.tender.create({ data: {
      userId, title: `Poll egress ${nonce}`, status: "GENERATED", stage: "GENERATION", country: "Ethiopia",
      files: { create: [0, 1].map((i) => ({ fileName: `tor-${i}.pdf`, originalFileName: `tor-${i}.pdf`, mimeType: "application/pdf", size: 1_500_000, fileContent: fileBody, extractedText: "The consultant shall deliver the study. ".repeat(500) })) },
      requirements: { create: Array.from({ length: 6 }, (_, i) => ({ title: `Requirement ${i}`, description: "Deliver the study.", requirementType: "TECHNICAL", priority: "MANDATORY" })) },
    } })).id;
    docxBody = b64(650_000, "PK\u0003\u0004");
    for (let i = 0; i < 8; i++) {
      await prisma.generatedDocument.create({ data: {
        tenderId, name: `Technical Proposal v${i}`, exactFileName: i === 7 ? "Technical Proposal.docx" : `Technical Proposal v${i}.docx`,
        documentType: "TECHNICAL_PROPOSAL", format: "DOCX",
        generationStatus: i === 7 ? "GENERATED" : "SUPERSEDED", validationStatus: i === 7 ? "VALIDATED" : "SUPERSEDED", reviewStatus: "PENDING",
        fileContent: docxBody, contentSummary: "Generated technical proposal.",
      } });
    }
    seededBytes.value = 2 * fileBody.length + 8 * docxBody.length;
  });

  after(async () => {
    await prisma.$transaction((tx) => executeTenderDeletion(tx, tenderId, "poll-egress-test", userId));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("reads kilobytes, not the stored bodies, and never returns a body", async () => {
    let returned = 0;
    let sawBody = false;
    const counted = (prisma as any).$extends({ query: { $allModels: { async $allOperations({ args, query }: any) {
      const result = await query(args);
      const json = JSON.stringify(result ?? null, (_k, v) => (typeof v === "bigint" ? String(v) : v));
      returned += Buffer.byteLength(json);
      if (json.includes(docxBody.slice(0, 4000))) sawBody = true;
      return result;
    } } } });

    // Exactly what GET /api/tenders/[id]/workflow-center runs.
    const snapshot = await getTenderReleaseSnapshot(counted, tenderId, userId);
    const [workflow] = await Promise.all([
      getCanonicalTenderWorkflowState(counted, userId, tenderId),
      getCanonicalTenderWorkflowDecision(counted, userId, tenderId, snapshot),
    ]);

    assert.ok(seededBytes.value > 6_000_000, "the tender holds megabytes of stored bodies");
    assert.equal(sawBody, false, "no generated document body is returned to a status poll");
    assert.ok(returned < 400_000, `one poll returned ${returned} bytes`);
    assert.ok(workflow.tenderId === tenderId);
  });

  it("still recognises the stored DOCX without loading it", async () => {
    const { filterFinalExportCandidateDocuments, deriveDocumentOutputState } = await import("../lib/engine/document-output-state");
    const doc = await prisma.generatedDocument.findFirstOrThrow({ where: { tenderId, generationStatus: "GENERATED" }, omit: { fileContent: true } });
    const [row] = await prisma.$queryRaw<Array<{ head: string }>>`SELECT left("fileContent", 16) AS head FROM "GeneratedDocument" WHERE id = ${doc.id}`;
    const withHead = { ...doc, fileContentHead: row!.head, hasInlineFileContent: true };
    const withBody = { ...doc, fileContent: docxBody };
    assert.equal(filterFinalExportCandidateDocuments([withHead]).length, filterFinalExportCandidateDocuments([withBody]).length);
    assert.equal(deriveDocumentOutputState(withHead), deriveDocumentOutputState(withBody), "the head classifies exactly as the body does");
    assert.equal(deriveDocumentOutputState(withHead), "READY_FOR_EXPORT");
  });
});

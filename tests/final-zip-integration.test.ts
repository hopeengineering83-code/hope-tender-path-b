import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import JSZip from "jszip";
import { assembleFinalSubmissionZip } from "../lib/engine/final-zip-assembly";
import { buildFinalZipEntries } from "../lib/engine/final-zip-scope";
import { inferEnvelope } from "../lib/engine/submission-plan";

const generatedDocs = [
  { id: "technical", name: "Technical Proposal", exactFileName: "01-Technical-Proposal.docx", exactOrder: 1, documentType: "TECHNICAL" },
  { id: "admin", name: "Eligibility Declaration", exactFileName: "02-Eligibility-Declaration.docx", exactOrder: 2, documentType: "DECLARATION" },
  { id: "financial", name: "Financial Proposal", exactFileName: "03-Financial-Proposal.xlsx", exactOrder: 3, documentType: "FINANCIAL" },
  { id: "internal", name: "Win-Probability-Report", exactFileName: "Win-Probability-Report.docx", exactOrder: 99, documentType: "INTERNAL" },
];

const tenderScope = {
  exactFileNaming: JSON.stringify([
    "01-Technical-Proposal.docx",
    "02-Eligibility-Declaration.docx",
    "03-Financial-Proposal.xlsx",
  ]),
  exactFileOrder: JSON.stringify([
    "01-Technical-Proposal.docx",
    "02-Eligibility-Declaration.docx",
    "03-Financial-Proposal.xlsx",
  ]),
  requirements: [
    { exactFileName: "01-Technical-Proposal.docx" },
    { exactFileName: "02-Eligibility-Declaration.docx" },
    { exactFileName: "03-Financial-Proposal.xlsx" },
  ],
};

const contents = generatedDocs.map((doc) => ({
  generatedDocId: doc.id,
  bytes: Buffer.from(`approved final bytes for ${doc.exactFileName}`),
}));

describe("final ZIP integration", () => {
  it("creates a valid archive with exact names, exact order, and no internal extras", async () => {
    const scope = buildFinalZipEntries({ tender: tenderScope, generatedDocs });
    assert.deepEqual(
      scope.entries.map((entry) => entry.name),
      ["01-Technical-Proposal.docx", "02-Eligibility-Declaration.docx", "03-Financial-Proposal.xlsx"],
    );
    assert.ok(scope.exclusions.some((entry) => entry.docId === "internal"));

    const result = await assembleFinalSubmissionZip(scope.entries, contents);
    assert.equal(result.buffer[0], 0x50);
    assert.equal(result.buffer[1], 0x4b);
    assert.deepEqual(result.fileList, [
      "01-Technical-Proposal.docx",
      "02-Eligibility-Declaration.docx",
      "03-Financial-Proposal.xlsx",
    ]);

    const zip = await JSZip.loadAsync(result.buffer);
    const actualNames = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    assert.deepEqual(actualNames, result.fileList);
    assert.equal(zip.file("Win-Probability-Report.docx"), null);
    assert.match(await zip.file("01-Technical-Proposal.docx")!.async("string"), /approved final bytes/);
  });

  it("produces a technical envelope without financial content", async () => {
    const technicalDocs = generatedDocs.filter((doc) =>
      inferEnvelope(doc.documentType, doc.exactFileName, doc.name) === "TECHNICAL",
    );
    const scope = buildFinalZipEntries({ tender: tenderScope, generatedDocs: technicalDocs });
    const result = await assembleFinalSubmissionZip(scope.entries, contents);
    const zip = await JSZip.loadAsync(result.buffer);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    assert.ok(names.includes("01-Technical-Proposal.docx"));
    assert.ok(!names.some((name) => /financial/i.test(name)));
  });

  it("rejects duplicate filenames instead of silently overwriting", async () => {
    await assert.rejects(
      assembleFinalSubmissionZip([
        { name: "Proposal.docx", source: "GENERATED_DOC", generatedDocId: "technical" },
        { name: "proposal.docx", source: "GENERATED_DOC", generatedDocId: "admin" },
      ], contents),
      /Duplicate filename/i,
    );
  });

  it("rejects missing document bytes", async () => {
    await assert.rejects(
      assembleFinalSubmissionZip([
        { name: "Missing.docx", source: "GENERATED_DOC", generatedDocId: "missing" },
      ], contents),
      /no document bytes/i,
    );
  });
});

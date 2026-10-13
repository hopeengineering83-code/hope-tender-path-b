import { realPdfBytes, realXlsxBytes } from "./helpers/real-artifact-bytes";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import JSZip from "jszip";
import { assembleFinalSubmissionZip } from "../lib/engine/final-zip-assembly";
import { buildFinalZipEntries } from "../lib/engine/final-zip-scope";

describe("final ZIP manifest authority", () => {
  it("carries the exact plan order, envelope, and format into the verified manifest", async () => {
    const scope = buildFinalZipEntries({
      tender: {
        exactFileNaming: JSON.stringify(["Financial-Offer.xlsx", "Technical-Proposal.pdf"]),
        exactFileOrder: JSON.stringify(["Financial-Offer.xlsx", "Technical-Proposal.pdf"]),
        requirements: [],
      },
      generatedDocs: [
        {
          id: "technical",
          name: "Technical Proposal",
          exactFileName: "Technical-Proposal.pdf",
          exactOrder: 20,
          documentType: "TECHNICAL_PROPOSAL",
          format: "PDF",
        },
        {
          id: "financial",
          name: "Financial Offer",
          exactFileName: "Financial-Offer.xlsx",
          exactOrder: 10,
          documentType: "FINANCIAL",
          format: "XLSX",
        },
      ] as any,
    });

    assert.deepEqual(
      scope.entries.map((entry) => ({
        filename: entry.name,
        order: (entry as any).order,
        envelope: (entry as any).envelope,
        format: (entry as any).format,
      })),
      [
        { filename: "Financial-Offer.xlsx", order: 10, envelope: "FINANCIAL", format: "XLSX" },
        { filename: "Technical-Proposal.pdf", order: 20, envelope: "TECHNICAL", format: "PDF" },
      ],
    );

    const result = await assembleFinalSubmissionZip(
      scope.entries,
      [
        // Real artifacts: assembly verifies that each entry's bytes match its
        // name and declared format, and an .xlsx holding plain text is
        // genuinely mislabelled.
        { generatedDocId: "financial", bytes: await realXlsxBytes() },
        { generatedDocId: "technical", bytes: realPdfBytes("Technical Proposal") },
      ],
    );
    assert.deepEqual(
      result.manifest.map(({ filename, order, envelope, format }) => ({
        filename,
        order,
        envelope,
        format,
      })),
      [
        { filename: "Financial-Offer.xlsx", order: 10, envelope: "FINANCIAL", format: "XLSX" },
        { filename: "Technical-Proposal.pdf", order: 20, envelope: "TECHNICAL", format: "PDF" },
      ],
    );

    const reopened = await JSZip.loadAsync(result.buffer);
    assert.deepEqual(
      Object.values(reopened.files).filter((entry) => !entry.dir).map((entry) => entry.name),
      result.manifest.map((entry) => entry.filename),
    );
  });

  it("rejects duplicate plan-order positions instead of silently inventing new order", async () => {
    await assert.rejects(
      assembleFinalSubmissionZip(
        [
          {
            name: "Technical.docx",
            source: "GENERATED_DOC",
            generatedDocId: "technical",
            order: 1,
            envelope: "TECHNICAL",
            format: "DOCX",
          },
          {
            name: "Financial.xlsx",
            source: "GENERATED_DOC",
            generatedDocId: "financial",
            order: 1,
            envelope: "FINANCIAL",
            format: "XLSX",
          },
        ] as any,
        [
          { generatedDocId: "technical", bytes: realPdfBytes("Technical Proposal") },
          { generatedDocId: "financial", bytes: await realXlsxBytes() },
        ],
      ),
      /duplicate.*order|order.*duplicate/i,
    );
  });

  it("has one production ZIP owner and no disconnected workflow finalizer", () => {
    assert.equal(
      existsSync("lib/engine/workflow/zip-finalizer.ts"),
      false,
      "the disconnected duplicate finalizer must be removed",
    );
    const route = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
    assert.match(route, /assembleFinalSubmissionZip/);
    assert.match(route, /format:\s*d\.format/);
  });
});

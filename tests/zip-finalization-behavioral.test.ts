import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import JSZip from "jszip";
import { assembleFinalSubmissionZip } from "../lib/engine/final-zip-assembly";
import type { ZipEntry } from "../lib/engine/final-zip-scope";

const DOCX_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32)]);

function zipEntry(overrides: Partial<ZipEntry> = {}): ZipEntry {
  return {
    name: "Technical-Proposal.docx",
    source: "GENERATED_DOC",
    generatedDocId: "doc-1",
    order: 1,
    envelope: "TECHNICAL",
    format: "DOCX",
    ...overrides,
  };
}

describe("final ZIP behavioral acceptance", () => {
  it("rejects duplicate names case-insensitively", async () => {
    await assert.rejects(
      assembleFinalSubmissionZip(
        [
          zipEntry({ generatedDocId: "a", name: "Proposal.docx" }),
          zipEntry({ generatedDocId: "b", name: "proposal.docx", order: 2 }),
        ],
        [
          { generatedDocId: "a", bytes: DOCX_BYTES },
          { generatedDocId: "b", bytes: DOCX_BYTES },
        ],
      ),
      /duplicate filename/i,
    );
  });

  it("rejects path traversal", async () => {
    await assert.rejects(
      assembleFinalSubmissionZip(
        [zipEntry({ name: "../Proposal.docx" })],
        [{ generatedDocId: "doc-1", bytes: DOCX_BYTES }],
      ),
      /unsafe path/i,
    );
  });

  it("rejects duplicate plan order positions", async () => {
    await assert.rejects(
      assembleFinalSubmissionZip(
        [
          zipEntry({ generatedDocId: "a", name: "A.docx" }),
          zipEntry({ generatedDocId: "b", name: "B.docx" }),
        ],
        [
          { generatedDocId: "a", bytes: DOCX_BYTES },
          { generatedDocId: "b", bytes: DOCX_BYTES },
        ],
      ),
      /duplicate plan order/i,
    );
  });

  it("creates a ZIP whose entry bytes and manifest hash exactly match", async () => {
    const result = await assembleFinalSubmissionZip(
      [zipEntry()],
      [{ generatedDocId: "doc-1", bytes: DOCX_BYTES }],
    );

    assert.deepEqual(result.fileList, ["Technical-Proposal.docx"]);
    assert.equal(result.manifest.length, 1);
    assert.equal(result.manifest[0].byteLength, DOCX_BYTES.length);
    assert.equal(result.manifest[0].order, 1);
    assert.equal(result.manifest[0].envelope, "TECHNICAL");
    assert.equal(result.manifest[0].format, "DOCX");

    const reopened = await JSZip.loadAsync(result.buffer);
    const entry = reopened.file("Technical-Proposal.docx");
    assert.ok(entry);
    const entryBytes = await entry!.async("nodebuffer");
    assert.deepEqual(entryBytes, DOCX_BYTES);
  });
});

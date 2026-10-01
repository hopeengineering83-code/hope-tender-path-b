// Release acceptance — Work Package F (ZIP & manifest correctness).
//
// Exercises the REAL final-package helpers (no mocks of the logic under test):
//   - buildFinalPackageManifest / validateStrictFinalPackageManifest
//   - assembleFinalSubmissionZip
//
// Asserts the fail-closed invariants a trustworthy final package must hold:
// stale/superseded/zero-byte docs are excluded and block; filenames are safe;
// duplicate names and unsafe paths are refused; the manifest matches the ZIP.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import JSZip from "jszip";
import {
  buildFinalPackageManifest,
  validateStrictFinalPackageManifest,
  manifestFingerprint,
  type ManifestSourceDocument,
} from "../lib/engine/final-package-manifest";
import { assembleFinalSubmissionZip } from "../lib/engine/final-zip-assembly";
import type { ZipEntry } from "../lib/engine/final-zip-scope";

// A tiny but valid DOCX-ish payload is unnecessary here — the manifest/ZIP
// helpers operate on bytes, not Office internals. We use deterministic buffers.
function docBytes(marker: string): Buffer {
  return Buffer.from(`PK-doc-content:${marker}`.repeat(4), "utf8");
}

function b64(marker: string): string {
  return docBytes(marker).toString("base64");
}

describe("release-acceptance F — final package manifest", () => {
  it("excludes/blocks stale and zero-byte documents; passes clean required docs", () => {
    const docs: ManifestSourceDocument[] = [
      { id: "d1", exactFileName: "01-Technical-Proposal.docx", documentType: "TECHNICAL", fileContent: b64("tech"), exactOrder: 1, required: true, generationStatus: "GENERATED" },
      { id: "d2", exactFileName: "02-Financial-Proposal.docx", documentType: "FINANCIAL", fileContent: b64("fin"), exactOrder: 2, required: true, generationStatus: "GENERATED" },
      { id: "d3", exactFileName: "03-Stale.docx", documentType: "TECHNICAL", fileContent: b64("stale"), exactOrder: 3, required: true, stale: true, generationStatus: "STALE" },
      { id: "d4", exactFileName: "04-Empty.docx", documentType: "TECHNICAL", fileContent: "", exactOrder: 4, required: true, generationStatus: "GENERATED" },
    ];
    const { items, blockers, ok } = buildFinalPackageManifest(docs);

    const byId = Object.fromEntries(items.map((i) => [i.documentId, i]));
    assert.equal(byId.d1.valid, true, "clean required doc is valid");
    assert.equal(byId.d2.valid, true);
    assert.equal(byId.d3.valid, false, "stale doc is invalid");
    assert.equal(byId.d4.valid, false, "zero-byte doc is invalid");
    assert.ok(byId.d3.problem && /stale/i.test(byId.d3.problem));
    assert.ok(byId.d4.problem && /missing|zero/i.test(byId.d4.problem));

    // Strict validation must fail-closed while any required item is invalid.
    assert.equal(ok, false, "manifest is not ok while a required doc is stale/empty");
    assert.ok(blockers.length > 0, "blockers surfaced for the unsafe docs");
  });

  it("produces safe, deterministic filenames and a stable fingerprint", () => {
    const docs: ManifestSourceDocument[] = [
      { id: "d1", exactFileName: "Cover Letter/../evil.docx", fileContent: b64("a"), exactOrder: 1, required: true, generationStatus: "GENERATED" },
      { id: "d2", exactFileName: "Bid: Form*?.docx", fileContent: b64("b"), exactOrder: 2, required: true, generationStatus: "GENERATED" },
    ];
    const { items } = buildFinalPackageManifest(docs);
    for (const item of items) {
      // The manifest layer guarantees fs-safe filenames with NO path separators;
      // real path-traversal is rejected one layer down in assembleFinalSubmissionZip
      // (see the ZIP-assembly test). A ".." fragment inside a separator-free name
      // is not a traversal, so we assert the separator/char contract here.
      assert.ok(!/[\\/:*?"<>|]/.test(item.filename), `no unsafe fs chars/separators in ${item.filename}`);
      assert.ok(item.filename.trim().length > 0);
    }
    // Fingerprint is deterministic for identical inputs and changes when content changes.
    const fp1 = manifestFingerprint(items);
    const fp2 = manifestFingerprint(buildFinalPackageManifest(docs).items);
    assert.equal(fp1, fp2, "fingerprint stable for identical inputs");
    const changed = buildFinalPackageManifest([{ ...docs[0], fileContent: b64("changed") }, docs[1]]).items;
    assert.notEqual(fp1, manifestFingerprint(changed), "fingerprint changes when content changes");
  });
});

describe("release-acceptance F — final ZIP assembly", () => {
  const entry = (id: string, name: string, order = 1): ZipEntry => ({
    name,
    source: "GENERATED_DOC",
    generatedDocId: id,
    order,
    envelope: /financial/i.test(name) ? "FINANCIAL" : "TECHNICAL",
    format: name.toLowerCase().endsWith(".pdf") ? "PDF" : "DOCX",
  });

  it("assembles scoped entries and the manifest matches the reopened ZIP", async () => {
    const entries = [entry("d1", "01-Technical.docx"), entry("d2", "02-Financial.docx", 2)];
    const contents = [
      { generatedDocId: "d1", bytes: docBytes("tech") },
      { generatedDocId: "d2", bytes: docBytes("fin") },
    ];
    const result = await assembleFinalSubmissionZip(entries, contents);
    assert.deepEqual(result.fileList.sort(), ["01-Technical.docx", "02-Financial.docx"].sort());

    // Reopen and confirm ZIP contents == manifest (count + names).
    const reopened = await JSZip.loadAsync(result.buffer);
    const zipNames = Object.keys(reopened.files).filter((n) => !reopened.files[n].dir);
    assert.equal(zipNames.length, result.fileList.length, "manifest count == ZIP entry count");
    assert.deepEqual(zipNames.sort(), result.fileList.sort());
  });

  it("refuses path traversal, duplicate names, and missing bytes (fail-closed)", async () => {
    // Path traversal
    await assert.rejects(
      assembleFinalSubmissionZip([entry("d1", "../escape.docx")], [{ generatedDocId: "d1", bytes: docBytes("x") }]),
      /unsafe|absolute|traversal|\.\./i,
    );
    // Duplicate entry names
    await assert.rejects(
      assembleFinalSubmissionZip(
        [entry("d1", "same.docx"), entry("d2", "same.docx", 2)],
        [{ generatedDocId: "d1", bytes: docBytes("a") }, { generatedDocId: "d2", bytes: docBytes("b") }],
      ),
      /duplicate|overwrite|same/i,
    );
    // Missing bytes for a scoped entry
    await assert.rejects(
      assembleFinalSubmissionZip([entry("d1", "doc.docx")], []),
      /missing|no content|bytes/i,
    );
  });

  it("refuses an empty scope (no document may be exported without scope)", async () => {
    await assert.rejects(assembleFinalSubmissionZip([], []), /no scoped entries|empty/i);
  });

  it("strict manifest validation blocks when a required item is stale", () => {
    const { items } = buildFinalPackageManifest([
      { id: "d1", exactFileName: "req.docx", fileContent: b64("a"), required: true, stale: true, generationStatus: "STALE" },
    ]);
    const v = validateStrictFinalPackageManifest(items);
    assert.equal(v.ok, false);
  });
});

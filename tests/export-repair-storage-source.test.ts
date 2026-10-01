// The durable export-gap repair must judge — and rewrite — the bytes that
// storage-first readers actually serve.
//
// WHY THIS FILE EXISTS
// --------------------
// runExportGapRepair selected the bytes to clean with
// `generatedDocumentHasContent(doc) && doc.fileContent`. A storage-backed
// row (Vercel Blob in production) has fileContent=null, so that expression
// is falsy for exactly the rows the live Preview creates, and the repair
// silently fell through to the makeSafeDocx stub. The stub was written into
// fileContent, the integrity record was rebound to the STUB, and storagePath
// still pointed at the real generated document:
//
//   validation read the inline stub  -> VALIDATED (wrong bytes blessed)
//   final ZIP / download read storage -> the real bytes
//   persisted digest described the stub -> PERSISTED_BYTE_INTEGRITY_MISMATCH
//
// The document could never export, and because the repair had left its
// machine marker the row was never repaired again. AUTO_FINALIZE reported
// the tender failed while the repair itself was the damage. Reproduced
// against the real continuation service: 16,662 real bytes in, an 8,759-byte
// stub out, integrity rebound to the stub.
//
// readRepairSourceContent is now the one selection rule: storage-backed rows
// are read through the storage adapter (the same bytes the ZIP serves),
// inline rows pass through, and only a genuinely empty row returns null for
// the stub fallback. The repair update clears storagePath so the repaired
// inline copy is the single authority — the contract the /auto-finalize
// route's rebuild already follows.

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const REPAIR_SOURCE = readFileSync("lib/engine/export-gap-repair.ts", "utf8");

// The local storage adapter writes under STORAGE_ROOT; point it at a
// disposable directory so the test never touches a real workspace.
const TEMP_ROOT = mkdtempSync(join(tmpdir(), "repair-source-test-"));
process.env.STORAGE_ROOT = TEMP_ROOT;
process.env.BLOB_READ_WRITE_TOKEN = "";

// Loaded in before() (dynamic import) AFTER STORAGE_ROOT is set, so the
// storage adapter the test exercises writes only inside TEMP_ROOT.
let readRepairSourceContent: (doc: { fileContent: string | null; storagePath?: string | null }, fileName: string) => Promise<string | null>;
let getStorageAdapter: () => { putFile(buffer: Buffer, metadata: { fileName: string; mimeType: string; tenderId?: string }): Promise<{ storagePath: string }>; };


const REAL_BYTES = Buffer.from(
  "PK\u0003\u0004 - a real generated document body with enough characters to look like text - " +
  "Hope Urban Planning technical proposal content for the Amhara Region rural water supply assignment.",
  "utf8",
);

async function putRealBytes(): Promise<string> {
  const storage = getStorageAdapter();
  const put = await storage.putFile(REAL_BYTES, {
    fileName: "01-Technical-Proposal.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    tenderId: "t-1",
  });
  return put.storagePath;
}

before(async () => {
  const repairModule = await import("../lib/engine/export-gap-repair");
  const storageModule = await import("../lib/storage");
  readRepairSourceContent = repairModule.readRepairSourceContent;
  getStorageAdapter = storageModule.getStorageAdapter;
});

after(async () => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe("readRepairSourceContent — the bytes a repair will actually clean", () => {
  it("reads the STORAGE bytes for a storage-backed row (fileContent null), not a stub", async () => {
    const storagePath = await putRealBytes();
    const content = await readRepairSourceContent(
      { fileContent: null, storagePath },
      "01-Technical-Proposal.docx",
    );
    assert.ok(content, "storage-backed row must resolve to content");
    const bytes = Buffer.from(content, "base64");
    assert.equal(bytes.length, REAL_BYTES.length, "must be the REAL bytes, byte-for-byte");
    assert.equal(bytes.toString("utf8"), REAL_BYTES.toString("utf8"));
  });

  it("passes inline content through unchanged", async () => {
    const inline = REAL_BYTES.toString("base64");
    const content = await readRepairSourceContent(
      { fileContent: inline, storagePath: null },
      "01-Technical-Proposal.docx",
    );
    assert.equal(content, inline);
  });

  it("prefers storage over a stale inline copy (storage-first, like the ZIP reader)", async () => {
    const storagePath = await putRealBytes();
    const staleInline = Buffer.from("stale inline copy of older bytes", "utf8").toString("base64");
    const content = await readRepairSourceContent(
      { fileContent: staleInline, storagePath },
      "01-Technical-Proposal.docx",
    );
    const bytes = Buffer.from(content!, "base64");
    assert.equal(bytes.toString("utf8"), REAL_BYTES.toString("utf8"));
  });

  it("returns null only for a genuinely empty row (the legitimate stub case)", async () => {
    const content = await readRepairSourceContent(
      { fileContent: null, storagePath: null },
      "01-Technical-Proposal.docx",
    );
    assert.equal(content, null);
  });

  it("propagates a storage read failure so the caller leaves the row untouched", async () => {
    await assert.rejects(
      () => readRepairSourceContent(
        { fileContent: null, storagePath: join(TEMP_ROOT, "does-not-exist.docx") },
        "01-Technical-Proposal.docx",
      ),
      "a missing storage object must not be silently replaced by a stub",
    );
  });
});

describe("runExportGapRepair wiring — single byte authority after repair", () => {
  it("selects bytes through readRepairSourceContent, not the stub fallback expression", () => {
    assert.match(REPAIR_SOURCE, /content = await readRepairSourceContent\(doc, name\)/);
    assert.doesNotMatch(
      REPAIR_SOURCE,
      /generatedDocumentHasContent\(doc\) && doc\.fileContent \? doc\.fileContent/,
      "the old stub-fallback selection must not come back",
    );
  });

  it("clears storagePath when it writes the repaired bytes", () => {
    // The update data must include storagePath: null so the repaired inline
    // copy is the ONE authority. Leaving storagePath set preserves a second,
    // stale copy that the ZIP reader would serve instead.
    const updateBlock = REPAIR_SOURCE.slice(REPAIR_SOURCE.indexOf("await tx.generatedDocument.update"));
    assert.match(updateBlock.slice(0, 900), /storagePath: null/);
  });

  it("leaves an unreadable storage row for canonical validation instead of stubbing it", () => {
    const block = REPAIR_SOURCE.slice(REPAIR_SOURCE.indexOf("let content: string | null;"));
    assert.match(block.slice(0, 1200), /continue;/);
    assert.match(block.slice(0, 1200), /could not be read/);
  });
});

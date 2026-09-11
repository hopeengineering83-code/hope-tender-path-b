// A brand asset whose bytes live in storage is not a missing brand asset.
//
// Reproduced defect (live Preview, tender 50940b8b, 2026-09-11). The owner
// uploaded letterhead, signature and stamp; the pipeline ran clean and the
// delivered 37-page PDF contained ZERO embedded images:
//
//   === DELIVERED PDF ASSET AUDIT (37 pages, 226948 bytes) ===
//   EMBEDDED IMAGE XOBJECTS: 0
//     RESULT: the client's copy contains NO images at all.
//
// The generation job explained itself, and the explanation was wrong:
//
//   letterhead applied to 0 file(s) — No active LETTERHEAD asset with
//   stored bytes was found in the Company Vault.
//
// The Company Vault held all three, and every one of them was
// storage-backed rather than inline:
//
//   STAMP      103,155 B  active  VERIFIED  inline=False  storage=True
//   SIGNATURE    3,246 B  active  VERIFIED  inline=False  storage=True
//   LETTERHEAD 126,100 B  active  VERIFIED  inline=False  storage=True
//
// applyActiveLetterhead selected `fileContent` and nothing else, so a
// storage-backed asset was indistinguishable from no asset. "No stored bytes"
// about bytes that are stored sends the owner to re-upload a file that was
// never the problem.
//
// Generic: nothing here is about a tender, a sector or a particular file.
// Any vault whose assets are persisted to storage rather than inline hits it,
// which on this deployment is every vault.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const SRC = readFileSync("lib/engine/apply-active-letterhead.ts", "utf8");

describe("a storage-backed brand asset is not a missing one", () => {
  it("the asset query selects storagePath, not just fileContent", () => {
    const at = SRC.indexOf('assetType: "LETTERHEAD"');
    assert.ok(at > -1, "the active-letterhead lookup must still exist");
    const query = SRC.slice(at, at + 500);
    assert.match(query, /storagePath:\s*true/, "a letterhead in storage cannot be found without selecting storagePath");
    assert.match(query, /fileContent:\s*true/, "inline bytes must still be read");
  });

  it("storage-backed bytes are read through the adapter the codebase already uses", () => {
    // checkDocxHygieneReadiness reads generated documents this way. Inventing
    // a second path here would be a second thing to keep correct.
    assert.match(SRC, /getStorageAdapter/, "must use the shared storage adapter");
    const at = SRC.indexOf("getStorageAdapter()");
    const call = SRC.slice(at, at + 400);
    assert.match(call, /getFile\(/);
    assert.match(call, /storagePath: letterhead\.storagePath/);
  });

  it("the template is built from whichever source supplied the bytes", () => {
    // The original read Buffer.from(letterhead.fileContent) directly, so even
    // a successful storage read would not have reached the renderer.
    assert.doesNotMatch(
      SRC,
      /Buffer\.from\(letterhead\.fileContent/,
      "the buffer must come from the resolved bytes, not from the inline field alone",
    );
    assert.match(SRC, /Buffer\.from\(letterheadBase64/);
  });

  it("'no stored bytes' is reported only when there are genuinely none", () => {
    // The distinction that matters to the owner: absent asset, unreadable
    // storage, and truly empty are three different problems with three
    // different responses, and only one of them means "re-upload".
    assert.match(SRC, /No active LETTERHEAD asset was found in the Company Vault\./,
      "an absent asset should say so plainly");
    assert.match(SRC, /could not be read back from storage/,
      "a storage read failure must name itself rather than masquerade as an absent asset");
    assert.match(SRC, /No active LETTERHEAD asset with stored bytes was found/,
      "the genuinely-empty case keeps its message");
  });

  it("a storage failure is not silently swallowed into 'applied: 0' with no cause", () => {
    const at = SRC.indexOf("could not be read back from storage");
    const region = SRC.slice(Math.max(0, at - 600), at + 200);
    assert.match(region, /catch/, "the read must be guarded");
    assert.match(region, /detail/, "the underlying error must reach the reason");
  });

  it("the existing guards are unchanged", () => {
    // This fix must not have loosened anything. Tender prohibition, the
    // settings toggle, the MIME check and the real-docx check all still gate.
    assert.match(SRC, /forbidsBranding/);
    assert.match(SRC, /allowBrandingDefault === false/);
    assert.match(SRC, /wordprocessingml\\.document\|msword\|octet-stream/);
    assert.match(SRC, /looksLikeDocx\(templateBuffer\)/);
  });
});

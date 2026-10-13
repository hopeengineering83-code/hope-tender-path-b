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
const PDF_SRC = readFileSync("lib/engine/workflow/pdf-finalizer.ts", "utf8");

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

// The same defect, surviving in a second place.
//
// After apply-active-letterhead was fixed (3e41c502), run 34697159299 took
// the whole pipeline green — export-readiness ok=True READY blockers=0, ZIP
// verified against its persisted digest — and the delivered PDF still read:
//
//   === DELIVERED PDF ASSET AUDIT (35 pages, 221639 bytes) ===
//   EMBEDDED IMAGE XOBJECTS: 0
//     RESULT: the client's copy contains NO images at all.
//
// with the same three storage-backed assets in the vault. pdf-finalizer's
// resolveBrandImages selected `fileContent` alone, exactly as the letterhead
// applier once had, so the signature and stamp resolved to null and nothing
// was drawn. The PDF renders from the DOCX's extracted TEXT, so the PDF path
// is the ONLY way an image reaches the client — which makes this the
// difference between a signed, stamped proposal and an unsigned one.
//
// Generic: any vault whose assets persist to storage rather than inline, in
// any sector. Not one assertion here names a tender or a client.
describe("the PDF renderer reads storage-backed brand assets too", () => {
  it("the signature/stamp query selects storagePath, not just fileContent", () => {
    const at = PDF_SRC.indexOf('assetType: { in: ["SIGNATURE", "STAMP"] }');
    assert.ok(at > -1, "the brand-image lookup must still exist");
    const query = PDF_SRC.slice(at, at + 600);
    assert.match(query, /storagePath:\s*true/, "a stored signature cannot be found without selecting storagePath");
    assert.match(query, /fileContent:\s*true/, "inline bytes must still be read");
    assert.match(query, /originalFileName:\s*true/, "the adapter needs a file name");
  });

  it("it reads them through the same adapter, not a second path", () => {
    assert.match(PDF_SRC, /getStorageAdapter/, "must use the shared storage adapter");
    const at = PDF_SRC.indexOf("getStorageAdapter()");
    const call = PDF_SRC.slice(at, at + 400);
    assert.match(call, /getFile\(/);
    assert.match(call, /storagePath: asset\.storagePath/);
  });

  it("a storage read failure is logged, not silently treated as an absent asset", () => {
    const at = PDF_SRC.indexOf("brand asset is stored but unreadable");
    assert.ok(at > -1, "the storage failure must name itself");
    const region = PDF_SRC.slice(Math.max(0, at - 500), at + 300);
    assert.match(region, /catch/, "the read must be guarded");
    assert.match(region, /detail/, "the underlying error must be recorded");
  });

  it("both policy gates still decide whether an image may be drawn at all", () => {
    // The owner's rule: do not force signature or stamp unless the tender
    // permits or requires them. This fix changes where bytes come from, never
    // whether they are allowed.
    assert.match(PDF_SRC, /detectBrandingPolicy/);
    assert.match(PDF_SRC, /policy\.signatureAllowed && company\.settings\?\.allowSignatureDefault !== false/);
    assert.match(PDF_SRC, /policy\.stampAllowed && company\.settings\?\.allowStampDefault !== false/);
    assert.match(PDF_SRC, /pick\("SIGNATURE", signatureAllowed\)/);
    assert.match(PDF_SRC, /pick\("STAMP", stampAllowed\)/);
  });

  it("a mislabelled row still cannot reach pdf-lib", () => {
    // The PNG/JPEG signature check is the guard that keeps a renamed DOCX or
    // a text file out of embedPng/embedJpg. Reading from storage must not
    // bypass it — the check now runs on whichever source supplied the bytes.
    const at = PDF_SRC.indexOf("Only real image bytes");
    assert.ok(at > -1, "the signature check must still be there");
    const region = PDF_SRC.slice(at, at + 500);
    assert.match(region, /isPng/);
    assert.match(region, /isJpeg/);
    assert.match(region, /if \(!isPng && !isJpeg\) return null;/);
  });
});

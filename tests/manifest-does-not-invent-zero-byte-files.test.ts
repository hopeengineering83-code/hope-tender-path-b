/**
 * A validator may not judge bytes it never loaded.
 *
 * Reproduced live on a tender whose ZIP downloads (200, three DOCX, 30,404
 * bytes) and whose documents are stored VERIFIED with real contentByteLength.
 * GET /api/tenders/[id]/workflow-status answered BLOCKED with:
 *
 *   01-Expression-Of-Interest.docx: required file invalid
 *   01-Expression-Of-Interest.docx: zero-byte file
 *   01-Expression-Of-Interest.docx: invalid sha256
 *   ... and the same three for every other document
 *
 * while export-readiness, readiness-score, authority-review, the Export Hub
 * and the download itself all called the same package ready.
 *
 * The route's select deliberately omits fileContent - the column is multi-MB
 * per document and this is a polling surface. It then passed
 * `fileContent: null` into buildFinalPackageManifest, which cannot distinguish
 * "no bytes were loaded" from "the bytes are empty", measured every document
 * as 0 bytes with an empty hash, and let the strict validation publish that as
 * three hard blockers each.
 *
 * The fix is not to loosen the byte check. It is to stop making a byte claim
 * about bytes nobody read: the caller now declares contentLoaded: false, and
 * the two byte assertions are skipped while every other check still runs.
 * Where bytes ARE loaded the check is unchanged, which the last cases pin.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildFinalPackageManifest } from "../lib/engine/final-package-manifest";

const REAL_DOCX = Buffer.from("PK a stand-in for real docx bytes, comfortably over the minimum");

function docs(fileContent: string | null) {
  return [
    { id: "d1", exactFileName: "01-Expression-Of-Interest.docx", name: "EOI", fileContent, exactOrder: 1, generationStatus: "GENERATED" },
    { id: "d2", exactFileName: "02-Company-Profile.docx", name: "Profile", fileContent, exactOrder: 2, generationStatus: "GENERATED" },
    { id: "d3", exactFileName: "03-Capability-Statement.docx", name: "Capability", fileContent, exactOrder: 3, generationStatus: "GENERATED" },
  ];
}

describe("final package manifest with unloaded content", () => {
  it("does not call a document zero-byte because its bytes were not loaded", () => {
    const manifest = buildFinalPackageManifest(docs(null), { contentLoaded: false });

    assert.deepEqual(
      manifest.blockers,
      [],
      `no blocker may be raised from bytes that were never read; got ${JSON.stringify(manifest.blockers)}`,
    );
    assert.equal(manifest.ok, true);
    for (const phrase of ["zero-byte file", "invalid sha256", "required file invalid"]) {
      assert.ok(
        !manifest.blockers.some((b: string) => b.includes(phrase)),
        `must not report "${phrase}"`,
      );
    }
  });

  it("marks those items as unverified rather than as verified-empty", () => {
    const manifest = buildFinalPackageManifest(docs(null), { contentLoaded: false });
    assert.equal(manifest.items.length, 3);
    for (const item of manifest.items) {
      assert.equal(item.contentVerified, false, "the item states that no byte claim was made");
      assert.equal(item.problem, undefined, "and no byte-derived problem is invented");
    }
  });

  it("still catches everything that does not need bytes", () => {
    const duplicated = [
      { id: "d1", exactFileName: "Same-Name.docx", name: "A", fileContent: null, exactOrder: 1, generationStatus: "GENERATED" },
      { id: "d2", exactFileName: "Same-Name.docx", name: "B", fileContent: null, exactOrder: 2, generationStatus: "GENERATED" },
      { id: "d3", exactFileName: "Stale-Doc.docx", name: "C", fileContent: null, exactOrder: 3, generationStatus: "STALE" },
    ];
    const manifest = buildFinalPackageManifest(duplicated, { contentLoaded: false });
    assert.ok(manifest.blockers.some((b) => /duplicate filename/i.test(b)), "duplicates are still blocked");
    assert.ok(manifest.blockers.some((b) => /stale document/i.test(b)), "stale documents are still blocked");
    assert.equal(manifest.ok, false);
  });

  it("keeps the full byte check when the bytes ARE loaded", () => {
    // The guarantee this fix must not weaken. Same three documents, bytes
    // genuinely absent, content declared loaded - every blocker returns.
    const manifest = buildFinalPackageManifest(docs(null));
    assert.equal(manifest.ok, false);
    assert.ok(manifest.blockers.some((b) => /zero-byte file/i.test(b)), "an actually-empty document is still blocked");
    assert.ok(manifest.blockers.some((b) => /invalid sha256/i.test(b)));
    assert.ok(manifest.blockers.some((b) => /required file invalid/i.test(b)));
  });

  it("passes real bytes exactly as before", () => {
    const manifest = buildFinalPackageManifest(docs(REAL_DOCX.toString("base64")));
    assert.deepEqual(manifest.blockers, []);
    assert.equal(manifest.ok, true);
    for (const item of manifest.items) {
      assert.ok(item.byteSize > 0);
      assert.match(item.sha256, /^[a-f0-9]{64}$/);
      assert.equal(item.contentVerified, true);
    }
  });

  it("is how the polling route builds its manifest", () => {
    // The defect was at the call site, so the call site is pinned too.
    const source = require("node:fs").readFileSync("app/api/tenders/[id]/workflow-status/route.ts", "utf8");
    assert.match(source, /contentLoaded:\s*false/, "workflow-status must declare that it did not load the blob");
    assert.doesNotMatch(
      source,
      /generatedDocuments:\s*\{[^}]*select:[^}]*fileContent:\s*true/s,
      "and must not start loading multi-MB blobs on a status poll instead",
    );
  });
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  MAX_TENDER_PACKAGE_BYTES,
  MAX_TENDER_PACKAGE_FILES,
  MAX_TENDER_UPLOAD_FILE_BYTES,
  MAX_TENDER_UPLOAD_REQUEST_BYTES,
  MAX_TENDER_UPLOAD_REQUEST_FILES,
  partitionTenderUploadPackage,
  validateTenderPackageSelection,
} from "../lib/tender-upload-package";

const intakePage = readFileSync("app/dashboard/tenders/new/page.tsx", "utf8");
const sourcePanel = readFileSync("components/tender-source-files-panel.tsx", "utf8");
const serverSecurity = readFileSync("lib/upload-security.ts", "utf8");

describe("large tender package intake", () => {
  it("keeps the server request boundary unchanged", () => {
    assert.equal(MAX_TENDER_UPLOAD_REQUEST_FILES, 10);
    assert.equal(MAX_TENDER_UPLOAD_REQUEST_BYTES, 30 * 1024 * 1024);
    assert.match(serverSecurity, /MAX_UPLOAD_FILES = 10/);
    assert.match(serverSecurity, /MAX_UPLOAD_TOTAL_BYTES = 30 \* 1024 \* 1024/);
  });

  it("accepts a bounded package larger than one request", () => {
    const files = Array.from({ length: 11 }, (_, index) => ({ name: `document-${index}.txt`, size: 1024 }));
    assert.equal(validateTenderPackageSelection(files), null);
    const batches = partitionTenderUploadPackage(files);
    assert.deepEqual(batches.map((batch) => batch.length), [10, 1]);
  });

  it("partitions by aggregate request bytes as well as file count", () => {
    const files = Array.from({ length: 4 }, (_, index) => ({ name: `document-${index}.pdf`, size: 10 * 1024 * 1024 }));
    const batches = partitionTenderUploadPackage(files);
    assert.deepEqual(batches.map((batch) => batch.length), [3, 1]);
    for (const batch of batches) {
      assert.ok(batch.length <= MAX_TENDER_UPLOAD_REQUEST_FILES);
      assert.ok(batch.reduce((total, file) => total + file.size, 0) <= MAX_TENDER_UPLOAD_REQUEST_BYTES);
    }
  });

  it("rejects unsafe or excessive package selections before any request", () => {
    assert.equal(MAX_TENDER_PACKAGE_FILES, 50);
    assert.equal(MAX_TENDER_PACKAGE_BYTES, 150 * 1024 * 1024);
    assert.equal(MAX_TENDER_UPLOAD_FILE_BYTES, 10 * 1024 * 1024);

    assert.match(
      validateTenderPackageSelection(Array.from({ length: 51 }, (_, index) => ({ name: `${index}.txt`, size: 1 }))) ?? "",
      /no more than 50 files/,
    );
    assert.match(
      validateTenderPackageSelection([{ name: "oversized.pdf", size: MAX_TENDER_UPLOAD_FILE_BYTES + 1 }]) ?? "",
      /10 MB or smaller/,
    );
    assert.match(
      validateTenderPackageSelection([{ name: "legacy.doc", size: 100 }]) ?? "",
      /unsupported format/,
    );
    assert.match(
      validateTenderPackageSelection(Array.from({ length: 16 }, (_, index) => ({ name: `${index}.pdf`, size: 10 * 1024 * 1024 }))) ?? "",
      /exceeds 150 MB/,
    );
  });

  it("creates the tender from the first batch and appends later batches", () => {
    assert.match(intakePage, /partitionTenderUploadPackage\(files\)/);
    assert.match(intakePage, /const firstBatch = batches\[0\]/);
    assert.match(intakePage, /fetch\("\/api\/tenders\/upload-first"/);
    assert.match(intakePage, /const additionalBatches = batches\.slice\(1\)/);
    assert.match(intakePage, /appendTenderBatch\(\s*data\.tenderId,\s*batch,/);
    assert.match(intakePage, /fetch\("\/api\/upload"/);
    assert.match(intakePage, /body\.append\("tenderId", tenderId\)/);
    assert.match(intakePage, /intakeSessionIdRef/);
    assert.match(intakePage, /intakeManifest/);
  });

  it("redirects partial packages to a canonical source-file reconciliation notice", () => {
    assert.match(intakePage, /packageIntake: "1"/);
    assert.match(intakePage, /packageFailed: String\(failed\)/);
    assert.match(sourcePanel, /searchParams\.get\("packageIntake"\) === "1"/);
    assert.match(sourcePanel, /Large tender package intake completed/);
    assert.match(sourcePanel, /source-file list currently contains <strong>\{files\.length\}<\/strong>/);
    assert.match(sourcePanel, /AI Analyze becomes a manual action/);
    assert.match(sourcePanel, /activeIntakeSession/);
    assert.match(sourcePanel, /Choose expected batch/);
  });

  it("describes automatic extraction without crossing either manual gate", () => {
    assert.match(intakePage, /extracts documents automatically/);
    assert.match(intakePage, /manual action/);
    assert.match(intakePage, /Run Engine remains the next manual action/);
    assert.doesNotMatch(intakePage, /automatically queues AI analysis/);
    assert.doesNotMatch(intakePage, /Extracting and running engine/);
    assert.doesNotMatch(intakePage, /run analysis, and rank best-fit/);
  });
});

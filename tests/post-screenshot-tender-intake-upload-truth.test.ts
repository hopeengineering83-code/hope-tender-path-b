import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/dashboard/tenders/new/page.tsx", "utf8");

describe("screenshot-driven tender intake upload truth", () => {
  it("mirrors the server upload batch limits in the upload-first UI", () => {
    // The secure large-package batching donor incorporation raised the
    // user-facing selection limit to a 50-file/150MB package (validated by
    // lib/tender-upload-package.ts's shared constants), while preserving the
    // server's original 10-file/30MB per-request boundary internally via
    // partitionTenderUploadPackage batching — not a weakening of the limit,
    // just a package/request split. Assert the shared module is wired in and
    // the per-file/per-request boundaries it preserves are still stated.
    assert.match(
      source,
      /MAX_TENDER_PACKAGE_BYTES,\s*\n\s*MAX_TENDER_PACKAGE_FILES,\s*\n\s*MAX_TENDER_UPLOAD_FILE_BYTES,\s*\n\s*partitionTenderUploadPackage,\s*\n\s*validateTenderPackageSelection,\s*\n\s*\} from "..\/..\/..\/..\/lib\/tender-upload-package"/,
    );
    assert.match(source, /secure 10-file \/ 30-MB request boundary by uploading large packages in batches/);
  });

  it("keeps the upload action unavailable until a valid selection exists", () => {
    assert.match(source, /disabled=\{uploading \|\| files\.length === 0\}/);
    assert.match(source, /validateTenderPackageSelection\(files\)/);
    assert.match(source, /No tender documents selected/);
  });

  it("provides persistent labels, accessible status, errors, and removal controls", () => {
    assert.match(source, /htmlFor=\{fileInputId\}/);
    assert.match(source, /role="status" aria-live="polite"/);
    assert.match(source, /role="alert" aria-live="assertive"/);
    assert.match(source, /aria-label=\{`Remove \$\{file\.name\}`\}/);
    assert.match(source, /Clear selection/);
  });

  it("does not encourage blind retry when creation success is uncertain", () => {
    assert.match(source, /Check the tender list before retrying/);
    assert.match(source, /Tender intake completed without a tender identifier/);
    assert.match(source, /Tender creation returned no identifier/);
  });

  it("associates every manual intake label with a stable field id", () => {
    const ids = [
      "manual-tender-title",
      "manual-tender-reference",
      "manual-tender-client",
      "manual-tender-category",
      "manual-tender-country",
      "manual-tender-method",
      "manual-tender-deadline",
      "manual-tender-budget",
      "manual-tender-currency",
      "manual-tender-address",
      "manual-tender-description",
      "manual-tender-summary",
      "manual-tender-notes",
    ];

    for (const id of ids) {
      assert.ok(source.includes(`htmlFor=\"${id}\"`) || source.includes(`htmlFor="${id}"`), `missing label for ${id}`);
      assert.ok(source.includes(`id=\"${id}\"`) || source.includes(`id="${id}"`), `missing field id ${id}`);
    }
  });
});

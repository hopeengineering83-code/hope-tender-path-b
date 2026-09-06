import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";

describe("ZIP finalization — one production owner", () => {
  const route = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
  const assembler = readFileSync("lib/engine/final-zip-assembly.ts", "utf8");

  it("has the assertTenderReadyForGenerationAndExport gate", () => {
    assert.ok(route.includes("assertTenderReadyForGenerationAndExport"), "must have the central gate");
    assert.ok(route.includes('purpose: "final-zip"'), "must use final-zip purpose");
  });

  it("uses only the canonical assembler", () => {
    assert.equal(existsSync("lib/engine/workflow/zip-finalizer.ts"), false);
    assert.ok(route.includes("assembleFinalSubmissionZip"));
    assert.ok(assembler.includes("Duplicate filename in final ZIP"));
  });

  it("rejects path traversal", () => {
    assert.ok(assembler.includes("unsafe path"));
    assert.ok(assembler.includes('segment === ".."'));
  });

  it("checks export readiness before assembly", () => {
    assert.ok(route.includes("isReadyForFinalExport"));
    assert.ok(route.includes("checkExportReadiness"));
  });

  it("rejects bytes that do not match the extension signature", () => {
    assert.ok(route.includes("FILE_SIGNATURE_MISMATCH"));
    assert.ok(route.includes("validateFileSignature"));
  });

  it("verifies persisted byte integrity before assembly", () => {
    assert.ok(route.includes("verifyFileBytes"));
    assert.ok(route.includes("contentSha256"));
    assert.ok(route.includes("contentByteLength"));
  });

  it("persists and re-verifies the authoritative manifest", () => {
    assert.ok(route.includes("manifestJson: JSON.stringify(assembledZip.manifest)"));
    assert.ok(assembler.includes("entry.envelope"));
    assert.ok(assembler.includes("entry.format"));
    assert.ok(assembler.includes("reopenedEntry.async"));
    assert.ok(assembler.includes("exact-byte mismatch"));
  });
});

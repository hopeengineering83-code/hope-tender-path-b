import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fingerprintTenderPackageBatch,
  initialTenderPackageSessionResult,
  packageBatchKey,
  parseTenderPackageIntake,
  parseTenderPackageSessionResult,
} from "../lib/tender-package-intake-session";

function packageForm(args: {
  sessionId?: string;
  batchIndex?: number;
  manifest?: Array<Array<{ name: string; size: number }>>;
}) {
  const manifest = args.manifest ?? [
    [{ name: "rfp.txt", size: 3 }],
    [{ name: "addendum.txt", size: 4 }],
  ];
  const form = new FormData();
  form.set("intakeSessionId", args.sessionId ?? "ca076f5a-7386-4e40-9f45-10b4e23d15a2");
  form.set("intakeBatchIndex", String(args.batchIndex ?? 0));
  form.set("intakeExpectedBatches", String(manifest.length));
  form.set("intakeExpectedFiles", String(manifest.flat().length));
  form.set("intakeManifest", JSON.stringify(manifest));
  return form;
}

describe("durable tender package intake session", () => {
  it("validates the exact expected batch and returns a stable manifest hash", () => {
    const files = [new File(["rfp"], "rfp.txt", { type: "text/plain" })];
    const first = parseTenderPackageIntake(packageForm({}), files);
    const second = parseTenderPackageIntake(packageForm({}), files);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok || !first.descriptor || !second.descriptor) return;
    assert.equal(first.descriptor.batchIndex, 0);
    assert.equal(first.descriptor.manifestHash, second.descriptor.manifestHash);
  });

  it("rejects missing, reordered, oversized, and conflicting batch descriptors", () => {
    const wrongFile = [new File(["bad"], "different.txt", { type: "text/plain" })];
    const mismatch = parseTenderPackageIntake(packageForm({}), wrongFile);
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.code, "INTAKE_BATCH_MISMATCH");

    const invalidId = parseTenderPackageIntake(
      packageForm({ sessionId: "not-a-uuid" }),
      [new File(["rfp"], "rfp.txt", { type: "text/plain" })],
    );
    assert.equal(invalidId.ok, false);
    if (!invalidId.ok) assert.equal(invalidId.code, "INTAKE_SESSION_INVALID");

    const tooLarge = 10 * 1024 * 1024 + 1;
    const oversized = parseTenderPackageIntake(
      packageForm({ manifest: [[{ name: "huge.pdf", size: tooLarge }]] }),
      [new File([new Uint8Array(tooLarge)], "huge.pdf", { type: "application/pdf" })],
    );
    assert.equal(oversized.ok, false);
    if (!oversized.ok) assert.equal(oversized.code, "INTAKE_MANIFEST_INVALID");
  });

  it("binds retries to file bytes, names, sizes, and batch number", async () => {
    const a = [new File(["same"], "one.txt", { type: "text/plain" })];
    const b = [new File(["changed"], "one.txt", { type: "text/plain" })];
    assert.equal(await fingerprintTenderPackageBatch(a), await fingerprintTenderPackageBatch(a));
    assert.notEqual(await fingerprintTenderPackageBatch(a), await fingerprintTenderPackageBatch(b));
    assert.equal(
      packageBatchKey("ca076f5a-7386-4e40-9f45-10b4e23d15a2", 3),
      "ca076f5a-7386-4e40-9f45-10b4e23d15a2:3",
    );
  });

  it("tracks received and missing batches without claiming analysis is queued", () => {
    const parsed = parseTenderPackageIntake(
      packageForm({}),
      [new File(["rfp"], "rfp.txt", { type: "text/plain" })],
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok || !parsed.descriptor) return;
    const result = initialTenderPackageSessionResult(parsed.descriptor, 1);
    assert.deepEqual(result.receivedBatchIndexes, [0]);
    assert.deepEqual(result.missingBatchIndexes, [1]);
    assert.equal(result.analysisJobId, null);
    assert.deepEqual(parseTenderPackageSessionResult(result), result);
  });

  it("wires the canonical workflow ledger and never invents an intake AiJob type", () => {
    const first = readFileSync("lib/tender-upload-first.ts", "utf8");
    const append = readFileSync("lib/secure-upload-handler.ts", "utf8");
    const session = readFileSync("lib/tender-package-intake-session.ts", "utf8");
    const page = readFileSync("app/dashboard/tenders/new/page.tsx", "utf8");
    const panel = readFileSync("components/tender-source-files-panel.tsx", "utf8");

    assert.match(first, /TENDER_PACKAGE_INTAKE_OPERATION/);
    assert.match(first, /existing tender package intake was recovered without creating a duplicate tender/i);
    assert.match(append, /beginTenderPackageBatch/);
    assert.match(append, /completeTenderPackageBatch/);
    assert.match(session, /FOR UPDATE/);
    assert.match(session, /idempotencyKey: \{ startsWith:/);
    assert.doesNotMatch(session, /jobType:\s*["']INTAKE_SESSION/);
    assert.match(page, /crypto\.randomUUID\(\)/);
    assert.match(page, /intakeManifest/);
    assert.match(panel, /Select the next .* expected file/);
    assert.match(panel, /analysis stays blocked until all/);
  });
});

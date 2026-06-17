import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { parseJobTypeFilter, SUPPORTED_JOB_TYPES } from "../lib/job-type-policy";

describe("tender intake and AI analysis regression guards", () => {
  it("accepts only supported queue job types", () => {
    for (const jobType of SUPPORTED_JOB_TYPES) {
      assert.deepEqual(parseJobTypeFilter(jobType), { ok: true, value: jobType });
    }
    assert.deepEqual(parseJobTypeFilter(null), { ok: true });
    assert.deepEqual(parseJobTypeFilter("UNKNOWN_JOB"), { ok: false, code: "INVALID_JOB_TYPE" });
    assert.deepEqual(parseJobTypeFilter("engine_run"), { ok: false, code: "INVALID_JOB_TYPE" });
  });

  it("uses parameterized queue claims", () => {
    const source = readFileSync("lib/job-claim-policy.ts", "utf8");
    assert.equal(source.includes("queryRawUnsafe"), false);
    assert.match(source, /Prisma\.sql/);
    assert.match(source, /Prisma\.join/);
  });

  it("routes upload-first through secure validation and atomic persistence", () => {
    const route = readFileSync("app/api/tenders/upload-first/route.ts", "utf8");
    const handler = readFileSync("lib/tender-upload-first.ts", "utf8");
    // RI-002: no upload route may mutate storage env vars per-request. The
    // storage policy is owned centrally by lib/storage.ts so both upload
    // routes behave identically. A per-request `process.env.ALLOW_DB_FILE_STORAGE`
    // assignment here previously caused one route to work while another failed.
    assert.doesNotMatch(route, /process\.env\.ALLOW_DB_FILE_STORAGE\s*=/);
    assert.match(route, /handleUploadFirstTender/);
    assert.match(handler, /validateUploadBatch/);
    assert.match(handler, /validateUploadFile/);
    assert.match(handler, /requireRole\("ADMIN",\s*"PROPOSAL_MANAGER"\)/);
    assert.match(handler, /TENDER_SOURCE_UPLOAD_FAILED/);
    assert.match(handler, /prisma\.\$transaction/);
    assert.match(handler, /storedUploads\.length !== files\.length/);
  });
});

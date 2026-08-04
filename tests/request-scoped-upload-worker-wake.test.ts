import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const codeOnly = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");
const helper = read("lib/ai-jobs/request-scoped-worker-wake.ts");
const helperCode = codeOnly(helper);
const uploadRoute = read("app/api/upload/route.ts");
const uploadFirstRoute = read("app/api/tenders/upload-first/route.ts");
const capabilitiesRoute = read("app/api/auth/workflow-capabilities/route.ts");
const readinessRoute = read("app/api/company/ingestion-readiness/route.ts");

describe("request-scoped upload worker wake", () => {
  it("permits only the two automatic upload-owned stages", () => {
    assert.match(helperCode, /RequestScopedUploadJobType = "EXTRACT_TEXT" \| "VAULT_INGEST"/);
    assert.doesNotMatch(helperCode, /"AI_ANALYZE"|"ENGINE_RUN"|"PROPOSAL_GENERATION"/);
  });

  it("uses Next after and forwards only the authenticated same-origin session", () => {
    assert.match(helper, /import \{ after \} from "next\/server"/);
    assert.match(helper, /const cookie = req\.headers\.get\("cookie"\)/);
    assert.match(helper, /new URL\("\/api\/ai-jobs\/run-next", requestUrl\.origin\)/);
    assert.match(helper, /headers: \{[\s\S]*cookie,[\s\S]*origin,[\s\S]*referer,/);
    assert.doesNotMatch(helperCode, /AI_JOBS_WORKER_SECRET|CRON_SECRET|x-worker-secret/);
  });

  it("bounds concurrent multi-file wakes to the ten-file request limit", () => {
    assert.match(helper, /MAX_REQUEST_SCOPED_WAKE_COUNT = 10/);
    assert.match(helper, /Math\.min\(MAX_REQUEST_SCOPED_WAKE_COUNT/);
    assert.match(helper, /Promise\.all\(Array\.from\(\{ length: count \}/);
  });

  it("starts the complete first tender batch after upload-first persists jobs", () => {
    assert.match(uploadFirstRoute, /response\.clone\(\)\.json/);
    assert.match(uploadFirstRoute, /pipelineStage === "EXTRACT_TEXT_QUEUED"/);
    assert.match(uploadFirstRoute, /queuedExtractionFiles \?\? 1/);
    assert.match(uploadFirstRoute, /scheduleRequestScopedWorkerWake\(req, "EXTRACT_TEXT",/);
  });

  it("starts existing-tender extraction and Company Vault ingestion after secure upload", () => {
    assert.match(uploadRoute, /pipelineStage === "EXTRACT_TEXT_QUEUED"/);
    assert.match(uploadRoute, /queuedTenderFiles/);
    assert.match(uploadRoute, /scheduleRequestScopedWorkerWake\(req, "EXTRACT_TEXT", queuedTenderFiles\)/);
    assert.match(uploadRoute, /companyImport\?\.status === "QUEUED"/);
    assert.match(uploadRoute, /scheduleRequestScopedWorkerWake\(req, "VAULT_INGEST"\)/);
  });

  it("recovers already-queued tenant jobs from normal authenticated status checks", () => {
    assert.match(capabilitiesRoute, /canMutateTender[\s\S]*scheduleRequestScopedWorkerWake\(req, "EXTRACT_TEXT", 10\)/);
    assert.match(readinessRoute, /getSession\(\)/);
    assert.match(readinessRoute, /pendingDocuments > 0/);
    assert.match(readinessRoute, /scheduleRequestScopedWorkerWake\(req, "VAULT_INGEST"\)/);
  });
});

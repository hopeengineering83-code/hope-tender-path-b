import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const helper = read("lib/ai-jobs/request-scoped-worker-wake.ts");
const uploadRoute = read("app/api/upload/route.ts");
const uploadFirstRoute = read("app/api/tenders/upload-first/route.ts");
const capabilitiesRoute = read("app/api/auth/workflow-capabilities/route.ts");
const readinessRoute = read("app/api/company/ingestion-readiness/route.ts");

describe("request-scoped upload worker wake", () => {
  it("permits only the two automatic upload-owned stages", () => {
    assert.match(helper, /RequestScopedUploadJobType = "EXTRACT_TEXT" \| "VAULT_INGEST"/);
    assert.doesNotMatch(helper, /AI_ANALYZE|ENGINE_RUN|PROPOSAL_GENERATION/);
  });

  it("uses Next after and forwards only the authenticated same-origin session", () => {
    assert.match(helper, /import \{ after \} from "next\/server"/);
    assert.match(helper, /const cookie = req\.headers\.get\("cookie"\)/);
    assert.match(helper, /new URL\("\/api\/ai-jobs\/run-next", requestUrl\.origin\)/);
    assert.match(helper, /headers: \{[\s\S]*cookie,[\s\S]*origin,[\s\S]*referer,/);
    assert.doesNotMatch(helper, /AI_JOBS_WORKER_SECRET|CRON_SECRET|x-worker-secret/);
  });

  it("starts tender extraction after upload-first persists the durable job", () => {
    assert.match(uploadFirstRoute, /response\.clone\(\)\.json/);
    assert.match(uploadFirstRoute, /pipelineStage === "EXTRACT_TEXT_QUEUED"/);
    assert.match(uploadFirstRoute, /scheduleRequestScopedWorkerWake\(req, "EXTRACT_TEXT"\)/);
  });

  it("starts existing-tender extraction and Company Vault ingestion after secure upload", () => {
    assert.match(uploadRoute, /pipelineStage === "EXTRACT_TEXT_QUEUED"/);
    assert.match(uploadRoute, /scheduleRequestScopedWorkerWake\(req, "EXTRACT_TEXT"\)/);
    assert.match(uploadRoute, /companyImport\?\.status === "QUEUED"/);
    assert.match(uploadRoute, /scheduleRequestScopedWorkerWake\(req, "VAULT_INGEST"\)/);
  });

  it("recovers already-queued tenant jobs from normal authenticated status checks", () => {
    assert.match(capabilitiesRoute, /canMutateTender[\s\S]*scheduleRequestScopedWorkerWake\(req, "EXTRACT_TEXT"\)/);
    assert.match(readinessRoute, /getSession\(\)/);
    assert.match(readinessRoute, /scheduleRequestScopedWorkerWake\(req, "VAULT_INGEST"\)/);
  });
});

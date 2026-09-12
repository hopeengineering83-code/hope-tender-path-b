import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("AI Analyze UI fails closed on canonical source readiness", () => {
  const panel = source("components/ai-analyze-panel.tsx");

  assert.match(panel, /\/source-readiness/);
  assert.match(panel, /readiness\?\.analysisReady === true/);
  assert.match(panel, /readiness\?\.analysisCurrent === true/);
  assert.match(panel, /Canonical source readiness could not be verified\. AI Analyze remains disabled\./);
  assert.doesNotMatch(panel, /extractionComplete\s*&&\s*sourceIntegrityValid/);
  assert.doesNotMatch(panel, /analysisAlreadySucceeded\)\)/);
});

test("Run Engine UI is bound to the exact current Engine source revision", () => {
  const panel = source("components/matching-selected-evidence-panel.tsx");
  const route = source("app/api/tenders/[id]/engine-readiness/route.ts");

  assert.match(panel, /\/engine-readiness/);
  assert.match(panel, /readiness\?\.canRunEngine === true/);
  assert.match(panel, /readiness\?\.analysisCurrent === true/);
  assert.doesNotMatch(panel, /canMutate\s*&&\s*analysisComplete\s*&&/);

  assert.match(route, /computeEngineSourceRevision/);
  assert.match(route, /analysisInputHash:\s*sourceRevision/);
  assert.match(route, /status:\s*\{\s*in:\s*\[\.\.\.ACTIVE_ENGINE_STATUSES\]/s);
  assert.match(route, /code:\s*"TENDER_NOT_FOUND"/);
  assert.match(route, /canRunEngine:\s*analysisCurrent\s*&&\s*Boolean\(sourceRevision\)/);
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTenderAction, listTenderActions } from "../lib/ui/action-registry";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("action registry matches production route owners", () => {
  it("uses the real durable AI Analyze background contract", () => {
    const route = read("app/api/tenders/[id]/ai-analyze/route.ts");
    const panel = read("components/ai-analyze-panel.tsx");
    assert.match(route, /export async function POST/);
    assert.match(route, /searchParams\.get\("mode"\)\s*===\s*"background"/);
    assert.match(panel, /ai-analyze\?mode=background/);
    assert.equal(getTenderAction("AI_ANALYZE").mutation, "POST /api/tenders/:id/ai-analyze?mode=background");
  });

  it("uses the real safe background Engine contract", () => {
    const route = read("app/api/tenders/[id]/engine/route.ts");
    assert.match(route, /export async function POST/);
    assert.match(route, /searchParams\.get\("async"\)\s*===\s*"true"/);
    assert.match(route, /searchParams\.get\("safe"\)\s*===\s*"true"/);
    assert.equal(getTenderAction("RUN_ENGINE").mutation, "POST /api/tenders/:id/engine?async=true&safe=true");
  });

  it("does not invent a POST matching endpoint", () => {
    const route = read("app/api/tenders/[id]/matches/route.ts");
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function PUT/);
    assert.doesNotMatch(route, /export async function POST/);
    assert.equal(getTenderAction("MATCH_EVIDENCE").mutation, null);
  });

  it("keeps authority review as navigation because the route is read-only", () => {
    const route = read("app/api/tenders/[id]/authority-review/route.ts");
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /export async function POST/);
    assert.equal(getTenderAction("FINAL_APPROVAL").mutation, null);
    assert.equal(getTenderAction("FINAL_APPROVAL").owner, "AuthorityReviewPanel");
  });

  it("points Final ZIP to the one gated download owner", () => {
    const route = read("app/api/tenders/[id]/download/route.ts");
    const panel = read("components/export-readiness-panel.tsx");
    assert.match(route, /export async function GET/);
    assert.match(route, /type=zip/);
    assert.match(panel, /download\?type=zip/);
    assert.equal(getTenderAction("DOWNLOAD_FINAL_ZIP").mutation, "GET /api/tenders/:id/download?type=zip");
    assert.equal(getTenderAction("DOWNLOAD_FINAL_ZIP").owner, "ExportReadinessPanel");
  });

  it("contains no known nonexistent workflow mutation paths", () => {
    const mutations = listTenderActions().flatMap(([, action]) => action.mutation ? [action.mutation] : []);
    const joined = mutations.join("\n");
    assert.doesNotMatch(joined, /ai-analyze\?async=true/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/match(?:\s|$)/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/approval(?:\s|$)/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/export\/zip/);
  });
});

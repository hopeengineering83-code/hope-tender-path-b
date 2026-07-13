import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/tenders/[id]/approve-analysis/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

describe("approve-analysis safe runtime errors", () => {
  it("keeps exception-derived detail out of POST and DELETE responses", () => {
    assert.doesNotMatch(source, /sanitizeError/);
    assert.doesNotMatch(source, /detail:\s*(?:error|message|sanitizeError)/);
    assert.doesNotMatch(source, /error:\s*`[^`]*\$\{(?:error|message)/);
    assert.match(source, /ANALYSIS_APPROVAL_RUNTIME_ERROR/);
    assert.match(source, /requestId/);
  });

  it("logs only correlated server-side error class diagnostics", () => {
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /approve-analysis POST failed/);
    assert.match(source, /approve-analysis DELETE failed/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
  });

  it("keeps fallback approval audit-only and release-blocked", () => {
    assert.match(source, /auditOnly: true/);
    assert.match(source, /does NOT authorize generation, export, download, regeneration, AI proposal, missing-file generation, or ZIP/i);
    assert.match(source, /recordFallbackApproval/);
    assert.match(source, /resolveCurrentAnalysisBinding/);
  });

  it("keeps mutation roles restricted to ADMIN and PROPOSAL_MANAGER", () => {
    const roleMatches = source.match(/requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/g) ?? [];
    assert.equal(roleMatches.length, 2);
    assert.doesNotMatch(source, /requireRole\([^)]*"REVIEWER"/);
    assert.doesNotMatch(source, /requireRole\([^)]*"VIEWER"/);
  });

  it("keeps Vercel Git deployments enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Executable proof: human-approved regex fallback remains audit-only and cannot
// unlock generation, regeneration, PDF, export, download, or ZIP.
// ─────────────────────────────────────────────────────────────────────────────

describe("human-approved regex fallback is audit-only and release-blocked", () => {
  it("canGenerateFromState returns false for HUMAN_APPROVED_FALLBACK", async () => {
    // Import the actual state-resolver to prove at runtime that the
    // HUMAN_APPROVED_FALLBACK state does not authorize generation.
    const { canGenerateFromState } = await import(join(rootDir, "lib/ai-analyze/state-resolver.ts"));
    assert.equal(canGenerateFromState("HUMAN_APPROVED_FALLBACK"), false,
      "HUMAN_APPROVED_FALLBACK must NOT authorize generation");
  });

  it("canGenerateFromState returns true ONLY for AI_SUCCEEDED", async () => {
    const { canGenerateFromState } = await import(join(rootDir, "lib/ai-analyze/state-resolver.ts"));
    assert.equal(canGenerateFromState("AI_SUCCEEDED"), true);
    // Every other state must return false.
    for (const state of [
      "NOT_STARTED", "QUEUED", "RUNNING", "PARTIAL_NEEDS_RESUME",
      "REGEX_FALLBACK_UNAPPROVED", "HUMAN_APPROVED_FALLBACK",
      "FAILED", "SUPERSEDED",
    ]) {
      assert.equal(canGenerateFromState(state as any), false,
        `${state} must NOT authorize generation`);
    }
  });

  it("the approve-analysis route records fallback as auditOnly: true and cannot unlock gates", () => {
    // The route must explicitly mark the fallback as audit-only.
    assert.match(source, /auditOnly: true/);
    // The route must NOT set canGenerate, canExport, canDownload, or canRegenerate
    // to true for the fallback.
    assert.doesNotMatch(source, /canGenerate: true/);
    assert.doesNotMatch(source, /canExport: true/);
    assert.doesNotMatch(source, /canDownload: true/);
    // The description must explicitly state it does not authorize downstream actions.
    assert.match(source, /does NOT authorize generation, export, download, regeneration, AI proposal, missing-file generation, or ZIP/i);
  });
});

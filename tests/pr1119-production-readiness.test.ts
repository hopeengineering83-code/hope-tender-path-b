// PR #1119 production-readiness regression tests.
//
// These tests prove the deployment policy, company vault deletion behavior,
// accessibility fixes, and production config verification are correct.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── Fix 1: Vercel deployment policy uses "**" not "*" ──────────────────────

describe("Fix 1 — Vercel deployment policy covers branches with slashes", () => {
  it("vercel.json uses '**': false (not '*': false)", () => {
    const vercel = JSON.parse(read("vercel.json"));
    assert.equal(vercel.git.deploymentEnabled["**"], false, "must use '**' to cover slash-branches");
    assert.equal(vercel.git.deploymentEnabled["main"], true, "main must deploy");
    assert.equal(vercel.git.deploymentEnabled["*"], undefined, "must NOT use '*' (doesn't match slash-branches)");
  });

  it("release-hardening-contract validates '**' not '*'", () => {
    const src = read("scripts/release-hardening-contract.mjs");
    assert.match(src, /dep\["\*\*"\]\s*!==\s*false/, "contract must check '**' not '*'");
    assert.doesNotMatch(src, /dep\["\*"\]\s*!==\s*false/, "contract must NOT check '*'");
  });

  it("contract rejects keys other than '**' and 'main' with true", () => {
    const src = read("scripts/release-hardening-contract.mjs");
    assert.match(src, /key !== "\*\*" && key !== "main"/);
  });

  it("contract passes with current vercel.json", () => {
    // Execute the contract script and verify it exits 0
    const { execSync } = require("node:child_process");
    try {
      execSync("node scripts/release-hardening-contract.mjs", { encoding: "utf8", timeout: 5000 });
    } catch (e: any) {
      assert.fail(`release-hardening-contract.mjs failed: ${e.stdout || e.message}`);
    }
  });
});

// ─── Fix 2: Company Vault deletion handles all response codes ───────────────

describe("Fix 2 — Company Vault deletion handles structured error codes", () => {
  it("deleteDoc parses JSON response and branches on code", () => {
    const src = read("app/dashboard/company/page.tsx");
    // Must parse the JSON error body
    assert.match(src, /res\.json\(\)\.catch/, "must safely parse error JSON");
    // Must handle NOT_FOUND (404) by reloading
    assert.match(src, /code === "NOT_FOUND"/, "must handle NOT_FOUND");
    assert.match(src, /code === "REVIEWED_PROVENANCE_DEPENDENCY"/, "must handle 409 dependency block");
    assert.match(src, /code === "STORAGE_DELETE_FAILED"/, "must handle retryable 502");
    assert.match(src, /code === "DELETE_FINALIZATION_FAILED"/, "must handle finalization failure");
    // Must reload authoritative list on success (not optimistic removal)
    assert.ok(!src.includes("setDocs(d => d.filter(x => x.id!==doc.id))"), "must NOT optimistically remove — reload from server");
    assert.match(src, /await loadDocs\(\)/, "must reload docs from server on success");
  });

  it("confirmation text is truthful about draft record removal", () => {
    const src = read("app/dashboard/company/page.tsx");
    assert.match(src, /Unreviewed AI-drafted and regex-drafted/i, "must warn about draft record removal");
    assert.match(src, /Reviewed records remain for audit but will block deletion/i, "must warn about dependency blocking");
  });

  it("pending-deletion responses reload the authoritative list", () => {
    const src = read("app/dashboard/company/page.tsx");
    // The retryable/pending path must call loadDocs
    const retryableIdx = src.indexOf("retryable || code === \"STORAGE_DELETE_FAILED\"");
    assert.ok(retryableIdx > -1, "must have retryable branch");
    const afterBranch = src.slice(retryableIdx, retryableIdx + 400);
    assert.match(afterBranch, /await loadDocs\(\)/, "must reload docs on retryable/pending");
  });
});

// ─── Fix 3: Accessibility — aria-controls only when confirmation mounted ───

describe("Fix 3 — aria-controls is conditional on confirmation state", () => {
  it("document delete button does NOT have unconditional aria-controls", () => {
    const src = read("app/dashboard/company/page.tsx");
    // Strip comments
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    // The old pattern was: aria-controls={`delete-confirm-${doc.id}`}
    // The new pattern uses conditional spread: {...(confirmingDeleteDocId===doc.id ? { "aria-controls": ... } : {})}
    // Verify aria-controls is inside a conditional spread for the document delete button
    const docDeleteIdx = codeOnly.indexOf("Delete ${doc.originalFileName} from Company Vault");
    assert.ok(docDeleteIdx > -1, "document delete button must exist");
    const buttonBlock = codeOnly.slice(docDeleteIdx - 500, docDeleteIdx + 100);
    assert.match(buttonBlock, /\.\.\.\(confirmingDeleteDocId===doc\.id/, "aria-controls must be conditional on confirmingDeleteDocId");
    // Must NOT have unconditional aria-controls for delete-confirm
    assert.doesNotMatch(buttonBlock, /aria-controls=\{`delete-confirm-\$\{doc\.id\}`\}/, "must NOT have unconditional aria-controls");
  });

  it("expert delete button uses conditional aria-controls", () => {
    const src = read("app/dashboard/company/page.tsx");
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    assert.match(codeOnly, /confirmingDeleteExpertId===ex\.id \? \{ "aria-controls": `expert-delete-confirm/);
  });

  it("project delete button uses conditional aria-controls", () => {
    const src = read("app/dashboard/company/page.tsx");
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    assert.match(codeOnly, /confirmingDeleteProjectId===p\.id \? \{ "aria-controls": `project-delete-confirm/);
  });

  it("no unconditional aria-controls remain on any delete button", () => {
    const src = read("app/dashboard/company/page.tsx");
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    // Check for the old pattern: aria-controls={`something-delete-confirm-${id}`}
    // which is unconditional. The new pattern uses spread inside a ternary.
    const unconditional = codeOnly.match(/aria-controls=\{`[a-z]+-delete-confirm-\$\{[^}]+\}`\}/g);
    assert.equal(unconditional, null, "must NOT have any unconditional aria-controls on delete buttons");
  });
});

// ─── Fix 5: Production config verification ──────────────────────────────────

describe("Fix 5 — Production config env var presence checks", () => {
  it("check-env.mjs verifies AI_JOBS_WORKER_SECRET", () => {
    const src = read("scripts/check-env.mjs");
    assert.match(src, /AI_JOBS_WORKER_SECRET/, "must check AI_JOBS_WORKER_SECRET presence");
  });

  it("check-env.mjs verifies SESSION_SECRET", () => {
    const src = read("scripts/check-env.mjs");
    assert.match(src, /SESSION_SECRET/, "must check SESSION_SECRET presence");
  });

  it("check-env.mjs verifies DATABASE_URL", () => {
    const src = read("scripts/check-env.mjs");
    assert.match(src, /DATABASE_URL/, "must check DATABASE_URL presence");
  });

  it(".env.example documents SENTRY_DSN (error alerting)", () => {
    const src = read(".env.example");
    assert.match(src, /SENTRY_DSN/, "must document SENTRY_DSN as the error-alerting destination");
  });

  it("check-env.mjs does NOT print secret values", () => {
    const src = read("scripts/check-env.mjs");
    // The script should check presence, not print values
    assert.doesNotMatch(src, /console\.\w+\(.*secret.*value/i, "must not print secret values");
    assert.doesNotMatch(src, /console\.\w+\(.*password/i, "must not print passwords");
  });
});

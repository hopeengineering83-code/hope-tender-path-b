import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Tests for round-2 audit fixes (GAP-R2C-2, GAP-R2C-3, GAP-R2C-4).
 *
 * These are the REAL gaps found by the 3-round audit that were NOT covered
 * by any open PR. Each test verifies the fix is present and structurally
 * correct.
 */

// ─── GAP-R2C-2: deleteCookieSession must log DB failures ───────────────────
//
// Before the fix, deleteCookieSession silently swallowed DB errors with a
// bare `catch {}`. If the DB had a transient blip during logout, the
// session row survived in the DB — a stolen cookie remained valid for up
// to SESSION_TTL_DAYS (14 days). The fix logs at error level so operators
// can detect session-replay attempts.

test("GAP-R2C-2: deleteCookieSession logs DB failures at error level (not silent)", () => {
  const authPath = path.join(process.cwd(), "lib/auth.ts");
  const src = fs.readFileSync(authPath, "utf8");

  // Find deleteCookieSession function body.
  const fnStart = src.indexOf("async function deleteCookieSession(");
  assert.ok(fnStart > -1, "deleteCookieSession must exist in lib/auth.ts");
  const fnBody = src.slice(fnStart, fnStart + 2000);

  // MUST NOT have a bare `catch {}` (silent swallow).
  // The old code had `catch {` with only a comment inside.
  assert.ok(
    !fnBody.includes("catch {\n    // Cookie removal must still proceed"),
    "deleteCookieSession must NOT silently swallow DB errors with a bare catch {}. " +
    "The old code made session-replay attacks invisible to operators."
  );

  // MUST log at error level (not warn, not info).
  assert.ok(
    fnBody.includes("logger.error"),
    "deleteCookieSession must log DB failures at ERROR level so operators " +
    "can detect session-replay attempts. The previous bare-catch made this gap invisible."
  );

  // The log message must mention SESSION_TTL_DAYS or session-replay risk.
  assert.ok(
    fnBody.includes("SESSION_TTL_DAYS") || fnBody.includes("stolen"),
    "The error log must mention the session-replay risk (SESSION_TTL_DAYS or stolen cookie) " +
    "so operators understand the severity."
  );
});

// ─── GAP-R2C-3: forgot-password must be timing-safe ────────────────────────
//
// Before the fix, existing emails triggered a DB transaction + sendEmail
// (~300-800ms), while non-existent emails returned immediately (~5ms). An
// attacker could enumerate accounts by timing. The fix adds a dummy bcrypt
// comparison for non-existent emails to equalize timing.

test("GAP-R2C-3: forgot-password adds timing-equalization for non-existent emails", () => {
  const forgotPath = path.join(
    process.cwd(),
    "app/api/auth/forgot-password/route.ts"
  );
  const src = fs.readFileSync(forgotPath, "utf8");

  // The non-existent-user path must include a timing-equalization workload.
  assert.ok(
    src.includes("bcrypt") && src.includes("dummy"),
    "forgot-password must run a dummy bcrypt comparison for non-existent emails " +
    "to equalize timing with the existing-email path. Without this, an attacker " +
    "can enumerate accounts by response timing (existing → slow, non-existent → fast)."
  );

  // The dummy bcrypt must be in the `if (!user)` branch.
  const ifNotUserIdx = src.indexOf("if (!user)");
  assert.ok(ifNotUserIdx > -1, "must have an `if (!user)` branch");
  const branchBody = src.slice(ifNotUserIdx, ifNotUserIdx + 800);

  assert.ok(
    branchBody.includes("bcrypt"),
    "The dummy bcrypt comparison must be INSIDE the `if (!user)` branch " +
    "(the non-existent-email path), not in the existing-user path."
  );

  // Must mention timing/account-enumeration in comments.
  assert.ok(
    src.includes("enumeration") || src.includes("timing"),
    "The fix must document the timing-equalization rationale in comments."
  );
});

// ─── GAP-R2C-4: reimport must skip PENDING_DELETE documents ────────────────
//
// Before the fix, the reimport route queried CompanyDocument WITHOUT
// filtering PENDING_DELETE. A tombstoned document (deleted but storage
// delete pending) would be re-extracted and re-imported, RE-CREATING the
// draft experts/projects that the deletion had already destroyed. The
// user's deletion was silently undone.

test("GAP-R2C-4: company reimport route excludes PENDING_DELETE documents", () => {
  const reimportPath = path.join(
    process.cwd(),
    "app/api/company/reimport/route.ts"
  );
  const src = fs.readFileSync(reimportPath, "utf8");

  // Must import the PENDING_DELETE marker.
  assert.ok(
    src.includes("COMPANY_DOCUMENT_PENDING_DELETE_MARKER"),
    "reimport route must import COMPANY_DOCUMENT_PENDING_DELETE_MARKER " +
    "so it can exclude tombstoned documents from re-extraction."
  );

  // The findMany query must filter out PENDING_DELETE.
  assert.ok(
    src.includes("NOT: { metadata: { contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER } }"),
    "reimport route's findMany must exclude PENDING_DELETE documents via " +
    "NOT: { metadata: { contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER } }. " +
    "Without this, reimport resurrects deleted documents' experts/projects."
  );
});

test("GAP-R2C-4: company-knowledge-import-safe also excludes PENDING_DELETE", () => {
  const importPath = path.join(
    process.cwd(),
    "lib/company-knowledge-import-safe.ts"
  );
  const src = fs.readFileSync(importPath, "utf8");

  // Both findMany calls must filter PENDING_DELETE.
  const markerCount = (src.match(/COMPANY_DOCUMENT_PENDING_DELETE_MARKER/g) || []).length;
  assert.ok(
    markerCount >= 3, // 1 import + 2 findMany usages
    `company-knowledge-import-safe.ts must use COMPANY_DOCUMENT_PENDING_DELETE_MARKER ` +
    `in BOTH findMany calls (importCompanyKnowledgeFromDocuments AND analyzeCompanyKnowledgeGaps). ` +
    `Found ${markerCount} occurrences (expected ≥3: 1 import + 2 usages).`
  );
});

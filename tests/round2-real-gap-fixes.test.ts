import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test("GAP-R2C-2: deleteCookieSession logs DB failures at error level (not silent)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "lib/auth.ts"), "utf8");
  const fnStart = src.indexOf("async function deleteCookieSession(");
  assert.ok(fnStart > -1, "deleteCookieSession must exist in lib/auth.ts");
  const fnBody = src.slice(fnStart, fnStart + 2000);
  assert.ok(!fnBody.includes("catch {\n    // Cookie removal must still proceed"));
  assert.ok(fnBody.includes("logger.error"));
  assert.ok(fnBody.includes("SESSION_TTL_DAYS") || fnBody.includes("stolen"));
});

test("GAP-R2C-3: forgot-password adds timing-equalization for non-existent emails", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/api/auth/forgot-password/route.ts"),
    "utf8",
  );
  assert.ok(src.includes("bcrypt") && src.includes("dummy"));
  const ifNotUserIdx = src.indexOf("if (!user)");
  assert.ok(ifNotUserIdx > -1);
  assert.ok(src.slice(ifNotUserIdx, ifNotUserIdx + 800).includes("bcrypt"));
  assert.ok(src.includes("enumeration") || src.includes("timing"));
});

test("GAP-R2C-4: company reimport route excludes PENDING_DELETE documents", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/api/company/reimport/route.ts"),
    "utf8",
  );
  assert.match(src, /COMPANY_DOCUMENT_PENDING_DELETE_MARKER/);
  assert.match(src, /NOT: \{ metadata: \{ contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER \} \}/);
});

test("GAP-R2C-4: the compatibility importer delegates to the canonical tombstone-safe ingestion owner", () => {
  const wrapper = fs.readFileSync(
    path.join(process.cwd(), "lib/company-knowledge-import-safe.ts"),
    "utf8",
  );
  const canonical = fs.readFileSync(
    path.join(process.cwd(), "lib/company-vault-ingestion.ts"),
    "utf8",
  );

  assert.match(wrapper, /return ingestCompanyVault\(companyId\)/);
  assert.doesNotMatch(wrapper, /companyDocument\.findMany/);
  assert.match(canonical, /COMPANY_DOCUMENT_PENDING_DELETE_MARKER/);
  assert.match(canonical, /NOT: \{ metadata: \{ contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER \} \}/);
});

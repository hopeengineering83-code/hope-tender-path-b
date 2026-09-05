// TEMPORARY — owner-authorized, single-use verification script for the
// temporary-preview-migration job in .github/workflows/lockfile-refresh-artifact.yml.
// Delete alongside that job once the migration is verified applied. See PR #1175.
import { databaseFingerprint } from "../lib/database-fingerprint.ts";

const actual = databaseFingerprint(process.env.DATABASE_URL);
const expected = process.env.EXPECTED_FINGERPRINT;
console.log(`Actual fingerprint:   ${actual}`);
console.log(`Expected fingerprint: ${expected}`);
if (actual !== expected) {
  console.error("FINGERPRINT MISMATCH — refusing to migrate a database that does not match the confirmed target.");
  process.exit(1);
}
console.log("Fingerprint verified. Proceeding.");

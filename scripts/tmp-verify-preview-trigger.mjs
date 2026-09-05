// TEMPORARY — owner-authorized, single-use verification script for the
// temporary-preview-migration job in .github/workflows/lockfile-refresh-artifact.yml.
// Delete alongside that job once the migration is verified applied. See PR #1175.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`
  SELECT pg_get_triggerdef(t.oid) AS def
  FROM pg_trigger t
  WHERE t.tgname = 'invalidate_auto_requirement_coverage'
    AND t.tgrelid = '"GeneratedDocument"'::regclass
`;
console.log(JSON.stringify(rows, null, 2));
const def = rows[0]?.def ?? "";
const hasWhenClause = /WHEN \(/.test(def) && /contentSha256/.test(def) && /generationStatus/.test(def);
if (!hasWhenClause) {
  console.error("Trigger definition does not contain the expected narrowed WHEN clause.");
  process.exit(1);
}
console.log("Trigger definition verified narrowed.");
await prisma.$disconnect();

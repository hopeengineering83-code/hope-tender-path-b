// TEMPORARY — owner-authorized, single-use verification script for the
// temporary-preview-migration job in .github/workflows/lockfile-refresh-artifact.yml.
// Delete alongside that job once the migration is verified applied. See PR #1175.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rows = await prisma.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = '20260904180000_narrow_generated_document_coverage_invalidation'`;
console.log(JSON.stringify(rows, null, 2));
if (rows.length === 0 || !rows[0].finished_at || rows[0].rolled_back_at) {
  console.error("Migration is not recorded as cleanly finished.");
  process.exit(1);
}
await prisma.$disconnect();

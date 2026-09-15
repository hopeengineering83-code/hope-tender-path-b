// TEMPORARY — read-only. What does the target database actually contain?
//
// `prisma migrate deploy` refuses a database with P3005 ("the database schema
// is not empty") when it finds objects in the schema but no _prisma_migrations
// history. That single error covers two situations that need opposite
// treatments:
//
//   * a fresh database carrying only stray or provider-default objects, which
//     should be cleared so the committed migrations can run from scratch; and
//   * a database that already holds real records, which must be baselined and
//     never cleared.
//
// Guessing between them risks destroying evidence, so this prints the objects
// and, where the application's own tables exist, their row counts. It performs
// no writes.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const tables = await prisma.$queryRawUnsafe(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
  );
  const views = await prisma.$queryRawUnsafe(
    "select table_name from information_schema.views where table_schema = 'public' order by table_name",
  );
  const enums = await prisma.$queryRawUnsafe(
    "select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e' order by t.typname",
  );
  const extensions = await prisma.$queryRawUnsafe("select extname from pg_extension order by extname");
  const schemas = await prisma.$queryRawUnsafe(
    "select nspname from pg_namespace where nspname not like 'pg\\\\_%' and nspname <> 'information_schema' order by nspname",
  );

  console.log(`SCHEMAS: ${schemas.map((s) => s.nspname).join(", ") || "(none)"}`);
  console.log(`EXTENSIONS: ${extensions.map((e) => e.extname).join(", ") || "(none)"}`);
  console.log(`ENUM TYPES in public: ${enums.length}`);
  for (const e of enums) console.log(`  - ${e.typname}`);
  console.log(`VIEWS in public: ${views.length}`);
  for (const v of views) console.log(`  - ${v.table_name}`);
  console.log(`BASE TABLES in public: ${tables.length}`);
  for (const t of tables) console.log(`  - ${t.table_name}`);

  // Row counts matter more than names: an empty table is clutter, a populated
  // one is evidence. Counted individually so one unreadable table cannot hide
  // the rest.
  if (tables.length > 0) {
    console.log("ROW COUNTS:");
    let populated = 0;
    for (const t of tables) {
      const name = t.table_name;
      try {
        const rows = await prisma.$queryRawUnsafe(`select count(*)::int as n from "public"."${name}"`);
        const n = rows?.[0]?.n ?? 0;
        if (n > 0) populated += 1;
        console.log(`  ${String(n).padStart(8)}  ${name}`);
      } catch (error) {
        console.log(`  ${"?".padStart(8)}  ${name}  (${error.message.split("\n")[0]})`);
      }
    }
    console.log(`TABLES HOLDING ROWS: ${populated} of ${tables.length}`);
  }

  const hasMigrationHistory = tables.some((t) => t.table_name === "_prisma_migrations");
  console.log(`_prisma_migrations present: ${hasMigrationHistory}`);
} finally {
  await prisma.$disconnect();
}

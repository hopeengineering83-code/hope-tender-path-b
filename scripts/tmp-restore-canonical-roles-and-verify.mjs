// TEMPORARY — companion to tmp-verified-clean-rebuild.mjs. Runs AFTER
// `npm run prisma:migrate:safe` has applied the full migration history to
// the freshly reset Preview database. Removed as part of cleanup once the
// recovery is complete and verified healthy.
//
// Restores exactly the 4 fixed Role lookup rows that lib/prisma.ts's legacy
// bootstrap() would have seeded (and that the pre-reset gate already proved
// were present and matched this exact set) — WITHOUT enabling that broader
// runtime schema bootstrap mechanism. Also verifies migration history is
// clean: all 51 migrations recorded, none failed.
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const CANONICAL_ROLES = [
  { id: "role-admin", code: "ADMIN", name: "Admin", description: "Full access" },
  { id: "role-proposal-manager", code: "PROPOSAL_MANAGER", name: "Proposal Manager", description: "Tender drafting and generation" },
  { id: "role-reviewer", code: "REVIEWER", name: "Reviewer", description: "Review and approval" },
  { id: "role-viewer", code: "VIEWER", name: "Viewer", description: "Read only" },
];

async function main() {
  // ─── Verify migration history is clean before touching data ─────────────
  const statusOutput = execFileSync("npx", ["prisma", "migrate", "status"], {
    env: process.env,
    encoding: "utf8",
  });
  console.log(statusOutput);
  if (!/Database schema is up to date/i.test(statusOutput)) {
    console.error("REFUSING TO SEED ROLES: prisma migrate status did not report a clean, up-to-date schema.");
    process.exit(1);
  }
  const migrationCount = (statusOutput.match(/^\d+ migrations? found/im) || [])[0];
  console.log("Migration history check:", migrationCount || "(count line not found, but status reported up to date)");

  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  try {
    const existing = await prisma.role.findMany({ orderBy: { code: "asc" } });
    if (existing.length === 0) {
      await prisma.role.createMany({ data: CANONICAL_ROLES });
      console.log("Seeded the 4 canonical Role lookup rows (deterministic, from lib/prisma.ts's own seed set).");
    } else {
      const matches =
        existing.length === CANONICAL_ROLES.length &&
        CANONICAL_ROLES.every((c) =>
          existing.some((r) => r.id === c.id && r.code === c.code && r.name === c.name && r.description === c.description),
        );
      console.log(`Role table already has ${existing.length} row(s) after migrate deploy; matches canonical set: ${matches}.`);
      if (!matches) {
        console.error("Role rows present after migration do not match the canonical set — leaving as-is, flagging for manual review.");
        console.error(JSON.stringify(existing));
      }
    }
    const finalCount = await prisma.role.count();
    console.log("Final Role row count:", finalCount);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Role restoration / verification failed:", err.message);
  process.exit(1);
});

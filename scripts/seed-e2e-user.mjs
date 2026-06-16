/**
 * Seed an isolated E2E test user for authenticated workflow tests.
 *
 * Reads credentials from E2E_TEST_EMAIL / E2E_TEST_PASSWORD env vars.
 * Always uses a non-production bcrypt cost to keep CI fast.
 * Idempotent: silently exits if the user already exists.
 *
 * Must NOT run in production (guard below).
 */

import { execFileSync } from "node:child_process";

if (process.env.NODE_ENV === "production" && !process.env.ALLOW_E2E_SEED_IN_PRODUCTION) {
  console.error("ERROR: seed-e2e-user must not run against a production database.");
  process.exit(1);
}

const email = process.env.E2E_TEST_EMAIL || "e2e-release-integrity@example.test";
const password = process.env.E2E_TEST_PASSWORD || "E2E-release-integrity-password-2026";

// Use tsx to run the TypeScript seed helper so we can reuse PrismaClient + bcryptjs
// from the project's own dependencies rather than re-implementing them here.
const script = `
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const email = ${JSON.stringify(email)};
const password = ${JSON.stringify(password)};

async function main() {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('[e2e-seed] User already exists:', email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name: 'E2E Release Integrity',
      email,
      passwordHash,
      role: 'ADMIN',
      company: {
        create: {
          name: 'E2E Test Organisation',
          description: 'Isolated workspace for release integrity E2E tests',
        },
      },
    },
  });
  console.log('[e2e-seed] Created E2E user:', user.email);
}

main().catch((err) => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
`;

// Write the inline script to a temp file and run via tsx
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = join(tmpdir(), `seed-e2e-${Date.now()}.ts`);
try {
  writeFileSync(tmp, script, "utf8");
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", tmp],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
} finally {
  try { unlinkSync(tmp); } catch {}
}

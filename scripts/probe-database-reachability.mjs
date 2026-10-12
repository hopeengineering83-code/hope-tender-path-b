// Report, at build time, whether the configured database can actually be
// reached — and never fail the build for it.
//
// Why this exists
// ---------------
// Preview builds are compile-and-test only: they skip migrations by policy so
// they can never mutate the shared production database. A consequence nobody
// noticed until it cost a day: the preview build never touches the database at
// all, so a DATABASE_URL pointing at an endpoint that no longer exists produces
// a completely clean, READY deployment. The first sign of trouble is a human
// clicking sign-in and getting a 503.
//
// That is what happened. Production's DATABASE_URL was updated to a new Neon
// endpoint and Preview's — a separately scoped value — was left on the old one.
// Both builds were green. Only Preview's runtime was broken.
//
// This probe is deliberately NON-FATAL. Preview is build-only by design, and a
// build that fails on an unreachable database would block every pull request on
// a condition only the project owner can fix. Its job is to put the answer in
// the build log at the moment the value is baked in, so the next occurrence is
// diagnosed in seconds instead of from runtime logs.
//
// It prints the HOST, never the credentials.

import { PrismaClient } from "@prisma/client";

const PROBE_TIMEOUT_MS = 8_000;

function safeHost(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "[unparseable DATABASE_URL]";
  }
}

function redact(value) {
  let text = String(value ?? "");
  for (const secret of [process.env.DATABASE_URL, process.env.DIRECT_URL, process.env.MIGRATE_DATABASE_URL]) {
    if (secret) text = text.split(secret).join("[REDACTED_DATABASE_URL]");
  }
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi, "[REDACTED_CREDENTIAL_URI]@");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.warn("[db-probe] DATABASE_URL is not set for this build; skipping reachability probe.");
  process.exit(0);
}

const host = safeHost(databaseUrl);
const prisma = new PrismaClient();
let timer;

try {
  await Promise.race([
    prisma.$queryRaw`SELECT 1`,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`probe timed out after ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS);
    }),
  ]);
  console.log(`[db-probe] Database reachable at ${host}.`);
} catch (error) {
  const detail = redact(error instanceof Error ? error.message : String(error));
  console.warn("──────────────────────────────────────────────────────────────");
  console.warn(`[db-probe] THIS DEPLOYMENT CANNOT REACH ITS DATABASE: ${host}`);
  console.warn("[db-probe] The build will continue and will deploy successfully,");
  console.warn("[db-probe] but sign-in, AI jobs and /api/health will fail at runtime.");
  console.warn("[db-probe] Check that DATABASE_URL for THIS environment scope");
  console.warn("[db-probe] (Preview and Production are set separately) points at a");
  console.warn("[db-probe] live endpoint.");
  console.warn(`[db-probe] Probe error: ${detail.slice(0, 300)}`);
  console.warn("──────────────────────────────────────────────────────────────");
} finally {
  clearTimeout(timer);
  await prisma.$disconnect().catch(() => {});
}

process.exit(0);

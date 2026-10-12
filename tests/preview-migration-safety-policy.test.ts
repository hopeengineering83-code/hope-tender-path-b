// Preview builds never mutate a database automatically. Any Preview migration
// requires explicit, fingerprint-bound maintenance against a proven isolated
// Preview database.
//
// WHY THIS FILE EXISTS
// --------------------
// A preview build runs from an unmerged branch. If it migrated whatever
// database its DATABASE_URL happens to point at, it would advance that schema
// ahead of the code actually deployed against it — and a build has no way to
// prove, from inside itself, which database that is.
//
// That is not a theoretical hazard. Two committed migrations, applied together,
// hash every TenderShare token and then NULL the plaintext column:
//
//   20260817120000  UPDATE "TenderShare" SET "tokenHash" = encode(digest("token", 'sha256'), 'hex')
//   20260817140000  UPDATE "TenderShare" SET "token" = NULL WHERE "tokenHash" IS NOT NULL ...
//
// while code that has not yet shipped the hashed-token lookup still resolves a
// share with `prisma.tenderShare.findUnique({ where: { token } })`. Applying
// those migrations ahead of that code would break every existing share link.
// Schema and code have to advance together.
//
// An earlier revision of this header asserted, as current environment truth,
// that Preview and Production share one DATABASE_URL. Preview and Production
// are separate databases today, and that stale claim caused later sessions to
// reason about the wrong hazard. The correct invariant does not depend on the
// answer: an automatic build must not migrate, because it cannot establish
// which database it holds. Deliberate maintenance can, by proving the target
// database's fingerprint before it mutates anything.
//
// So the skip is deliberate, and ALLOW_PREVIEW_DB_MIGRATIONS is deliberately
// not set for this project. These tests pin the two properties that keep the
// skip trustworthy: it must cover every non-production environment, and when it
// skips it must say what the operator will observe as a result.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

// Read the source with comments stripped: the assertions are about what the
// script DOES, and the prose above each guard necessarily quotes the very
// patterns being forbidden.
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const MIGRATE_SAFE = code("scripts/migrate-deploy-safe.mjs");

describe("the preview migration skip covers every non-production environment", () => {
  it("treats any Vercel environment that is not production as preview-class", () => {
    // Testing VERCEL_ENV === "preview" alone left "development" — and any
    // environment name Vercel may add later — migrating unguarded, while
    // scripts/vercel-build.mjs had always expressed the rule as not-production.
    // The two now say the same thing in the same words.
    assert.match(MIGRATE_SAFE, /vercelEnvironment !== "production"/);
    assert.doesNotMatch(
      MIGRATE_SAFE,
      /VERCEL_ENV === "preview"/,
      "an equality test against one environment name is narrower than the rule it implements",
    );
  });

  it("still refuses by default, opt-in absent", () => {
    assert.match(MIGRATE_SAFE, /allowPreviewMigrations/);
    assert.match(
      MIGRATE_SAFE,
      /if \(isVercelPreview && !allowPreviewMigrations\)/,
      "the default must be to skip; migrating requires an explicit opt-in",
    );
    assert.match(MIGRATE_SAFE, /process\.exit\(0\)/);
  });
});

describe("the skip explains itself", () => {
  it("names the precondition for ever enabling it", () => {
    assert.match(MIGRATE_SAFE, /isolated preview database/i);
    assert.match(MIGRATE_SAFE, /ALLOW_PREVIEW_DB_MIGRATIONS=true to enable preview migrations/);
  });

  it("names what the operator will see while it stays skipped", () => {
    // Without this the operator watches sign-in fail on a preview and has no
    // way to connect it to a deliberate build-time decision.
    assert.match(
      MIGRATE_SAFE,
      /AUTH_DATABASE_SCHEMA_OUTDATED/,
      "the skip message must name the symptom it causes",
    );
  });

  it("reports which environment triggered the skip", () => {
    assert.match(MIGRATE_SAFE, /Vercel environment: \$\{vercelEnvironment/);
  });
});

// Live-database companion to bootstrap-admin-security.test.ts and
// prisma-bootstrap-policy.test.ts (which pin the policy by source
// inspection / pure-function calls). This exercises the actual
// lib/prisma.ts bootstrap() side effect against real PostgreSQL:
// admin@hope.local is created only when BOOTSTRAP_ADMIN_ENABLED + a strong
// BOOTSTRAP_ADMIN_PASSWORD are set, only when the account does not already
// exist, and a second bootstrap() call never resets its password.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for bootstrap admin seed DB-integration tests.");
  process.exit(1);
}

const ENV_KEYS = ["NODE_ENV", "BOOTSTRAP_ADMIN_ENABLED", "BOOTSTRAP_ADMIN_PASSWORD"] as const;
type EnvSnapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;
const mutableEnv = process.env as Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
  return ENV_KEYS.reduce<EnvSnapshot>((acc, key) => {
    acc[key] = process.env[key];
    return acc;
  }, {} as EnvSnapshot);
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = snap[key];
  }
}

const STRONG_PASSWORD = "Tr0ub4dor&3-correct-horse-integration";
const BOOTSTRAP_ADMIN_EMAIL = "admin@hope.local";
const BOOTSTRAP_ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const BOOTSTRAP_COMPANY_ID = "00000000-0000-0000-0000-000000000002";

describe("lib/prisma.ts bootstrap() — live admin seed side effect", () => {
  let outerSnap: EnvSnapshot;

  before(async () => {
    outerSnap = snapshotEnv();
    // Force non-production so isRuntimeSchemaBootstrapEnabled() proceeds
    // past the production-only verify-and-return-early gate (Gap 6) --
    // production additionally requires ENABLE_RUNTIME_SCHEMA_BOOTSTRAP,
    // a separate, broader flag intentionally not exercised here.
    mutableEnv.NODE_ENV = "test";
    // Clean slate: remove any admin@hope.local left over from a prior run
    // of this file (or a real bootstrap that happened to fire earlier in
    // this same test process) so "create only when missing" is genuinely
    // exercised, not trivially satisfied.
    const { prisma, prismaReady } = await import("../lib/prisma");
    await prismaReady;
    await prisma.company.deleteMany({ where: { id: BOOTSTRAP_COMPANY_ID } });
    await prisma.user.deleteMany({ where: { email: BOOTSTRAP_ADMIN_EMAIL } });
  });

  after(async () => {
    const { prisma } = await import("../lib/prisma");
    await prisma.company.deleteMany({ where: { id: BOOTSTRAP_COMPANY_ID } });
    await prisma.user.deleteMany({ where: { email: BOOTSTRAP_ADMIN_EMAIL } });
    restoreEnv(outerSnap);
  });

  it("does not create admin@hope.local when BOOTSTRAP_ADMIN_ENABLED is unset", async () => {
    const { prisma, bootstrap } = await import("../lib/prisma");
    delete mutableEnv.BOOTSTRAP_ADMIN_ENABLED;
    delete mutableEnv.BOOTSTRAP_ADMIN_PASSWORD;

    await bootstrap(prisma);

    const admin = await prisma.user.findUnique({ where: { email: BOOTSTRAP_ADMIN_EMAIL } });
    assert.equal(admin, null, "admin@hope.local must not exist without explicit opt-in");
  });

  it("does not create admin@hope.local when BOOTSTRAP_ADMIN_PASSWORD is weak", async () => {
    const { prisma, bootstrap } = await import("../lib/prisma");
    mutableEnv.BOOTSTRAP_ADMIN_ENABLED = "true";
    mutableEnv.BOOTSTRAP_ADMIN_PASSWORD = "short-pw";

    await bootstrap(prisma);

    const admin = await prisma.user.findUnique({ where: { email: BOOTSTRAP_ADMIN_EMAIL } });
    assert.equal(admin, null, "a weak BOOTSTRAP_ADMIN_PASSWORD must never seed the account");
  });

  it("creates admin@hope.local with role ADMIN and the policy password when explicitly enabled with a strong password", async () => {
    const { prisma, bootstrap } = await import("../lib/prisma");
    const bcrypt = (await import("bcryptjs")).default;
    mutableEnv.BOOTSTRAP_ADMIN_ENABLED = "true";
    mutableEnv.BOOTSTRAP_ADMIN_PASSWORD = STRONG_PASSWORD;

    await bootstrap(prisma);

    const admin = await prisma.user.findUnique({ where: { email: BOOTSTRAP_ADMIN_EMAIL } });
    assert.ok(admin, "admin@hope.local must be created when explicitly enabled with a strong password");
    assert.equal(admin!.id, BOOTSTRAP_ADMIN_ID);
    assert.equal(admin!.role, "ADMIN");
    assert.equal(await bcrypt.compare(STRONG_PASSWORD, admin!.passwordHash), true);

    const company = await prisma.company.findUnique({ where: { id: BOOTSTRAP_COMPANY_ID } });
    assert.ok(company, "the bootstrap admin's company record must be created alongside the user");
    assert.equal(company!.userId, BOOTSTRAP_ADMIN_ID);
  });

  it("does not reset the password or recreate the account on a second bootstrap() call", async () => {
    const { prisma, bootstrap } = await import("../lib/prisma");
    const bcrypt = (await import("bcryptjs")).default;
    const before = await prisma.user.findUnique({ where: { email: BOOTSTRAP_ADMIN_EMAIL } });
    assert.ok(before, "precondition: admin@hope.local must already exist from the prior test");

    // Simulate an operator forgetting to unset the bootstrap env vars after
    // first use, and simulate a changed env password too -- create-only-
    // when-missing must ignore both.
    mutableEnv.BOOTSTRAP_ADMIN_ENABLED = "true";
    mutableEnv.BOOTSTRAP_ADMIN_PASSWORD = "Different-Str0ng-Password-99!!";

    await bootstrap(prisma);

    const after1 = await prisma.user.findUnique({ where: { email: BOOTSTRAP_ADMIN_EMAIL } });
    assert.ok(after1);
    assert.equal(after1!.passwordHash, before!.passwordHash, "an existing bootstrap admin's password must never be reset by a later bootstrap() call");
    assert.equal(await bcrypt.compare(STRONG_PASSWORD, after1!.passwordHash), true, "the original bootstrap password must still be the one that authenticates");
    assert.equal(await bcrypt.compare("Different-Str0ng-Password-99!!", after1!.passwordHash), false, "the new env password must have no effect once the account exists");

    const companyCount = await prisma.company.count({ where: { id: BOOTSTRAP_COMPANY_ID } });
    assert.equal(companyCount, 1, "the bootstrap company must not be duplicated on a second call");
  });
});

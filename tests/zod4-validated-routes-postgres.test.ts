// Zod 3 → 4 migration (dependency-security PR): the four modules that import zod
// (lib/env.ts, the manual requirement create/update routes, and the Plan-B import route)
// exercised through the real route handlers on real PostgreSQL. It pins the behaviour the
// application relies on so the major upgrade cannot change it silently:
//   - valid partial updates are accepted and unknown keys are stripped (never persisted);
//   - invalid enums, types and lengths are refused with 400 and structured issues
//     (path + code + message), using Zod 4's issue codes;
//   - array caps (.max) still refuse oversized Plan-B payloads before any write.
// Invented data only.
//
// Not covered here: a VALID manual-requirement create. On main that route always passes
// `linkedProposalSection` to prisma.tenderRequirement.create, a field TenderRequirement does not
// have, so Prisma rejects every valid create ("Unknown argument `linkedProposalSection`") after
// validation succeeds, under Zod 3 as well. That is a separate pre-existing defect, reported with
// the dependency PR; manual rows for the update tests are therefore created directly.
import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for the Zod 4 route tests.");
  process.exit(1);
}

let cookieStore: Record<string, string> = {};
const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => cookieStore[name] ? { name, value: cookieStore[name] } : undefined,
    set: (name: string, value: string) => { cookieStore[name] = value; },
    delete: (name: string) => { delete cookieStore[name]; },
    getAll: () => Object.entries(cookieStore).map(([name, value]) => ({ name, value })),
  }),
  headers: async () => new Headers(),
};
const Module = require("module");
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "next/headers") return (require.resolve as any).__zod4_next_headers_mock_path || "";
  return originalResolve.call(this, request, ...args);
};
const mockModulePath = "__zod4_next_headers_mock__";
require.cache[mockModulePath] = {
  id: mockModulePath, filename: mockModulePath, loaded: true, exports: nextHeadersMock, paths: [], children: [], parent: null,
} as any;
(require.resolve as any).__zod4_next_headers_mock_path = mockModulePath;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("A test session secret of at least 32 characters is required");
  return secret;
}

async function signIn(userId: string) {
  cookieStore = {};
  const expiresAt = new Date(Date.now() + 86400 * 1000);
  const payload = { userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(24).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${encoded}.${createHmac("sha256", sessionSecret()).update(encoded).digest("base64url")}`;
  await prisma.session.create({ data: { token: createHash("sha256").update(token).digest("hex"), userId, expiresAt } });
  cookieStore.hope_session = token;
}

const run = randomUUID().slice(0, 8);
let userId = "";
let tenderId = "";
let routes: {
  create: typeof import("../app/api/tenders/[id]/requirements/route");
  update: typeof import("../app/api/tenders/[id]/requirements/[requirementId]/route");
  planB: typeof import("../app/api/company/plan-b-import/route");
};

const valid = {
  title: "Invented eligibility requirement", description: "Invented description for a manual entry.",
  requirementType: "ELIGIBILITY", priority: "MANDATORY", reason: "Owner entered this from the invented tender notice.",
};

async function createRequirement(body: unknown) {
  const response = await routes.create.POST(
    new Request(`https://tender.example/api/tenders/${tenderId}/requirements`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }) as any,
    { params: Promise.resolve({ id: tenderId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function updateRequirement(requirementId: string, body: unknown) {
  const response = await routes.update.PATCH(
    new Request(`https://tender.example/api/tenders/${tenderId}/requirements/${requirementId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }) as any,
    { params: Promise.resolve({ id: tenderId, requirementId }) },
  );
  return { status: response.status, body: await response.json() };
}

before(async () => {
  await prismaReady;
  routes = {
    create: await import("../app/api/tenders/[id]/requirements/route"),
    update: await import("../app/api/tenders/[id]/requirements/[requirementId]/route"),
    planB: await import("../app/api/company/plan-b-import/route"),
  };
  const user = await prisma.user.create({ data: { email: `zod4-${run}@zod4-routes.test`, passwordHash: "x", role: "ADMIN" } });
  userId = user.id;
  const tender = await prisma.tender.create({ data: { userId, title: `Invented tender ${run}` } });
  tenderId = tender.id;
  await signIn(userId);
});

after(async () => {
  // The canonical-requirement guard allows removing a tender's last requirements only inside a
  // tender deletion (migration 20260629000000): the same transaction-local context the app sets.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tender_deletion_context', ${tenderId}, true)`;
    await tx.tenderRequirement.deleteMany({ where: { tenderId } });
    await tx.tender.deleteMany({ where: { id: tenderId } });
  });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });   // sessions cascade
  await prisma.$disconnect();
});

describe("zod 4: the validated routes keep their contract (real PostgreSQL)", () => {
  it("runs on zod 4.6.6 or later (the patched release)", () => {
    const version = require("zod/package.json").version as string;
    const [major, minor, patch] = version.split(".").map(Number);
    assert.ok(major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6))), `zod ${version}`);
  });

  it("refuses invalid enums, types and lengths with structured Zod 4 issues", async () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ ...valid, priority: "URGENT" }, "priority", "invalid_value"],
      [{ ...valid, requirementType: "BRIBERY" }, "requirementType", "invalid_value"],
      [{ ...valid, sourceOrigin: "SOURCE_GROUNDED" }, "sourceOrigin", "invalid_value"],
      [{ ...valid, exactOrder: "3" }, "exactOrder", "invalid_type"],
      [{ ...valid, title: "x".repeat(501) }, "title", "too_big"],
      [{ ...valid, reason: "" }, "reason", "too_small"],
      [{ ...valid, title: undefined }, "title", "invalid_type"],
    ];
    for (const [body, path, code] of cases) {
      const answer = await createRequirement(body);
      assert.equal(answer.status, 400, `${path}: ${JSON.stringify(answer.body)}`);
      assert.equal(answer.body.error, "Invalid requirement data");
      const issue = answer.body.issues.find((item: any) => item.path.join(".") === path);
      assert.ok(issue, `an issue for ${path}`);
      assert.equal(issue.code, code, path);
      assert.equal(typeof issue.message, "string");
    }
  });

  it("validates partial updates: refuses bad fields, accepts good ones and strips unknown keys", async () => {
    const row = await prisma.tenderRequirement.create({ data: {
      tenderId, title: valid.title, description: valid.description, requirementType: "ELIGIBILITY",
      priority: "MANDATORY", sourceExtractionMethod: "MANUAL", sourceConfidence: 0,
    } });
    const bad = await updateRequirement(row.id, { exactOrder: "first", priority: "URGENT" });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "Invalid update data");
    assert.deepEqual(bad.body.issues.map((item: any) => `${item.path.join(".")}:${item.code}`).sort(),
                     ["exactOrder:invalid_type", "priority:invalid_value"]);
    const good = await updateRequirement(row.id, { title: "Invented title, edited", pageLimit: null, exactOrder: 2,
                                                   tenderId: "someone-elses-tender", sourceExactQuote: "INVENTED" });
    assert.equal(good.status, 200, JSON.stringify(good.body));
    const after = await prisma.tenderRequirement.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.title, "Invented title, edited");
    assert.equal(after.exactOrder, 2);
    assert.equal(after.pageLimit, null);
    assert.equal(after.tenderId, tenderId, "an unknown key never reaches the database");
    assert.equal(after.sourceExactQuote, null);
  });

  it("refuses an oversized Plan-B payload by its array cap, before any write", async () => {
    const experts = Array.from({ length: 5001 }, (_, i) => ({ fullName: `Invented Expert ${i}` }));
    const response = await routes.planB.POST(new Request("https://tender.example/api/company/plan-b-import", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ experts }),
    }));
    const body = await response.json();
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 300));
    assert.match(body.error, /Invalid Plan-B payload/);
    assert.deepEqual(body.validationIssues.map((item: any) => `${item.path}:${item.code}`), ["experts:too_big"]);
    assert.equal(await prisma.auditLog.count({ where: { userId, action: { contains: "PLAN_B" } } }), 0);
  });

  it("refuses a Plan-B payload with a wrongly typed field and reports where", async () => {
    const response = await routes.planB.POST(new Request("https://tender.example/api/company/plan-b-import", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ importPolicy: { trustLevel: "TRUST_ME" }, projects: [{ name: 42 }] }),
    }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.deepEqual(body.validationIssues.map((item: any) => `${item.path}:${item.code}`).sort(),
                     ["importPolicy.trustLevel:invalid_value", "projects.0.name:invalid_type"]);
  });
});

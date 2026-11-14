// Real-PostgreSQL proof for the read-only service grant (lib/service-access.ts, migration
// 20261113180000_service_access_grants) through the actual route handlers:
//   - a grant reads ONLY its own tenant's tenders, and ONLY the minimal fields;
//   - confidential values (client details, budget, notes, job input/output/errors) never appear;
//   - missing/unknown/revoked/expired tokens and deleted tenants are refused alike;
//   - only the token's hash is stored; database CHECKs refuse other audiences/scopes/expiries;
//   - grants are created/revoked only by their own ADMIN/PROPOSAL_MANAGER owner, rate-limited;
//   - a service token is not a browser session.
import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for service access grant route tests.");
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
};
const Module = require("module");
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "next/headers") return (require.resolve as any).__service_grant_next_headers_mock_path || "";
  return originalResolve.call(this, request, ...args);
};
const mockModulePath = "__service_grant_next_headers_mock__";
require.cache[mockModulePath] = {
  id: mockModulePath, filename: mockModulePath, loaded: true, exports: nextHeadersMock, paths: [], children: [], parent: null,
} as any;
(require.resolve as any).__service_grant_next_headers_mock_path = mockModulePath;

const SESSION_COOKIE = "hope_session";
const SECRET_MARKERS = ["SECRET-CLIENT-NAME", "SECRET-NOTES", "SECRET-DESCRIPTION", "SECRET-JOB-INPUT",
                        "SECRET-JOB-OUTPUT", "SECRET-JOB-ERROR", "SECRET-ANALYSIS", "987654321"];

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("A test session secret of at least 32 characters is required");
  return secret;
}

async function signIn(userId: string | null) {
  cookieStore = {};
  if (!userId) return;
  const expiresAt = new Date(Date.now() + 86400 * 1000);
  const payload = { userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(24).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${encoded}.${createHmac("sha256", sessionSecret()).update(encoded).digest("base64url")}`;
  await prisma.session.create({ data: { token: createHash("sha256").update(token).digest("hex"), userId, expiresAt } });
  cookieStore[SESSION_COOKIE] = token;
}

type Routes = {
  status: typeof import("../app/api/service/v1/tender-status/route");
  grants: typeof import("../app/api/settings/service-grants/route");
  grant: typeof import("../app/api/settings/service-grants/[id]/route");
  summary: typeof import("../app/api/tenders/summary/route");
};
let routes: Routes;
const run = randomUUID().slice(0, 8);
const users: Record<string, string> = {};
const tenders: Record<string, string> = {};

async function read(token: string | null, address = "203.0.113.10") {
  const headers: Record<string, string> = { "x-forwarded-for": address };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const response = await routes.status.GET(new Request("https://tender.example/api/service/v1/tender-status", { headers }));
  return { status: response.status, body: await response.json(), raw: response };
}

async function issue(as: string, body: Record<string, unknown> = { label: "HOPE ONE AGENT", days: 30 }) {
  await signIn(users[as]);
  const response = await routes.grants.POST(new Request("https://tender.example/api/settings/service-grants", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as any);
  return { status: response.status, body: await response.json() };
}

async function revoke(as: string, id: string) {
  await signIn(users[as]);
  const response = await routes.grant.DELETE(new Request(`https://tender.example/api/settings/service-grants/${id}`,
                                                         { method: "DELETE" }) as any, { params: Promise.resolve({ id }) });
  return response.status;
}

before(async () => {
  process.env.VERCEL = "1";                               // trust x-forwarded-for, as on Vercel
  await prismaReady;
  routes = {
    status: await import("../app/api/service/v1/tender-status/route"),
    grants: await import("../app/api/settings/service-grants/route"),
    grant: await import("../app/api/settings/service-grants/[id]/route"),
    summary: await import("../app/api/tenders/summary/route"),
  };
  for (const [key, role] of [["owner", "ADMIN"], ["other", "PROPOSAL_MANAGER"], ["viewer", "VIEWER"], ["gone", "ADMIN"]]) {
    const user = await prisma.user.create({ data: { email: `${key}-${run}@service-grant.test`, passwordHash: "x", role } });
    users[key] = user.id;
  }
  const make = async (name: string, userId: string, deadline: Date | null) => {
    const tender = await prisma.tender.create({ data: {
      userId, title: `${name} ${run}`, reference: `REF-${name}`, deadline, status: "IN_PROGRESS",
      clientName: "SECRET-CLIENT-NAME", budget: 987654321, currency: "ETB", notes: "SECRET-NOTES",
      description: "SECRET-DESCRIPTION", analysisSummary: "SECRET-ANALYSIS",
    } });
    tenders[name] = tender.id;
    return tender.id;
  };
  const ownerTender = await make("OwnerSoon", users.owner, new Date(Date.now() + 2 * 86400_000));
  await make("OwnerLater", users.owner, new Date(Date.now() + 20 * 86400_000));
  await make("OtherTenant", users.other, new Date(Date.now() + 86400_000));
  await make("GoneTenant", users.gone, null);
  await prisma.aiJob.create({ data: {
    userId: users.owner, tenderId: ownerTender, jobType: "PROPOSAL_GENERATION", status: "RUNNING",
    input: JSON.stringify({ secret: "SECRET-JOB-INPUT" }), output: "SECRET-JOB-OUTPUT", errorMessage: "SECRET-JOB-ERROR",
  } });
});

after(async () => {
  const ids = Object.values(users);
  await prisma.aiJob.deleteMany({ where: { userId: { in: ids } } });
  await prisma.tender.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });          // grants and sessions cascade
  await prisma.$disconnect();
});

describe("read-only service grant (real PostgreSQL)", () => {
  let ownerToken = "";
  let ownerGrantId = "";

  it("is issued once to its owner and only the token's hash is stored", async () => {
    const created = await issue("owner");
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ownerToken = created.body.token;
    ownerGrantId = created.body.grant.id;
    assert.match(ownerToken, /^hsa_[A-Za-z0-9_-]{43}$/);
    const row = await prisma.serviceAccessGrant.findUniqueOrThrow({ where: { id: ownerGrantId } });
    assert.equal(row.tokenHash, createHash("sha256").update(ownerToken).digest("hex"));
    assert.ok(!JSON.stringify(row).includes(ownerToken));
    assert.deepEqual([row.userId, row.audience, row.scope], [users.owner, "hope-one-agent", "tenders:status:read"]);
    const listed = await routes.grants.GET();
    const body = JSON.stringify(await listed.json());
    assert.ok(!body.includes(ownerToken) && !body.includes(row.tokenHash));
    const audit = await prisma.auditLog.findFirst({ where: { entityId: ownerGrantId, action: "SERVICE_GRANT_CREATED" } });
    assert.ok(audit, "issuance is audited");
  });

  it("reads only its own tenant's tenders, soonest deadline first, with only minimal fields", async () => {
    const { status, body, raw } = await read(ownerToken);
    assert.equal(status, 200);
    assert.equal(raw.headers.get("cache-control"), "no-store");
    assert.deepEqual(body.tenders.map((t: any) => t.reference), ["REF-OwnerSoon", "REF-OwnerLater"]);
    assert.equal(body.total, 2);
    assert.deepEqual(body.tenders[0].latestJob.status, "RUNNING");
    assert.deepEqual(Object.keys(body.tenders[0]).sort(),
                     ["deadline", "id", "latestJob", "readinessScore", "reference", "stage", "status", "title", "updatedAt"]);
    const text = JSON.stringify(body);
    for (const marker of SECRET_MARKERS) assert.ok(!text.includes(marker), `leaked ${marker}`);
    assert.ok(!text.includes(tenders.OtherTenant) && !text.includes("OtherTenant"), "cross-tenant leak");
  });

  it("another tenant's grant sees only that tenant", async () => {
    const created = await issue("other");
    assert.equal(created.status, 201);
    const { body } = await read(created.body.token);
    assert.deepEqual(body.tenders.map((t: any) => t.reference), ["REF-OtherTenant"]);
  });

  it("refuses missing, malformed and unknown tokens identically", async () => {
    const answers = await Promise.all([read(null, "203.0.113.20"), read("not-a-token", "203.0.113.21"),
                                       read(`hsa_${"A".repeat(43)}`, "203.0.113.22")]);
    for (const answer of answers) {
      assert.equal(answer.status, 401);
      assert.deepEqual(answer.body, { error: "Service authorization required" });
      assert.match(answer.raw.headers.get("www-authenticate") ?? "", /^Bearer /);
    }
  });

  it("is not a browser session and opens no other route", async () => {
    cookieStore = {};
    const response = await routes.summary.GET(new Request("https://tender.example/api/tenders/summary",
                                                          { headers: { authorization: `Bearer ${ownerToken}` } }));
    assert.equal(response.status, 401);
  });

  it("records use at most once a minute", async () => {
    const row = await prisma.serviceAccessGrant.findUniqueOrThrow({ where: { id: ownerGrantId } });
    assert.ok(row.lastUsedAt);
    assert.equal(row.useCount, 1);                     // two reads above, one recorded write
  });

  it("can be revoked only by its owner; revocation applies to the next request", async () => {
    assert.equal(await revoke("other", ownerGrantId), 404);       // someone else's id looks missing
    assert.equal((await read(ownerToken, "203.0.113.30")).status, 200);
    assert.equal(await revoke("owner", ownerGrantId), 200);
    assert.equal((await read(ownerToken, "203.0.113.31")).status, 401);
    assert.equal(await revoke("owner", ownerGrantId), 404);       // already revoked
    assert.ok(await prisma.auditLog.findFirst({ where: { entityId: ownerGrantId, action: "SERVICE_GRANT_REVOKED" } }));
  });

  it("stops working when expired or when its tenant is deleted", async () => {
    const created = await issue("owner", { days: 1 });
    await prisma.$executeRaw`UPDATE "ServiceAccessGrant" SET "createdAt" = NOW() - INTERVAL '3 days',
                             "expiresAt" = NOW() - INTERVAL '1 second' WHERE id = ${created.body.grant.id}`;
    assert.equal((await read(created.body.token, "203.0.113.40")).status, 401);
    const goneGrant = await issue("gone");
    assert.equal((await read(goneGrant.body.token, "203.0.113.41")).status, 200);
    await prisma.user.update({ where: { id: users.gone }, data: { deletedAt: new Date() } });
    assert.equal((await read(goneGrant.body.token, "203.0.113.42")).status, 401);
  });

  it("is issued only to ADMIN or PROPOSAL_MANAGER, bounded in number and lifetime", async () => {
    assert.equal((await issue("viewer")).status, 403);
    await signIn(null);
    const anonymous = await routes.grants.POST(new Request("https://tender.example/api/settings/service-grants",
      { method: "POST", body: "{}", headers: { "content-type": "application/json" } }) as any);
    assert.equal(anonymous.status, 401);
    for (const bad of [{ days: 91 }, { days: 0 }, { scope: "tenders:write" }, { userId: users.other }]) {
      assert.equal((await issue("other", bad)).status, 400, JSON.stringify(bad));
    }
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await issue("other")).status);
    assert.ok(statuses.includes(409), "at most 5 active grants per user");
  });

  it("is backed by database constraints that refuse other audiences, scopes and lifetimes", async () => {
    const hash = randomBytes(32).toString("hex");
    const attempts = [
      prisma.$executeRaw`INSERT INTO "ServiceAccessGrant" (id, "userId", "tokenHash", audience, scope, "expiresAt")
                         VALUES (${randomUUID()}, ${users.owner}, ${hash}, 'other-client', 'tenders:status:read', NOW() + INTERVAL '1 day')`,
      prisma.$executeRaw`INSERT INTO "ServiceAccessGrant" (id, "userId", "tokenHash", audience, scope, "expiresAt")
                         VALUES (${randomUUID()}, ${users.owner}, ${hash}, 'hope-one-agent', 'tenders:write', NOW() + INTERVAL '1 day')`,
      prisma.$executeRaw`INSERT INTO "ServiceAccessGrant" (id, "userId", "tokenHash", audience, scope, "expiresAt")
                         VALUES (${randomUUID()}, ${users.owner}, ${hash}, 'hope-one-agent', 'tenders:status:read', NOW() + INTERVAL '91 days')`,
      prisma.$executeRaw`INSERT INTO "ServiceAccessGrant" (id, "userId", "tokenHash", audience, scope, "expiresAt")
                         VALUES (${randomUUID()}, ${users.owner}, 'not-a-hash', 'hope-one-agent', 'tenders:status:read', NOW() + INTERVAL '1 day')`,
    ];
    for (const attempt of attempts) await assert.rejects(attempt);
  });

  it("rate-limits each token durably", async () => {
    const created = await issue("owner");
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await read(created.body.token, "203.0.113.50")).status);
    assert.equal(statuses.filter((s) => s === 200).length, 30);
    assert.equal(statuses[30], 429);
  });
});

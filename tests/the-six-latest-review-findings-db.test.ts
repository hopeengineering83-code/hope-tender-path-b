// Findings 4, 5 and 6 of the Codex review of 2b7bee18, through the real routes
// on PostgreSQL: the worker's retryable flag, hash-only share links, and
// deactivated users in the user list.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { enqueueJob } from "../lib/ai-jobs";
import { activeShares, createdShareAfterRevoke, shareLinkFor, type ShareListEntry } from "../lib/ui/share-links";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let sessionCookie: string | undefined;
const Module = require("module");
const originalResolve = Module._resolveFilename;
const nextHeadersMockPath = "__six_findings_next_headers_mock__";
Module._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "next/headers") return nextHeadersMockPath;
  return originalResolve.call(this, request, ...args);
};
require.cache[nextHeadersMockPath] = {
  id: nextHeadersMockPath, filename: nextHeadersMockPath, loaded: true,
  exports: { cookies: async () => ({ get: (name: string) => (name === "hope_session" && sessionCookie ? { name, value: sessionCookie } : undefined) }) },
} as unknown as NodeModule;

const WORKER_SECRET = "test-worker-secret-at-least-16-chars-long";
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let adminId = "";
let memberId = "";
let tenderId = "";
const createdUserIds: string[] = [];

async function signIn(userId: string) {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET ?? "";
  assert.ok(secret.length >= 32, "a test session secret of at least 32 characters is required");
  const expiresAt = new Date(Date.now() + 120_000);
  const encoded = Buffer.from(JSON.stringify({ userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(24).toString("base64url") })).toString("base64url");
  sessionCookie = `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
  await prisma.session.create({ data: { token: createHash("sha256").update(sessionCookie).digest("hex"), userId, expiresAt } });
}

describe("the six latest review findings — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    process.env.AI_JOBS_WORKER_SECRET = WORKER_SECRET;
    adminId = (await prisma.user.create({ data: { email: `six-admin-${nonce}@example.test`, name: "Admin", passwordHash: "h", role: "ADMIN" } })).id;
    memberId = (await prisma.user.create({ data: { email: `six-member-${nonce}@example.test`, name: "Member", passwordHash: "h", role: "PROPOSAL_MANAGER" } })).id;
    createdUserIds.push(adminId, memberId);
    tenderId = (await prisma.tender.create({ data: { userId: adminId, title: `Share test ${nonce}`, status: "DRAFT", stage: "TENDER_INTAKE" } })).id;
    await signIn(adminId);
  });

  after(async () => {
    sessionCookie = undefined;
    await prisma.tenderShare.deleteMany({ where: { tenderId } });
    await prisma.aiJob.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.tender.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    Module._resolveFilename = originalResolve;
    delete require.cache[nextHeadersMockPath];
  });

  it("4. a terminal durable-stage failure is reported as NOT retryable", async () => {
    // EXTRACT_TEXT with no valid input fails with EXTRACT_TEXT_INPUT_INVALID,
    // which the stage policy does not retry. The response said retryable:true,
    // so the drain workflow only warned about a job that will never recover.
    const job = await enqueueJob({ userId: adminId, jobType: "EXTRACT_TEXT", input: { tenderFileId: "00000000-0000-0000-0000-000000000000" } });
    const { POST } = await import("../app/api/ai-jobs/run-next/route");
    const response = await POST(new Request("http://localhost/api/ai-jobs/run-next?jobType=EXTRACT_TEXT", { method: "POST", headers: { "x-worker-secret": WORKER_SECRET } }));
    assert.equal(response.status, 200);
    const body = await response.json();
    const entry = body.processedJobs.find((j: { jobId: string }) => j.jobId === job.id);
    assert.ok(entry, JSON.stringify(body));
    assert.equal(entry.terminalStatus, "FAILED");
    assert.equal(entry.retryScheduled, false);
    assert.equal(entry.retryable, false, "the classifier's decision, not the inverse of retryScheduled");
    assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } })).status, "FAILED");
  });

  it("5. a new share's URL is shown once, never as /share/null, and goes when the share is revoked", async () => {
    const route = await import("../app/api/tenders/[id]/share/route");
    const params = { params: Promise.resolve({ id: tenderId }) };
    const created = await route.POST(new Request(`http://localhost/api/tenders/${tenderId}/share`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }) as never, params);
    assert.equal(created.status, 201);
    const { share, shareUrl } = await created.json();
    assert.match(shareUrl, /^\/share\/[A-Za-z0-9_-]{20,}$/);
    const origin = "https://app.example";
    const onScreen = { id: share.id as string, url: origin + shareUrl };

    const listed: ShareListEntry[] = (await (await route.GET(new Request(`http://localhost/api/tenders/${tenderId}/share`) as never, params)).json()).shares;
    const row = listed.find((s) => s.id === share.id)!;
    assert.equal(row.token, null, "only the hash is stored");
    assert.equal(shareLinkFor(row, onScreen, origin), onScreen.url, "the share just created shows its one-time URL");
    assert.equal(shareLinkFor(row, null, origin), null, "after a reload there is no URL to show — not /share/null");

    const revoked = await route.DELETE(new Request(`http://localhost/api/tenders/${tenderId}/share`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ shareId: share.id }) }) as never, params);
    assert.equal(revoked.status, 200);
    assert.equal(createdShareAfterRevoke(onScreen, share.id), null, "the revoked share's URL leaves the screen");
    const relisted: ShareListEntry[] = (await (await route.GET(new Request(`http://localhost/api/tenders/${tenderId}/share`) as never, params)).json()).shares;
    assert.ok(relisted.some((s) => s.id === share.id && s.revokedAt), "the API keeps the revoked record");
    assert.ok(!activeShares(relisted).some((s) => s.id === share.id), "the panel does not list it as active");
  });

  it("6. a deactivated user leaves the active list, and their email is explained", async () => {
    const list = await import("../app/api/users/route");
    const one = await import("../app/api/users/[id]/route");
    const ids = async () => ((await (await list.GET()).json()).users as Array<{ id: string }>).map((u) => u.id);
    assert.ok((await ids()).includes(memberId));
    const del = await one.DELETE(new Request(`http://localhost/api/users/${memberId}`, { method: "DELETE" }), { params: Promise.resolve({ id: memberId }) });
    assert.equal(del.status, 200);
    const after = await ids();
    assert.ok(!after.includes(memberId), "the deactivated account is not listed as active");
    assert.ok(after.includes(adminId));
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: memberId } })).deletedAt, "the record is preserved");
    const again = await list.POST(new Request("http://localhost/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `six-member-${nonce}@example.test`, password: "A-strong-passw0rd!x", role: "VIEWER" }) }));
    assert.equal(again.status, 409);
    assert.match((await again.json()).error, /deactivated account/);
  });
});

// Regression (real PostgreSQL, through the route handlers): a VALID manual requirement can be
// created and edited. Before this fix the create route always wrote `linkedProposalSection` and
// `linkedCompanyEvidenceId` to prisma.tenderRequirement.create, and the edit route put them in the
// update — but TenderRequirement has no such columns, so Prisma rejected every valid manual create
// ("Unknown argument `linkedProposalSection`") and every edit that sent either field.
// The fix stops writing them to the model and keeps them, when given, as provenance in the audit
// metadata. This file also pins the manual-provenance contract: no source fields, MANUAL method,
// zero confidence, never "source grounded", reason/origin reconstructed from the audit log, and
// tenant isolation. Invented data only.
import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for the manual requirement route tests.");
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
  if (request === "next/headers") return (require.resolve as any).__manual_req_next_headers_mock_path || "";
  return originalResolve.call(this, request, ...args);
};
const mockModulePath = "__manual_req_next_headers_mock__";
require.cache[mockModulePath] = {
  id: mockModulePath, filename: mockModulePath, loaded: true, exports: nextHeadersMock, paths: [], children: [], parent: null,
} as any;
(require.resolve as any).__manual_req_next_headers_mock_path = mockModulePath;

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
const users: Record<string, string> = {};
const tenders: Record<string, string> = {};
let routes: {
  list: typeof import("../app/api/tenders/[id]/requirements/route");
  item: typeof import("../app/api/tenders/[id]/requirements/[requirementId]/route");
};

const valid = {
  title: "Invented bid security requirement", description: "Invented: a bid security of an invented amount.",
  requirementType: "BID_SECURITY", priority: "MANDATORY", reason: "Owner read this from the invented tender notice, page 3.",
  exactFileName: "Invented_Bid_Security.pdf", exactOrder: 4, pageLimit: 2, sectionReference: "ITB 19.1",
};

async function create(tenderId: string, body: unknown) {
  const response = await routes.list.POST(
    new Request(`https://tender.example/api/tenders/${tenderId}/requirements`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }) as any,
    { params: Promise.resolve({ id: tenderId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function list(tenderId: string) {
  const response = await routes.list.GET(new Request(`https://tender.example/api/tenders/${tenderId}/requirements`) as any,
                                         { params: Promise.resolve({ id: tenderId }) });
  return { status: response.status, body: await response.json() };
}

async function edit(tenderId: string, requirementId: string, body: unknown) {
  const response = await routes.item.PATCH(
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
    list: await import("../app/api/tenders/[id]/requirements/route"),
    item: await import("../app/api/tenders/[id]/requirements/[requirementId]/route"),
  };
  for (const key of ["owner", "other"]) {
    const user = await prisma.user.create({ data: { email: `${key}-${run}@manual-req.test`, passwordHash: "x", role: "ADMIN" } });
    users[key] = user.id;
    tenders[key] = (await prisma.tender.create({ data: { userId: user.id, title: `Invented ${key} tender ${run}` } })).id;
  }
});

after(async () => {
  // The canonical-requirement guard only lets a tender's last requirements go inside a tender
  // deletion (migration 20260629000000): the same transaction-local context the app sets.
  for (const tenderId of Object.values(tenders)) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tender_deletion_context', ${tenderId}, true)`;
      await tx.tenderRequirement.deleteMany({ where: { tenderId } });
      await tx.tender.deleteMany({ where: { id: tenderId } });
    });
  }
  const ids = Object.values(users);
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });   // sessions cascade
  await prisma.$disconnect();
});

describe("manual requirements: a valid create and edit succeed with manual provenance (real PostgreSQL)", () => {
  it("creates a valid manual requirement (this failed with 'Unknown argument linkedProposalSection')", async () => {
    await signIn(users.owner);
    const { status, body } = await create(tenders.owner, valid);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.equal(body.requirement.isManual, true);
    assert.equal(body.requirement.sourceGrounded, false);
    assert.equal(body.requirement.sourceOrigin, "HUMAN_ENTERED");             // default when not given
    assert.equal(body.requirement.manualReason, valid.reason);
    assert.equal(body.requirement.manualEnteredBy, users.owner);
    const row = await prisma.tenderRequirement.findUniqueOrThrow({ where: { id: body.requirement.id } });
    assert.equal(row.tenderId, tenders.owner);
    assert.equal(row.sourceExtractionMethod, "MANUAL");
    assert.equal(row.sourceExactQuote, null, "human input is never stored as a tender quote");
    assert.equal(row.sourceTenderFileId, null);
    assert.equal(row.sourcePageNumber, null);
    assert.equal(row.sourceConfidence, 0);
    assert.equal(row.sourceSectionHeading, "Manual Entry — not tender-source evidence");
    assert.deepEqual([row.exactFileName, row.exactOrder, row.pageLimit, row.sectionReference],
                     [valid.exactFileName, valid.exactOrder, valid.pageLimit, valid.sectionReference]);
  });

  it("accepts the two non-column hints and keeps them as audit provenance, not on the requirement", async () => {
    await signIn(users.owner);
    const { status, body } = await create(tenders.owner, {
      ...valid, title: "Invented personnel requirement", requirementType: "PERSONNEL", sourceOrigin: "NOT_STATED",
      linkedProposalSection: "Section C: Key Personnel & CVs", linkedCompanyEvidenceId: "invented-evidence-1",
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.requirement.sourceOrigin, "NOT_STATED");
    assert.ok(!("linkedProposalSection" in body.requirement));
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "TenderRequirement", entityId: body.requirement.id, action: "TENDER_UPDATE" } });
    assert.equal(audit.userId, users.owner);
    const metadata = JSON.parse(audit.metadata ?? "{}");
    assert.equal(metadata.tenderId, tenders.owner);
    assert.equal(metadata.sourceOrigin, "NOT_STATED");
    assert.equal(metadata.reason, valid.reason);
    assert.equal(metadata.sourceGrounded, false);
    assert.equal(metadata.linkedProposalSection, "Section C: Key Personnel & CVs");
    assert.equal(metadata.linkedCompanyEvidenceId, "invented-evidence-1");
  });

  it("lists manual requirements with provenance rebuilt from the audit log", async () => {
    await signIn(users.owner);
    const { status, body } = await list(tenders.owner);
    assert.equal(status, 200);
    const personnel = body.requirements.find((r: any) => r.title === "Invented personnel requirement");
    assert.ok(personnel);
    assert.equal(personnel.isManual, true);
    assert.equal(personnel.sourceGrounded, false);
    assert.equal(personnel.sourceOrigin, "NOT_STATED");
    assert.equal(personnel.manualReason, valid.reason);
    assert.equal(personnel.manualEnteredBy, users.owner);
  });

  it("edits a manual requirement, including the two hints (this failed the same way)", async () => {
    await signIn(users.owner);
    const created = await create(tenders.owner, { ...valid, title: "Invented editable requirement" });
    const id = created.body.requirement.id;
    const { status, body } = await edit(tenders.owner, id, {
      title: "Invented editable requirement, edited", exactOrder: 7,
      linkedProposalSection: "Section B: Technical Proposal", linkedCompanyEvidenceId: null,
    });
    assert.equal(status, 200, JSON.stringify(body));
    const row = await prisma.tenderRequirement.findUniqueOrThrow({ where: { id } });
    assert.equal(row.title, "Invented editable requirement, edited");
    assert.equal(row.exactOrder, 7);
    assert.equal(row.sourceExtractionMethod, "MANUAL");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: id, action: "TENDER_UPDATE", description: { contains: "updated" } }, orderBy: { createdAt: "desc" } });
    const metadata = JSON.parse(audit.metadata ?? "{}");
    assert.equal(metadata.linkedProposalSection, "Section B: Technical Proposal");
    assert.equal(metadata.linkedCompanyEvidenceId, null);
    assert.ok(metadata.updatedFields.includes("linkedProposalSection"));
  });

  it("keeps tenants apart: another account can neither add to nor read this tender", async () => {
    await signIn(users.other);
    assert.equal((await create(tenders.owner, valid)).status, 404);
    assert.equal((await list(tenders.owner)).status, 404);
    assert.equal(await prisma.tenderRequirement.count({ where: { tenderId: tenders.owner, title: valid.title } }), 1);
  });

  it("still refuses invalid input before any write", async () => {
    await signIn(users.owner);
    const before = await prisma.tenderRequirement.count({ where: { tenderId: tenders.owner } });
    for (const bad of [{ ...valid, priority: "URGENT" }, { ...valid, title: "" }, { ...valid, exactOrder: "4" }]) {
      const answer = await create(tenders.owner, bad);
      assert.equal(answer.status, 400);
      assert.equal(answer.body.error, "Invalid requirement data");
    }
    assert.equal(await prisma.tenderRequirement.count({ where: { tenderId: tenders.owner } }), before);
  });
});

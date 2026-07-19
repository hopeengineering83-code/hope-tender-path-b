import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { isDurablyReviewed } from "../lib/vault-review-provenance";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for vault review route tests.");
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
  if (request === "next/headers") {
    return (require.resolve as any).__vault_review_next_headers_mock_path || "";
  }
  return originalResolve.call(this, request, ...args);
};
const mockModulePath = "__vault_review_next_headers_mock__";
require.cache[mockModulePath] = {
  id: mockModulePath,
  filename: mockModulePath,
  loaded: true,
  exports: nextHeadersMock,
  paths: [],
  children: [],
  parent: null,
} as any;
(require.resolve as any).__vault_review_next_headers_mock_path = mockModulePath;

const SESSION_COOKIE = "hope_session";
const sourceText = [
  "Curriculum Vitae and Project Reference.",
  "Hana Route is a Structural Engineer with 20 years of experience in Buildings.",
  "Project Route was delivered for Client Route in Ethiopia in the Buildings sector.",
  "The service area was Structural Engineering and the contract value was 1000 ETB.",
].join(" ");
const sourceHash = createHash("sha256").update(sourceText, "utf8").digest("hex");
const sourceByteLength = Buffer.byteLength(sourceText);

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("A test session secret of at least 32 characters is required");
  return secret;
}

function makeToken(userId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + 14 * 86400 * 1000);
  const payload = {
    userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    nonce: randomBytes(24).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  return { token: `${encoded}.${signature}`, expiresAt };
}

async function authenticate(userId: string): Promise<void> {
  cookieStore = {};
  const { token, expiresAt } = makeToken(userId);
  await prisma.session.create({
    data: {
      token: createHash("sha256").update(token).digest("hex"),
      userId,
      expiresAt,
    },
  });
  cookieStore[SESSION_COOKIE] = token;
}

async function createWorkspace(role: "ADMIN" | "PROPOSAL_MANAGER" | "REVIEWER" | "VIEWER") {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      name: `Vault route ${role}`,
      email: `vault-route-${role.toLowerCase()}-${suffix}@example.test`,
      passwordHash: "not-used",
      role,
    },
  });
  const company = await prisma.company.create({
    data: { name: `Vault route ${role} company`, userId: user.id },
  });
  return { user, company };
}

async function createSourceDocument(companyId: string, verified = true) {
  return prisma.companyDocument.create({
    data: {
      companyId,
      fileName: `source-${randomUUID()}.txt`,
      originalFileName: "source.txt",
      mimeType: "text/plain",
      size: sourceByteLength,
      category: "EXPERT_CV",
      extractedText: sourceText,
      aiExtractionStatus: "EXTRACTED",
      contentSha256: verified ? sourceHash : null,
      contentByteLength: verified ? sourceByteLength : null,
      integrityStatus: verified ? "VERIFIED" : "UNKNOWN",
    },
  });
}

async function callBatch(
  route: { PATCH(req: Request): Promise<Response> },
  kind: "experts" | "projects",
  actorId: string,
  ids: string[],
) {
  await authenticate(actorId);
  return route.PATCH(new Request(`http://localhost/api/company/${kind}/batch`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, trustLevel: "REVIEWED" }),
  }));
}

describe("vault batch review routes — real authenticated PostgreSQL", () => {
  let expertRoute: { PATCH(req: Request): Promise<Response> };
  let projectRoute: { PATCH(req: Request): Promise<Response> };
  let expertSingleRoute: { PATCH(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> };
  let projectSingleRoute: { PATCH(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> };
  const userIds: string[] = [];

  before(async () => {
    await prismaReady;
    expertRoute = await import("../app/api/company/experts/batch/route");
    projectRoute = await import("../app/api/company/projects/batch/route");
    expertSingleRoute = await import("../app/api/company/experts/[id]/route");
    projectSingleRoute = await import("../app/api/company/projects/[id]/route");
  });

  after(async () => {
    cookieStore = {};
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("rejects VIEWER before any record or audit mutation", async () => {
    const viewer = await createWorkspace("VIEWER");
    userIds.push(viewer.user.id);

    const response = await callBatch(expertRoute, "experts", viewer.user.id, ["not-a-record"]);
    assert.equal(response.status, 403);
    assert.equal(await prisma.auditLog.count({ where: { userId: viewer.user.id } }), 0);
  });

  it("partially accepts owned experts, rejects foreign IDs, and atomically records reviewer audit", async () => {
    const owner = await createWorkspace("ADMIN");
    const foreign = await createWorkspace("ADMIN");
    userIds.push(owner.user.id, foreign.user.id);
    const ownerSource = await createSourceDocument(owner.company.id);
    const foreignSource = await createSourceDocument(foreign.company.id);
    const ownedExpert = await prisma.expert.create({
      data: {
        companyId: owner.company.id,
        fullName: "Hana Route",
        title: "Structural Engineer",
        yearsExperience: 20,
        disciplines: JSON.stringify(["Structural Engineering"]),
        sectors: JSON.stringify(["Buildings"]),
        sourceDocumentId: ownerSource.id,
      },
    });
    const foreignExpert = await prisma.expert.create({
      data: {
        companyId: foreign.company.id,
        fullName: "Hana Route",
        title: "Structural Engineer",
        yearsExperience: 20,
        disciplines: JSON.stringify(["Structural Engineering"]),
        sectors: JSON.stringify(["Buildings"]),
        sourceDocumentId: foreignSource.id,
      },
    });

    const response = await callBatch(
      expertRoute,
      "experts",
      owner.user.id,
      [ownedExpert.id, foreignExpert.id],
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      updated: number;
      accepted: Array<{ id: string }>;
      rejected: Array<{ id: string; code: string }>;
    };
    assert.equal(body.updated, 1);
    assert.deepEqual(body.accepted.map((item) => item.id), [ownedExpert.id]);
    assert.deepEqual(body.rejected, [{ id: foreignExpert.id, code: "NOT_FOUND_OR_NOT_OWNED" }]);

    const reviewed = await prisma.expert.findUniqueOrThrow({
      where: { id: ownedExpert.id },
      select: {
        companyId: true,
        fullName: true,
        title: true,
        yearsExperience: true,
        disciplines: true,
        sectors: true,
        certifications: true,
        trustLevel: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
        sourceDocumentId: true,
        sourceDocument: {
          select: {
            id: true,
            companyId: true,
            extractedText: true,
            contentSha256: true,
            contentByteLength: true,
            integrityStatus: true,
          },
        },
      },
    });
    assert.equal(reviewed.reviewedBy, owner.user.id);
    assert.equal(isDurablyReviewed(reviewed), true);
    const unchangedForeign = await prisma.expert.findUniqueOrThrow({ where: { id: foreignExpert.id } });
    assert.equal(unchangedForeign.trustLevel, "REGEX_DRAFT");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { userId: owner.user.id, action: "EXPERT_REVIEW", entityId: ownedExpert.id },
    });
    const metadata = JSON.parse(audit.metadata) as {
      sourceContentHash: string;
      sourceByteLength: number;
      sourceTextHash: string;
      reviewedAt: string;
    };
    assert.equal(metadata.sourceContentHash, sourceHash);
    assert.equal(metadata.sourceByteLength, sourceByteLength);
    assert.equal(metadata.reviewedAt, reviewed.reviewedAt?.toISOString());
    assert.match(metadata.sourceTextHash, /^[a-f0-9]{64}$/);
  });

  it("allows REVIEWER for an owned project and persists matching audit identity and timestamp", async () => {
    const reviewer = await createWorkspace("REVIEWER");
    userIds.push(reviewer.user.id);
    const source = await createSourceDocument(reviewer.company.id);
    const project = await prisma.project.create({
      data: {
        companyId: reviewer.company.id,
        name: "Project Route",
        clientName: "Client Route",
        country: "Ethiopia",
        sector: "Buildings",
        serviceAreas: JSON.stringify(["Structural Engineering"]),
        contractValue: 1000,
        currency: "ETB",
        sourceDocumentId: source.id,
      },
    });

    const response = await callBatch(projectRoute, "projects", reviewer.user.id, [project.id]);
    assert.equal(response.status, 200);
    const body = await response.json() as { updated: number; rejected: unknown[] };
    assert.equal(body.updated, 1);
    assert.deepEqual(body.rejected, []);

    const reviewed = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { reviewedBy: true, reviewedAt: true, trustLevel: true },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { userId: reviewer.user.id, action: "PROJECT_REVIEW", entityId: project.id },
    });
    const metadata = JSON.parse(audit.metadata) as { reviewedAt: string };
    assert.equal(reviewed.reviewedBy, reviewer.user.id);
    assert.equal(reviewed.trustLevel, "REVIEWED");
    assert.equal(metadata.reviewedAt, reviewed.reviewedAt?.toISOString());
  });

  it("rejects unverified source bytes without changing the record or writing an audit row", async () => {
    const owner = await createWorkspace("PROPOSAL_MANAGER");
    userIds.push(owner.user.id);
    const source = await createSourceDocument(owner.company.id, false);
    const expert = await prisma.expert.create({
      data: {
        companyId: owner.company.id,
        fullName: "Hana Route",
        title: "Structural Engineer",
        yearsExperience: 20,
        sourceDocumentId: source.id,
      },
    });

    const response = await callBatch(expertRoute, "experts", owner.user.id, [expert.id]);
    assert.equal(response.status, 422);
    const body = await response.json() as {
      updated: number;
      rejected: Array<{ id: string; code: string }>;
    };
    assert.equal(body.updated, 0);
    assert.deepEqual(body.rejected, [{ id: expert.id, code: "PROVENANCE_REQUIRED" }]);
    const unchanged = await prisma.expert.findUniqueOrThrow({ where: { id: expert.id } });
    assert.equal(unchanged.trustLevel, "REGEX_DRAFT");
    assert.equal(unchanged.reviewedAt, null);
    assert.equal(await prisma.auditLog.count({
      where: { userId: owner.user.id, action: "EXPERT_REVIEW", entityId: expert.id },
    }), 0);
  });

  it("single expert approval creates durable provenance and audit atomically", async () => {
    const owner = await createWorkspace("ADMIN");
    userIds.push(owner.user.id);
    const source = await createSourceDocument(owner.company.id);
    const expert = await prisma.expert.create({
      data: {
        companyId: owner.company.id,
        fullName: "Hana Route",
        title: "Structural Engineer",
        yearsExperience: 20,
        disciplines: JSON.stringify(["Structural Engineering"]),
        sectors: JSON.stringify(["Buildings"]),
        sourceDocumentId: source.id,
      },
    });
    await authenticate(owner.user.id);
    const response = await expertSingleRoute.PATCH(new Request(`http://localhost/api/company/experts/${expert.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }), { params: Promise.resolve({ id: expert.id }) });
    assert.equal(response.status, 200);
    const reviewed = await prisma.expert.findUniqueOrThrow({
      where: { id: expert.id },
      select: {
        companyId: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true,
        trustLevel: true, reviewedBy: true, reviewedAt: true, reviewNotes: true, sourceDocumentId: true,
        sourceDocument: { select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true } },
      },
    });
    assert.equal(isDurablyReviewed(reviewed), true);
    assert.equal(await prisma.auditLog.count({ where: { userId: owner.user.id, action: "EXPERT_REVIEW", entityId: expert.id } }), 1);
  });

  it("single project approval rejects unverified bytes with zero writes", async () => {
    const owner = await createWorkspace("PROPOSAL_MANAGER");
    userIds.push(owner.user.id);
    const source = await createSourceDocument(owner.company.id, false);
    const project = await prisma.project.create({
      data: {
        companyId: owner.company.id,
        name: "Project Route",
        clientName: "Client Route",
        country: "Ethiopia",
        sector: "Buildings",
        serviceAreas: JSON.stringify(["Structural Engineering"]),
        contractValue: 1000,
        currency: "ETB",
        sourceDocumentId: source.id,
      },
    });
    await authenticate(owner.user.id);
    const response = await projectSingleRoute.PATCH(new Request(`http://localhost/api/company/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }), { params: Promise.resolve({ id: project.id }) });
    assert.equal(response.status, 422);
    const unchanged = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(unchanged.trustLevel, "REGEX_DRAFT");
    assert.equal(unchanged.reviewedAt, null);
    assert.equal(await prisma.auditLog.count({ where: { userId: owner.user.id, action: "PROJECT_REVIEW", entityId: project.id } }), 0);
  });

  it("single approval returns not found for a foreign-company record", async () => {
    const owner = await createWorkspace("REVIEWER");
    const foreign = await createWorkspace("ADMIN");
    userIds.push(owner.user.id, foreign.user.id);
    const source = await createSourceDocument(foreign.company.id);
    const expert = await prisma.expert.create({
      data: { companyId: foreign.company.id, fullName: "Hana Route", sourceDocumentId: source.id },
    });
    await authenticate(owner.user.id);
    const response = await expertSingleRoute.PATCH(new Request(`http://localhost/api/company/experts/${expert.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }), { params: Promise.resolve({ id: expert.id }) });
    assert.equal(response.status, 404);
    const unchanged = await prisma.expert.findUniqueOrThrow({ where: { id: expert.id } });
    assert.equal(unchanged.trustLevel, "REGEX_DRAFT");
  });

});

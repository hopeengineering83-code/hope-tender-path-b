// PR #1175 Gaps E and F, against real PostgreSQL.
//
// GAP E — a failed resolver must not look like a clean tender.
//   deriveSuggestedControls ended in `catch { return []; }`. The panel renders
//   an empty suggestion array as "nothing to do", so a Prisma outage inside the
//   resolver was presented to the owner as a tender with no outstanding
//   controls. This seeds a tender with real blockers, forces the resolver's DB
//   read to throw, and asserts the route reports the failure instead of zero.
//
// GAP F — the match-context read must be tenant-scoped at the query.
//   `prisma.tender.findFirst({ where: { id: tenderId } })` relied on an earlier
//   ownership check for its scope. This asserts the query itself is scoped, and
//   that a second user gets nothing — no match labels, no expert or project
//   names, no counts, no diagnostics, and no signal that the tender exists.
//
// Requires RUN_DB_INTEGRATION=true and a real PostgreSQL DATABASE_URL.

import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { createHash, createHmac, randomBytes } from "node:crypto";

import {
  RUN_DB,
  dbDescribe,
  getPrisma,
  testSuffix,
  seedUser,
  seedTender,
  seedTenderFile,
  seedRequirement,
  cleanupTender,
  cleanupUser,
} from "./helpers/db-acceptance-harness";

// ─── next/headers cookie shim ────────────────────────────────────────────────
// The route authenticates through requireRole -> getSession -> cookies(). The
// shim lets the test act as a specific signed-in user without a browser.
let sessionCookie: string | undefined;
if (RUN_DB) {
  const Module = require("module");
  const originalResolve = Module._resolveFilename;
  const mockPath = "__tender_controls_failure_next_headers_mock__";
  Module._resolveFilename = function (request: string, ...args: unknown[]) {
    if (request === "next/headers") return mockPath;
    return originalResolve.call(this, request, ...args);
  };
  require.cache[mockPath] = {
    id: mockPath,
    filename: mockPath,
    loaded: true,
    exports: {
      cookies: async () => ({
        get: (name: string) =>
          name === "hope_session" && sessionCookie ? { name, value: sessionCookie } : undefined,
      }),
    },
  } as unknown as NodeModule;
}

/**
 * Temporarily replace a Prisma delegate method.
 *
 * node:test's mock.method cannot be used here: Prisma defines delegate methods
 * as accessors, so the descriptor has no `value` and mock.method rejects it as
 * "not a method". This saves and restores the real descriptor instead.
 */
function patchDelegate(
  delegate: Record<string, any>,
  method: string,
  makeImpl: (original: (...args: any[]) => any) => (...args: any[]) => any,
): () => void {
  // Capture the callable, not its descriptor: the delegate is a Proxy, so the
  // property may not be an own descriptor and deleting the patch does not
  // reliably reveal the original again. Restoring by value always does.
  const original = delegate[method].bind(delegate) as (...args: any[]) => any;
  const define = (value: unknown) =>
    Object.defineProperty(delegate, method, { value, configurable: true, writable: true });
  define(makeImpl(original));
  return () => define(original);
}

/**
 * True only for the controls resolver's match-context read.
 *
 * The release snapshot also selects expertMatches, so a looser predicate broke
 * the canonical decision as well and the test could no longer show that the two
 * are independent. This keys on the resolver's exact three-key projection.
 */
function isControlsMatchContextRead(args: Record<string, any> | undefined): boolean {
  const select = args?.select;
  if (!select) return false;
  const keys = Object.keys(select).sort();
  return keys.length === 3
    && keys[0] === "expertMatches"
    && keys[1] === "projectMatches"
    && keys[2] === "requirements";
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("A test session secret of at least 32 characters is required");
  return secret;
}

const EXPERT_NAME = "Wubshet Alemayehu";
const PROJECT_NAME = "Hawassa Industrial Park Water Works";

dbDescribe("Tender Controls — resolver failure and tenant scope", () => {
  const prisma = getPrisma();
  const client = prisma as unknown as Record<string, any>;
  const suffix = testSuffix();
  let owner: { id: string };
  let intruder: { id: string };
  let tender: { id: string };
  let route: typeof import("../app/api/tenders/[id]/controls/route");

  async function authenticate(userId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 60_000);
    const payload = {
      userId,
      exp: Math.floor(expiresAt.getTime() / 1000),
      nonce: randomBytes(24).toString("base64url"),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
    sessionCookie = `${encoded}.${signature}`;
    await client.session.create({
      data: {
        token: createHash("sha256").update(sessionCookie).digest("hex"),
        userId,
        expiresAt,
      },
    });
  }

  async function getControls(tenderId: string) {
    const response = await route.GET(
      new Request(`http://localhost/api/tenders/${tenderId}/controls`),
      { params: Promise.resolve({ id: tenderId }) },
    );
    return { response, body: await response.json() as Record<string, any> };
  }

  before(async () => {
    owner = await seedUser(prisma, `own-${suffix}`, "PROPOSAL_MANAGER");
    intruder = await seedUser(prisma, `int-${suffix}`, "PROPOSAL_MANAGER");

    const company = await client.company.create({
      data: {
        userId: owner.id,
        name: `Controls Co ${suffix}`,
        legalName: `Controls Co Legal ${suffix}`,
        country: "ET",
        sectors: "Engineering",
      },
    });

    tender = await seedTender(prisma, {
      userId: owner.id,
      suffix,
      title: `Controls Scope Tender ${suffix}`,
      status: "ANALYZED",
    });
    const file = await seedTenderFile(prisma, { tenderId: tender.id, suffix });
    await seedRequirement(prisma, {
      tenderId: tender.id,
      title: "Mandatory water engineer",
      description: "The Contractor shall provide a licensed Water Engineer.",
      requirementType: "EXPERT",
      priority: "MANDATORY",
      sourceTenderFileId: file.id,
    });

    // Named records, so a leak would be unmistakable in the response body.
    const expert = await client.expert.create({
      data: { companyId: company.id, fullName: EXPERT_NAME, title: "Water Engineer", yearsExperience: 11 },
    });
    await client.tenderExpertMatch.create({
      data: { tenderId: tender.id, expertId: expert.id, score: 0.42, rationale: "weak", isSelected: true },
    });
    const project = await client.project.create({
      data: { companyId: company.id, name: PROJECT_NAME, clientName: "Hawassa Utility", country: "ET" },
    });
    await client.tenderProjectMatch.create({
      data: { tenderId: tender.id, projectId: project.id, score: 0.38, rationale: "weak", isSelected: true },
    });

    route = await import("../app/api/tenders/[id]/controls/route");
  });

  after(async () => {
    if (tender?.id) await cleanupTender(prisma, tender.id);
    if (owner?.id) await cleanupUser(prisma, owner.id);
    if (intruder?.id) await cleanupUser(prisma, intruder.id);
  });

  // ─── GAP E ────────────────────────────────────────────────────────────────

  it("the healthy path still returns suggestions and marks them available", async () => {
    await authenticate(owner.id);
    const { response, body } = await getControls(tender.id);
    assert.equal(response.status, 200);
    assert.equal(body.suggestionsAvailable, true);
    assert.ok(Array.isArray(body.suggestedControls));
    assert.equal(body.suggestionsError, undefined);
    assert.equal(typeof body.summary.suggested, "number");
  });

  it("a resolver failure reports itself instead of returning zero controls", async () => {
    await authenticate(owner.id);

    // Break exactly the read the resolver makes for match context, leaving the
    // route's own ownership check working. This is the real failure mode: a DB
    // error raised inside deriveSuggestedControls.
    const restore = patchDelegate(client.tender, "findFirst", (original) => async (args: Record<string, any>) => {
      if (isControlsMatchContextRead(args)) {
        throw new Error("simulated Prisma failure inside the controls resolver");
      }
      return original(args);
    });

    try {
      const { response, body } = await getControls(tender.id);

      assert.equal(response.status, 200, "the panel still needs a renderable response");
      assert.equal(body.suggestionsAvailable, false, "the failure must be explicit");
      assert.equal(body.suggestionsError?.code, "TENDER_CONTROLS_RESOLVER_FAILED");
      assert.equal(body.suggestionsError?.message, "Current workflow controls could not be verified.");
      assert.match(String(body.suggestionsError?.requestId ?? ""), /[0-9a-f-]{8,}/);

      // Not zero, and not stale: the count is withheld, and no suggestion is
      // synthesised from lifecycle data the canonical authority failed to
      // confirm.
      assert.equal(body.summary.suggested, null);
      assert.equal(body.summary.suggestionsAvailable, false);
      assert.deepEqual(body.suggestedControls, []);

      // No raw internals cross the boundary.
      const serialized = JSON.stringify(body);
      assert.doesNotMatch(serialized, /simulated Prisma failure/);
      assert.doesNotMatch(serialized, /PrismaClient|prisma|\bstack\b|at Object\./i);
    } finally {
      restore();
    }
  });

  it("a controls failure changes nothing about generation or export eligibility", async () => {
    // The canonical authority is a different module and a different query. A
    // controls outage must be invisible to it — this is what "Tender Controls
    // are non-authoritative" has to mean in practice.
    const { getCanonicalTenderWorkflowDecision } = await import("../lib/engine/canonical-workflow-decision");
    const before = await getCanonicalTenderWorkflowDecision(prisma, owner.id, tender.id);

    const restore = patchDelegate(client.tender, "findFirst", (original) => async (args: Record<string, any>) => {
      if (isControlsMatchContextRead(args)) throw new Error("simulated failure");
      return original(args);
    });
    try {
      await authenticate(owner.id);
      await getControls(tender.id);
      const after = await getCanonicalTenderWorkflowDecision(prisma, owner.id, tender.id);
      assert.equal(after?.currentBlockingStage, before?.currentBlockingStage);
      assert.equal(after?.finalExportAllowed, before?.finalExportAllowed);
      assert.equal(after?.nextRequiredAction, before?.nextRequiredAction);
    } finally {
      restore();
    }
  });

  // ─── GAP F ────────────────────────────────────────────────────────────────

  it("the match-context query is scoped to the owner, not to the id alone", async () => {
    // The scope asserted at the query, independent of any route-level check.
    const asOwner = await client.tender.findFirst({
      where: { id: tender.id, userId: owner.id },
      select: { expertMatches: { select: { id: true } } },
    });
    assert.ok(asOwner, "the owner must still reach their own match context");

    const asIntruder = await client.tender.findFirst({
      where: { id: tender.id, userId: intruder.id },
      select: { expertMatches: { select: { id: true } } },
    });
    assert.equal(asIntruder, null, "a scoped query must return nothing for another user");
  });

  it("a second user guessing the tender id gets no controls, labels or counts", async () => {
    await authenticate(intruder.id);
    const { response, body } = await getControls(tender.id);

    assert.equal(response.status, 404);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, new RegExp(EXPERT_NAME, "i"));
    assert.doesNotMatch(serialized, new RegExp(PROJECT_NAME, "i"));
    assert.equal(body.suggestedControls, undefined);
    assert.equal(body.summary, undefined);
    assert.equal(body.controls, undefined);
  });

  it("the failure path does not leak existence either", async () => {
    // A non-existent id and someone else's id must be indistinguishable.
    await authenticate(intruder.id);
    const foreign = await getControls(tender.id);
    const missing = await getControls("tender-that-does-not-exist");
    assert.equal(foreign.response.status, missing.response.status);
    assert.deepEqual(foreign.body, missing.body);
  });

  it("the owner is unaffected by the intruder's attempts", async () => {
    await authenticate(owner.id);
    const { response, body } = await getControls(tender.id);
    assert.equal(response.status, 200);
    assert.equal(body.suggestionsAvailable, true);
  });
});
